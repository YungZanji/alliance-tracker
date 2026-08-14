
// Internal Unity-control replay proof. This does not synthesize SmartFox packets.
// It remembers actual Unity UI controls observed in the running client and invokes
// the same Button/Toggle logic on the game's main thread through XLuaManager.Update.
let automationReplayInstalled = false;
let automationReplayTimer = null;
const automationReplayHookAddresses = new Set();
const automationObservedControls = new Map();
const automationReplayQueue = [];
let automationReplaySequence = 0;

function automationReplayEmit(kind, payload) {
  send({
    kind,
    observedAt: automationNow(),
    ...(payload || {})
  });
}

function automationRememberControl(controlType, control) {
  if (!control || control.isNull()) return;
  const name = automationUnityObjectName(control);
  if (!name) return;
  const key = `${controlType}:${name}`;
  const previous = automationObservedControls.get(key);
  const pointerText = pstr(control);
  automationObservedControls.set(key, {
    key,
    name,
    controlType,
    control,
    pointerText,
    observedAt: automationNow()
  });
  if (!previous || previous.pointerText !== pointerText) {
    automationReplayEmit('automation-control-observed', {
      name,
      controlType,
      controlPointer: pointerText
    });
  }
}

function automationFindObservedControl(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const exactButton = automationObservedControls.get(`Button:${wanted}`);
  if (exactButton) return exactButton;
  const exactToggle = automationObservedControls.get(`Toggle:${wanted}`);
  if (exactToggle) return exactToggle;
  for (const item of automationObservedControls.values()) {
    if (item.name === wanted) return item;
  }
  return null;
}

