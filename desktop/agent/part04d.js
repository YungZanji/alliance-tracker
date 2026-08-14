
// Control-sequence observation layer.
// Each manually clicked Button/Toggle gets a process-local observation id tied to
// its exact managed control pointer. Sequence Studio can replay @obs:<id> in the
// same attached game session, while still retaining the GameObject name as a
// portable fallback for later sessions.
let automationSequenceObservationId = 0;
const automationSequenceObservationById = new Map();
const automationSequenceObservationIdByPointer = new Map();

function automationSequencePointerKey(controlType, pointerText) {
  return `${String(controlType || 'Control')}:${String(pointerText || '')}`;
}

function automationEnsureSequenceObservation(controlType, name, pointerText, control) {
  const key = automationSequencePointerKey(controlType, pointerText);
  let id = automationSequenceObservationIdByPointer.get(key) || null;
  if (!id) {
    automationSequenceObservationId += 1;
    id = automationSequenceObservationId;
    automationSequenceObservationIdByPointer.set(key, id);
    automationSequenceObservationById.set(id, {
      observationId: id,
      controlType: String(controlType || 'Control'),
      name: String(name || ''),
      pointerText: String(pointerText || ''),
      control: control || ptr(0),
      observedAt: automationNow()
    });
    automationReplayEmit('automation-control-catalogued', {
      observationId: id,
      controlType: String(controlType || 'Control'),
      name: String(name || ''),
      controlPointer: String(pointerText || '')
    });
  } else if (control && !control.isNull()) {
    const current = automationSequenceObservationById.get(id);
    if (current) {
      current.control = control;
      current.name = String(name || current.name || '');
      current.controlType = String(controlType || current.controlType || 'Control');
    }
  }
  return id;
}

const automationRememberControlBeforeSequence = automationRememberControl;
automationRememberControl = function (controlType, control) {
  automationRememberControlBeforeSequence(controlType, control);
  try {
    if (!control || control.isNull()) return;
    const name = automationUnityObjectName(control);
    const pointerText = pstr(control);
    automationEnsureSequenceObservation(controlType, name, pointerText, control);
  } catch (_) {}
};

const automationEmitBeforeSequence = automationEmit;
automationEmit = function (kind, payload) {
  const item = payload ? { ...payload } : {};
  try {
    if (kind === 'automation-click') {
      item.observationId = automationEnsureSequenceObservation(
        'Button',
        item.buttonName || '',
        item.buttonPointer || '',
        ptr(0)
      );
    } else if (kind === 'automation-toggle-click') {
      item.observationId = automationEnsureSequenceObservation(
        'Toggle',
        item.name || '',
        item.controlPointer || '',
        ptr(0)
      );
    }
  } catch (_) {}
  return automationEmitBeforeSequence(kind, item);
};

const automationFindObservedControlBeforeSequence = automationFindObservedControl;
automationFindObservedControl = function (name) {
  const wanted = String(name || '').trim();
  if (wanted.indexOf('@obs:') === 0) {
    const id = Number(wanted.substring(5));
    const item = automationSequenceObservationById.get(id);
    if (!item || !item.control || item.control.isNull()) return null;
    let currentName = '';
    try { currentName = automationUnityObjectName(item.control); } catch (_) {}
    if (currentName && item.name && currentName !== item.name) return null;
    return {
      key: `${item.controlType}:${item.name}`,
      name: item.name,
      controlType: item.controlType,
      control: item.control,
      pointerText: item.pointerText,
      observedAt: item.observedAt,
      observationId: id
    };
  }
  return automationFindObservedControlBeforeSequence(name);
};

setImmediate(function () {
  automationReplayEmit('automation-sequence-ready', {
    mode: 'exact observed pointer + GameObject-name fallback'
  });
});
