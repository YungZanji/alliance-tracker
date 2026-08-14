
// Active-control resolver for unattended replay.
// Previous replay builds could only invoke controls that had first been observed
// through a manual click. The profile runner needs to resolve the same live Unity
// Button/Toggle directly by its active GameObject name. Resolution happens only
// from automationProcessReplayQueue(), which runs on XLuaManager.Update / the game
// main thread.
let automationResolverApi = null;
let automationGameObjectFindMethod = null;
let automationButtonTypeObject = ptr(0);
let automationToggleTypeObject = ptr(0);
const automationGetComponentMethods = new Map();
let automationLastControlResolveError = '';

const AUTOMATION_CONTROL_TYPE_HINTS = {
  UIMain_icon_AlCompete: 'Button',
  rankBtn: 'Button',
  segment_1: 'Button',
  segment_2: 'Button',
  segment_3: 'Button',
  segment_4: 'Button',
  segment_5: 'Button',
  segment_6: 'Button',
  Toggle1: 'Toggle',
  Toggle2: 'Toggle',
  Toggle3: 'Toggle',
  CheckBox: 'Toggle'
};

function automationGetResolverApi() {
  if (automationResolverApi) return automationResolverApi;
  if (!gameAssembly) return null;
  try {
    automationResolverApi = {
      string_new: new NativeFunction(gameAssembly.getExportByName('il2cpp_string_new'), 'pointer', ['pointer']),
      class_get_type: new NativeFunction(gameAssembly.getExportByName('il2cpp_class_get_type'), 'pointer', ['pointer']),
      type_get_object: new NativeFunction(gameAssembly.getExportByName('il2cpp_type_get_object'), 'pointer', ['pointer'])
    };
    return automationResolverApi;
  } catch (error) {
    automationLastControlResolveError = `Resolver exports unavailable: ${String(error)}`;
    automationReplayEmit('automation-resolver-error', { stage: 'exports', error: String(error) });
    return null;
  }
}

function automationInvokeMethod(method, instance, args) {
  const excp = Memory.alloc(Process.pointerSize);
  excp.writePointer(ptr(0));
  let argv = ptr(0);
  if (args && args.length) {
    argv = Memory.alloc(Process.pointerSize * args.length);
    args.forEach((value, index) => argv.add(index * Process.pointerSize).writePointer(value));
  }
  const returned = api.runtime_invoke(method, instance || ptr(0), argv, excp);
  const exc = excp.readPointer();
  if (!exc.isNull()) throw new Error(`managed invocation raised ${pstr(exc)}`);
  return returned;
}

function automationResolveGameObjectFind() {
  if (automationGameObjectFindMethod && !automationGameObjectFindMethod.isNull()) {
    return automationGameObjectFindMethod;
  }
  const gameObjectClass = findClass('UnityEngine', 'GameObject');
  if (!gameObjectClass) throw new Error('UnityEngine.GameObject class was not found');
  const candidates = enumerateMethods(gameObjectClass.klass, 'Find', 1)
    .filter(method => method.paramTypes.length === 1 && method.paramTypes[0].indexOf('System.String') >= 0);
  if (!candidates.length) throw new Error('GameObject.Find(System.String) was not found');
  automationGameObjectFindMethod = candidates[0].method;
  return automationGameObjectFindMethod;
}

function automationTypeObjectFor(controlType) {
  const resolver = automationGetResolverApi();
  if (!resolver) return ptr(0);
  if (controlType === 'Button' && automationButtonTypeObject && !automationButtonTypeObject.isNull()) {
    return automationButtonTypeObject;
  }
  if (controlType === 'Toggle' && automationToggleTypeObject && !automationToggleTypeObject.isNull()) {
    return automationToggleTypeObject;
  }
  const found = findClass('UnityEngine.UI', controlType);
  if (!found) return ptr(0);
  const type = resolver.class_get_type(found.klass);
  if (!type || type.isNull()) return ptr(0);
  const object = resolver.type_get_object(type);
  if (controlType === 'Button') automationButtonTypeObject = object;
  if (controlType === 'Toggle') automationToggleTypeObject = object;
  return object;
}