function automationInvokeInstanceNoArgs(obj, methodName) {
  if (!obj || obj.isNull()) return { ok: false, error: 'control pointer is null' };
  try {
    const klass = api.object_get_class(obj);
    const method = findMethodInHierarchy(klass, methodName, 0);
    if (!method || method.isNull()) {
      return { ok: false, error: `${methodName}()/0 was not found on ${classDisplayName(klass)}` };
    }
    const excp = Memory.alloc(Process.pointerSize);
    excp.writePointer(ptr(0));
    api.runtime_invoke(method, obj, ptr(0), excp);
    const exc = excp.readPointer();
    if (!exc.isNull()) return { ok: false, error: `${methodName} raised ${pstr(exc)}` };
    return { ok: true, error: '' };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function automationReplayButton(control) {
  let result = automationInvokeInstanceNoArgs(control, 'Press');
  if (result.ok) return { ...result, method: 'Button.Press' };

  // Some Unity UI builds inline/remove Press(). Fall back to invoking the
  // ButtonClickedEvent, which is what Press() ultimately dispatches.
  try {
    const onClick = automationInvokeNoArgs(control, 'get_onClick');
    if (!onClick || onClick.isNull()) return { ok: false, method: 'Button.onClick.Invoke', error: result.error };
    const invokeResult = automationInvokeInstanceNoArgs(onClick, 'Invoke');
    return { ...invokeResult, method: 'Button.onClick.Invoke' };
  } catch (error) {
    return { ok: false, method: 'Button.onClick.Invoke', error: String(error) };
  }
}

function automationReplayToggle(control) {
  const result = automationInvokeInstanceNoArgs(control, 'InternalToggle');
  return { ...result, method: 'Toggle.InternalToggle' };
}

function automationProcessReplayQueue() {
  if (!automationReplayQueue.length) return;
  const item = automationReplayQueue.shift();
  automationReplaySequence += 1;
  const observed = automationFindObservedControl(item.name);
  if (!observed) {
    automationReplayEmit('automation-replay-result', {
      replayId: automationReplaySequence,
      name: item.name,
      ok: false,
      error: 'Control has not been observed in this attached game session yet.',
      observedControls: Array.from(automationObservedControls.values()).map(value => ({
        name: value.name,
        controlType: value.controlType
      }))
    });
    return;
  }

  let currentName = '';
  try { currentName = automationUnityObjectName(observed.control); } catch (_) {}
  if (currentName && currentName !== observed.name) {
    automationReplayEmit('automation-replay-result', {
      replayId: automationReplaySequence,
      name: item.name,
      controlType: observed.controlType,
      ok: false,
      error: `Cached control changed identity to ${currentName}; refusing stale replay.`
    });
    return;
  }

  let result;
  if (observed.controlType === 'Button') {
    result = automationReplayButton(observed.control);
  } else if (observed.controlType === 'Toggle') {
    result = automationReplayToggle(observed.control);
  } else {
    result = { ok: false, method: '', error: `Unsupported control type ${observed.controlType}` };
  }

  automationReplayEmit('automation-replay-result', {
    replayId: automationReplaySequence,
    name: observed.name,
    controlType: observed.controlType,
    controlPointer: observed.pointerText,
    ok: !!result.ok,
    method: result.method || '',
    error: result.error || ''
  });
}

function automationAttachReplayHook(method, callback) {
  let attached = 0;
  for (const address of [method.primary, method.virtualp]) {
    if (!address || address.isNull()) continue;
    const key = address.toString();
    if (automationReplayHookAddresses.has(key)) continue;
    automationReplayHookAddresses.add(key);
    Interceptor.attach(address, callback);
    attached += 1;
  }
  return attached;
}

function installAutomationReplayHooks() {
  if (automationReplayInstalled || !api) return false;
  let controlHooks = 0;
  let mainThreadHooks = 0;

  const buttonClass = findClass('UnityEngine.UI', 'Button');
  if (buttonClass) {
    for (const method of enumerateMethods(buttonClass.klass, 'OnPointerClick', 1)) {
      controlHooks += automationAttachReplayHook(method, {
        onEnter(args) { automationRememberControl('Button', args[0]); }
      });
    }
  }

  const toggleClass = findClass('UnityEngine.UI', 'Toggle');
  if (toggleClass) {
    for (const method of enumerateMethods(toggleClass.klass, 'OnPointerClick', 1)) {
      controlHooks += automationAttachReplayHook(method, {
        onEnter(args) {
          automationRememberControl('Toggle', args[0]);
          if (automationTraceEnabled) {
            const name = automationUnityObjectName(args[0]);
            automationEmit('automation-toggle-click', {
              name,
              controlType: 'Toggle',
              controlPointer: pstr(args[0]),
              frames: automationBacktrace(this.context, 14)
            });
          }
        }
      });
    }
  }

  const xLuaManager = findClass('', 'XLuaManager');
  if (xLuaManager) {
    for (const method of enumerateMethods(xLuaManager.klass, 'Update', 0)) {
      mainThreadHooks += automationAttachReplayHook(method, {
        onEnter() { automationProcessReplayQueue(); }
      });
    }
  }

  automationReplayInstalled = controlHooks > 0 && mainThreadHooks > 0;
  if (automationReplayInstalled) {
    automationReplayEmit('automation-replay-ready', {
      controlHooks,
      mainThreadHooks,
      supports: ['Button.Press', 'Toggle.InternalToggle']
    });
  }
  return automationReplayInstalled;
}

function automationEnsureReplayInstalled() {
  if (automationReplayInstalled) {
    if (automationReplayTimer !== null) {
      clearInterval(automationReplayTimer);
      automationReplayTimer = null;
    }
    return;
  }
  try { installAutomationReplayHooks(); } catch (error) {
    if (automationTraceEnabled) {
      automationReplayEmit('automation-trace-error', {
        stage: 'unity-replay-install',
        error: String(error)
      });
    }
  }
}

function automationListenForReplay() {
  recv('automation-replay-control', function (message) {
    const payload = message && message.payload ? message.payload : {};
    const name = String(payload.name || '').trim();
    if (name) {
      automationReplayQueue.push({ name, queuedAt: automationNow() });
      automationReplayEmit('automation-replay-queued', { name, queueDepth: automationReplayQueue.length });
    }
    automationListenForReplay();
  });
}

automationListenForReplay();
setImmediate(automationEnsureReplayInstalled);
automationReplayTimer = setInterval(automationEnsureReplayInstalled, 500);
