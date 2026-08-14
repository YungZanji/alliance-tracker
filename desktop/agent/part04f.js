
// Fresh-session control catalogue.
// Sequence Studio replay works immediately after recording because the manual click
// hooks already know the exact Button/Toggle pointer. Unattended replay starts with
// an empty observation cache, so remember UI Selectables as Unity enables them.
// This makes dynamically-created ranking toggles available without requiring one
// manual click first.
let automationLifecycleCatalogInstalled = false;
const automationLifecycleHookAddresses = new Set();

function automationSelectableType(control) {
  if (!control || control.isNull()) return '';
  try {
    const klass = api.object_get_class(control);
    const display = String(classDisplayName(klass) || '');
    if (display === 'UnityEngine.UI.Button' || display.endsWith('.Button')) return 'Button';
    if (display === 'UnityEngine.UI.Toggle' || display.endsWith('.Toggle')) return 'Toggle';
  } catch (_) {}
  return '';
}

function automationRememberEnabledSelectable(control) {
  try {
    const controlType = automationSelectableType(control);
    if (!controlType) return;
    const name = automationUnityObjectName(control);
    if (!name) return;
    automationRememberControl(controlType, control);
    automationReplayEmit('automation-control-auto-observed', {
      name,
      controlType,
      controlPointer: pstr(control),
      source: 'Selectable.OnEnable'
    });
  } catch (error) {
    automationReplayEmit('automation-lifecycle-catalog-error', {
      error: String(error)
    });
  }
}

function automationAttachLifecycleMethod(method) {
  let attached = 0;
  for (const address of [method.primary, method.virtualp]) {
    if (!address || address.isNull()) continue;
    const key = address.toString();
    if (automationLifecycleHookAddresses.has(key)) continue;
    automationLifecycleHookAddresses.add(key);
    Interceptor.attach(address, {
      onEnter(args) {
        automationRememberEnabledSelectable(args[0]);
      }
    });
    attached += 1;
  }
  return attached;
}

function installAutomationLifecycleCatalog() {
  if (automationLifecycleCatalogInstalled || !api) return false;
  let hooks = 0;
  for (const className of ['Selectable', 'Button', 'Toggle']) {
    const found = findClass('UnityEngine.UI', className);
    if (!found) continue;
    for (const method of enumerateMethods(found.klass, 'OnEnable', 0)) {
      hooks += automationAttachLifecycleMethod(method);
    }
  }
  automationLifecycleCatalogInstalled = hooks > 0;
  automationReplayEmit('automation-lifecycle-catalog-ready', {
    ok: automationLifecycleCatalogInstalled,
    hooks,
    source: 'UnityEngine.UI Selectable/Button/Toggle OnEnable'
  });
  return automationLifecycleCatalogInstalled;
}

setImmediate(installAutomationLifecycleCatalog);
setInterval(function () {
  if (!automationLifecycleCatalogInstalled) {
    try { installAutomationLifecycleCatalog(); } catch (_) {}
  }
}, 750);
