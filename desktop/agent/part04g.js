
// Fresh-session typed replay resolver.
// Sequence Studio JSON already records both controlType and GameObject name. Earlier
// automation discarded controlType and asked GameObject.Find(name) for the first
// matching object, which is ambiguous when Last Z has duplicate names such as
// Toggle3. This layer can receive name+controlType and resolves the actual loaded
// Button/Toggle component first, then falls back to the older resolver.
let automationResourcesFindAllMethod = ptr(0);

function automationResolveResourcesFindAll() {
  if (automationResourcesFindAllMethod && !automationResourcesFindAllMethod.isNull()) {
    return automationResourcesFindAllMethod;
  }
  const resources = findClass('UnityEngine', 'Resources');
  if (!resources) throw new Error('UnityEngine.Resources class was not found');
  const candidates = enumerateMethods(resources.klass, 'FindObjectsOfTypeAll', 1)
    .filter(method => method.paramTypes.length === 1 && method.paramTypes[0].indexOf('System.Type') >= 0);
  if (!candidates.length) throw new Error('Resources.FindObjectsOfTypeAll(System.Type) was not found');
  automationResourcesFindAllMethod = candidates[0].method;
  return automationResourcesFindAllMethod;
}

function automationManagedArrayPointers(arrayObject, maxItems) {
  if (!arrayObject || arrayObject.isNull()) return [];
  const ps = Process.pointerSize;
  const lengthAddress = arrayObject.add(ps * 3);
  let length = 0;
  try {
    if (ps === 8) {
      const raw = lengthAddress.readU64();
      length = typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw.toString());
    } else {
      length = lengthAddress.readU32();
    }
  } catch (_) {
    return [];
  }
  if (!Number.isFinite(length) || length < 0 || length > 50000) return [];
  const count = Math.min(length, maxItems || 5000);
  const vector = arrayObject.add(ps * 4);
  const out = [];
  for (let index = 0; index < count; index++) {
    try {
      const item = vector.add(index * ps).readPointer();
      if (item && !item.isNull()) out.push(item);
    } catch (_) {}
  }
  return out;
}

function automationResolveTypedComponent(name, expectedType) {
  const wanted = String(name || '').trim();
  const typeName = String(expectedType || '').trim();
  if (!wanted || (typeName !== 'Button' && typeName !== 'Toggle')) return null;

  // Prefer a real control pointer already learned in this process, but require the
  // recorded type as well as the recorded name.
  try {
    const cached = automationFindObservedControlOriginal(wanted);
    if (cached && cached.controlType === typeName) {
      automationLastControlResolveError = '';
      return cached;
    }
  } catch (_) {}

  try {
    const typeObject = automationTypeObjectFor(typeName);
    if (!typeObject || typeObject.isNull()) {
      throw new Error(`Could not resolve UnityEngine.UI.${typeName} System.Type`);
    }
    const findAll = automationResolveResourcesFindAll();
    const arrayObject = automationInvokeMethod(findAll, ptr(0), [typeObject]);
    const loaded = automationManagedArrayPointers(arrayObject, 10000);
    const candidates = [];

    for (const control of loaded) {
      let candidateName = '';
      try { candidateName = automationUnityObjectName(control); } catch (_) {}
      if (candidateName !== wanted) continue;
      candidates.push(control);
    }

    if (candidates.length) {
      // A component-level match is already substantially stronger than
      // GameObject.Find(name), because Resources was filtered to the exact recorded
      // UI component type before matching the GameObject name.
      const control = candidates[0];
      automationRememberControl(typeName, control);
      automationLastControlResolveError = '';
      automationReplayEmit('automation-control-resolve', {
        name: wanted,
        controlType: typeName,
        controlPointer: pstr(control),
        ok: true,
        candidateCount: candidates.length,
        loadedTypeCount: loaded.length,
        method: 'Resources.FindObjectsOfTypeAll(Type) + component name filter'
      });
      const remembered = automationFindObservedControlOriginal(wanted);
      if (remembered && remembered.controlType === typeName) return remembered;
      return {
        key: `${typeName}:${wanted}`,
        name: wanted,
        controlType: typeName,
        control,
        pointerText: pstr(control),
        observedAt: automationNow()
      };
    }

    automationLastControlResolveError = `No loaded UnityEngine.UI.${typeName} component has GameObject name ${wanted}. ` +
      `Scanned ${loaded.length} loaded ${typeName} component(s).`;
    automationReplayEmit('automation-control-resolve', {
      name: wanted,
      controlType: typeName,
      ok: false,
      loadedTypeCount: loaded.length,
      error: automationLastControlResolveError,
      method: 'Resources.FindObjectsOfTypeAll(Type) + component name filter'
    });
  } catch (error) {
    automationLastControlResolveError = `Typed component resolver failed for ${typeName} ${wanted}: ${String(error)}`;
    automationReplayEmit('automation-control-resolve', {
      name: wanted,
      controlType: typeName,
      ok: false,
      error: automationLastControlResolveError,
      method: 'typed component scan'
    });
  }
  return null;
}