function automationGetComponentMethod(gameObject) {
  if (!gameObject || gameObject.isNull()) return ptr(0);
  const klass = api.object_get_class(gameObject);
  const key = pstr(klass);
  const cached = automationGetComponentMethods.get(key);
  if (cached && !cached.isNull()) return cached;
  const candidates = enumerateMethods(klass, 'GetComponent', 1)
    .filter(method => method.paramTypes.length === 1 && method.paramTypes[0].indexOf('System.Type') >= 0);
  if (!candidates.length) return ptr(0);
  const method = candidates[0].method;
  automationGetComponentMethods.set(key, method);
  return method;
}

function automationFindActiveGameObject(name) {
  const resolver = automationGetResolverApi();
  if (!resolver) return ptr(0);
  const utf8 = Memory.allocUtf8String(String(name || ''));
  const managedName = resolver.string_new(utf8);
  if (!managedName || managedName.isNull()) return ptr(0);
  const method = automationResolveGameObjectFind();
  return automationInvokeMethod(method, ptr(0), [managedName]);
}

function automationResolveControlByName(name) {
  const wanted = String(name || '').trim();
  automationLastControlResolveError = '';
  if (!wanted) {
    automationLastControlResolveError = 'The replay step did not contain a control name.';
    return null;
  }
  try {
    const gameObject = automationFindActiveGameObject(wanted);
    if (!gameObject || gameObject.isNull()) {
      automationLastControlResolveError = `GameObject.Find did not find an active object named ${wanted}. The screen may still be loading or the control may live under a different runtime object.`;
      automationReplayEmit('automation-control-resolve', {
        name: wanted,
        ok: false,
        error: automationLastControlResolveError
      });
      return null;
    }

    const hinted = AUTOMATION_CONTROL_TYPE_HINTS[wanted];
    const order = hinted ? [hinted] : ['Button', 'Toggle'];
    const getComponent = automationGetComponentMethod(gameObject);
    if (!getComponent || getComponent.isNull()) throw new Error('GameObject.GetComponent(System.Type) was not found');

    for (const controlType of order) {
      const typeObject = automationTypeObjectFor(controlType);
      if (!typeObject || typeObject.isNull()) continue;
      const control = automationInvokeMethod(getComponent, gameObject, [typeObject]);
      if (!control || control.isNull()) continue;
      automationRememberControl(controlType, control);
      const resolved = automationFindObservedControlOriginal
        ? automationFindObservedControlOriginal(wanted)
        : null;
      automationLastControlResolveError = '';
      automationReplayEmit('automation-control-resolve', {
        name: wanted,
        controlType,
        controlPointer: pstr(control),
        ok: true,
        method: 'GameObject.Find + GetComponent'
      });
      return resolved || {
        key: `${controlType}:${wanted}`,
        name: wanted,
        controlType,
        control,
        pointerText: pstr(control),
        observedAt: automationNow()
      };
    }

    automationLastControlResolveError = `An active GameObject named ${wanted} was found, but it did not expose the expected ${order.join('/')} component.`;
    automationReplayEmit('automation-control-resolve', {
      name: wanted,
      ok: false,
      error: automationLastControlResolveError
    });
  } catch (error) {
    automationLastControlResolveError = `Fresh-session resolver failed for ${wanted}: ${String(error)}`;
    automationReplayEmit('automation-control-resolve', {
      name: wanted,
      ok: false,
      error: automationLastControlResolveError
    });
  }
  return null;
}

// Extend the existing lookup rather than changing the tested replay queue. Because
// automationFindObservedControl() is called from XLuaManager.Update, Unity's Find /
// GetComponent APIs are invoked on the correct main thread.
const automationFindObservedControlOriginal = automationFindObservedControl;
automationFindObservedControl = function (name) {
  const observed = automationFindObservedControlOriginal(name);
  if (observed) {
    automationLastControlResolveError = '';
    return observed;
  }
  return automationResolveControlByName(name);
};

setImmediate(function () {
  automationReplayEmit('automation-resolver-ready', {
    method: 'observed cache + GameObject.Find + GetComponent + OnEnable lifecycle catalogue',
    targets: Object.keys(AUTOMATION_CONTROL_TYPE_HINTS)
  });
});
