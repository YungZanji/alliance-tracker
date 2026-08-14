
// Non-destructive active-control probe for Sunday UI routing.
// The probe is processed on XLuaManager.Update through the existing replay queue,
// so GameObject.Find/GetComponent stay on the game main thread. It deliberately
// bypasses the cached observed-control map and checks the currently active Unity
// GameObject, which matters when an earlier Sunday screen existed in the same
// Survival.exe process but is no longer visible.
const automationProcessReplayQueueBeforeProbe = automationProcessReplayQueue;
automationProcessReplayQueue = function () {
  if (!automationReplayQueue.length) return;
  const item = automationReplayQueue[0];
  if (!item || !item.probeOnly) {
    automationProcessReplayQueueBeforeProbe();
    return;
  }

  automationReplayQueue.shift();
  automationReplaySequence += 1;
  let observed = null;
  try {
    observed = automationResolveControlByName(item.name);
  } catch (error) {
    automationReplayEmit('automation-probe-result', {
      probeId: automationReplaySequence,
      name: item.name,
      ok: false,
      error: String(error)
    });
    return;
  }

  if (!observed) {
    automationReplayEmit('automation-probe-result', {
      probeId: automationReplaySequence,
      name: item.name,
      ok: false,
      error: 'GameObject.Find did not find this control on the currently active UI.'
    });
    return;
  }

  automationReplayEmit('automation-probe-result', {
    probeId: automationReplaySequence,
    name: item.name,
    controlType: observed.controlType || '',
    controlPointer: observed.pointerText || '',
    ok: true,
    method: 'active GameObject.Find/GetComponent probe; no click performed'
  });
};

function automationListenForProbe() {
  recv('automation-probe-control', function (message) {
    const payload = message && message.payload ? message.payload : {};
    const name = String(payload.name || '').trim();
    if (name) {
      automationReplayQueue.push({
        name,
        probeOnly: true,
        queuedAt: automationNow()
      });
      automationReplayEmit('automation-probe-queued', {
        name,
        queueDepth: automationReplayQueue.length
      });
    }
    automationListenForProbe();
  });
}

automationListenForProbe();
setImmediate(function () {
  automationReplayEmit('automation-probe-ready', {
    method: 'active GameObject.Find/GetComponent without invocation'
  });
});