function automationResolveReplayItem(item) {
  if (!item) return null;
  const expectedType = String(item.controlType || '').trim();
  if (expectedType === 'Button' || expectedType === 'Toggle') {
    const typed = automationResolveTypedComponent(item.name, expectedType);
    if (typed) return typed;
  }
  return automationFindObservedControl(item.name);
}

// Generic Sequence Studio automation uses this message so the recorded controlType
// survives the trip from JSON -> desktop -> Frida. Legacy replay keeps using the
// original message and remains backward compatible.
function automationListenForTypedReplay() {
  recv('automation-replay-control-v2', function (message) {
    const payload = message && message.payload ? message.payload : {};
    const name = String(payload.name || '').trim();
    const controlType = String(payload.controlType || '').trim();
    if (name) {
      automationReplayQueue.push({
        name,
        controlType,
        queuedAt: automationNow()
      });
      automationReplayEmit('automation-replay-queued', {
        name,
        controlType,
        queueDepth: automationReplayQueue.length,
        protocol: 2
      });
    }
    automationListenForTypedReplay();
  });
}
automationListenForTypedReplay();

// Final queue worker for 1.2.7. Probe-only legacy items remain non-destructive.
automationProcessReplayQueue = function () {
  if (!automationReplayQueue.length) return;
  const item = automationReplayQueue.shift();
  automationReplaySequence += 1;
  const observed = automationResolveReplayItem(item);

  if (item && item.probeOnly) {
    if (!observed) {
      const detail = automationLastControlResolveError || 'Control is not currently available in the attached game session.';
      automationReplayEmit('automation-probe-result', {
        probeId: automationReplaySequence,
        name: item.name,
        ok: false,
        error: detail
      });
      return;
    }
    automationReplayEmit('automation-probe-result', {
      probeId: automationReplaySequence,
      name: item.name,
      controlType: observed.controlType || '',
      controlPointer: observed.pointerText || '',
      ok: true,
      method: 'resolved without invocation'
    });
    return;
  }

  if (!observed) {
    const detail = automationLastControlResolveError || 'Control is not currently available in the attached game session.';
    automationReplayEmit('automation-replay-result', {
      replayId: automationReplaySequence,
      name: item.name,
      requestedControlType: item.controlType || '',
      ok: false,
      error: detail,
      availabilityFailure: true,
      observedControls: Array.from(automationObservedControls.values()).map(value => ({
        name: value.name,
        controlType: value.controlType
      }))
    });
    return;
  }

  if (item.controlType && observed.controlType !== item.controlType) {
    automationReplayEmit('automation-replay-result', {
      replayId: automationReplaySequence,
      name: item.name,
      requestedControlType: item.controlType,
      controlType: observed.controlType,
      ok: false,
      error: `Resolved ${observed.controlType} but JSON requires ${item.controlType}; refusing ambiguous replay.`,
      availabilityFailure: true
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
      error: `Cached control changed identity to ${currentName}; refusing stale replay.`,
      availabilityFailure: false
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
    requestedControlType: item.controlType || '',
    controlType: observed.controlType,
    controlPointer: observed.pointerText,
    ok: !!result.ok,
    method: result.method || '',
    error: result.error || '',
    availabilityFailure: false
  });
};

setImmediate(function () {
  automationReplayEmit('automation-replay-diagnostics-ready', {
    resolverErrors: true,
    availabilityFailureFlag: true,
    probeOnlyPreserved: true,
    typedReplayProtocol: 2,
    typedComponentScan: 'Resources.FindObjectsOfTypeAll(Type)'
  });
});
