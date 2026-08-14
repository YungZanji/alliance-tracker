
// Fallback request inspector. Some Last Z request objects are constructed or
// reused on a path that does not cross the ExtensionRequest constructor hook
// while tracing is enabled. Inspect the actual IRequest handed to SmartFox.Send
// and recover command/parameter properties from its runtime getters instead.
let automationFallbackInstalled = false;
let automationFallbackTimer = null;
const automationFallbackAddresses = new Set();

function automationInvokeMethodInfo(obj, methodInfo) {
  if (!obj || obj.isNull() || !methodInfo || !methodInfo.method || methodInfo.method.isNull()) {
    return { ok: false, value: ptr(0), error: 'invalid method/object' };
  }
  try {
    const excp = Memory.alloc(Process.pointerSize);
    excp.writePointer(ptr(0));
    const returned = api.runtime_invoke(methodInfo.method, obj, ptr(0), excp);
    const exc = excp.readPointer();
    if (!exc.isNull()) return { ok: false, value: ptr(0), error: `exception ${pstr(exc)}` };
    return { ok: true, value: returned, error: '' };
  } catch (error) {
    return { ok: false, value: ptr(0), error: String(error) };
  }
}

function automationReadableGetterValue(obj, methodInfo) {
  const invoked = automationInvokeMethodInfo(obj, methodInfo);
  if (!invoked.ok || !invoked.value || invoked.value.isNull()) {
    return { ok: false, text: '', json: '', className: '', error: invoked.error || 'null result' };
  }
  const returnType = String(methodInfo.returnType || '');
  if (returnType.indexOf('System.String') >= 0 || returnType === 'string') {
    return { ok: true, text: readManagedString(invoked.value), json: '', className: 'System.String', error: '' };
  }
  const converted = automationRequestPayload(invoked.value);
  return {
    ok: converted.ok,
    text: '',
    json: converted.json || '',
    className: converted.className || objectClassName(invoked.value),
    error: converted.error || ''
  };
}

function automationInspectRequestAtSend(request, context) {
  if (!automationTraceEnabled || !request || request.isNull()) return;
  const pointer = pstr(request);
  if (automationRequestByPointer.has(pointer)) return;

  const klass = api.object_get_class(request);
  const className = classDisplayName(klass);
  const methods = enumerateMethods(klass, null, 0);
  const interesting = methods.filter(method => {
    const name = String(method.name || '').toLowerCase();
    return name.startsWith('get_') || name.indexOf('cmd') >= 0 || name.indexOf('command') >= 0 ||
      name.indexOf('param') >= 0 || name.indexOf('data') >= 0 || name.indexOf('room') >= 0;
  });

  let command = '';
  let payloadJson = '';
  let payloadClass = '';
  let payloadOk = false;
  let payloadError = '';
  const getterResults = [];

  for (const method of interesting.slice(0, 24)) {
    const result = automationReadableGetterValue(request, method);
    getterResults.push({
      name: method.name,
      returnType: method.returnType,
      ok: result.ok,
      text: result.text,
      json: result.json,
      className: result.className,
      error: result.error
    });
    const lname = String(method.name || '').toLowerCase();
    if (!command && result.text && (lname.indexOf('cmd') >= 0 || lname.indexOf('command') >= 0)) {
      command = result.text;
    }
    if (!payloadJson && result.json && (lname.indexOf('param') >= 0 || lname.indexOf('data') >= 0)) {
      payloadJson = result.json;
      payloadClass = result.className;
      payloadOk = result.ok;
      payloadError = result.error;
    }
  }

  // Ignore ordinary ping/handshake traffic unless it exposed a command. This keeps
  // the training trace focused on extension requests initiated by UI actions.
  if (!command && className.indexOf('ExtensionRequest') < 0) return;

  const nowMs = automationEpoch();
  const click = automationClickContext(nowMs);
  automationRequestSequence += 1;
  const meta = {
    requestId: automationRequestSequence,
    requestPointer: pointer,
    requestClass: className,
    command,
    payloadJson,
    payloadClass,
    payloadOk,
    payloadError,
    constructorSignature: '<send-time inspection>',
    createdAt: automationNow(),
    createdEpochMs: nowMs,
    sentAt: automationNow(),
    sentEpochMs: nowMs,
    responseAt: '',
    clickId: click ? click.clickId : null,
    buttonName: click ? click.buttonName : '',
    clickAgeMs: click ? click.clickAgeMs : null,
    fallbackInspection: true,
    getterResults,
    frames: automationBacktrace(context, 24)
  };
  automationRememberRequest(meta);
  automationEmit('automation-request-created', meta);
}

function installAutomationSendInspectionFallback() {
  if (automationFallbackInstalled || !api) return false;
  const smartFox = findClass('Sfs2X', 'SmartFox');
  if (!smartFox) return false;
  let attached = 0;
  for (const method of enumerateMethods(smartFox.klass, 'Send', 1)) {
    for (const address of [method.primary, method.virtualp]) {
      if (!address || address.isNull()) continue;
      const key = address.toString();
      if (automationFallbackAddresses.has(key)) continue;
      automationFallbackAddresses.add(key);
      Interceptor.attach(address, {
        onEnter(args) {
          try { automationInspectRequestAtSend(args[1], this.context); }
          catch (error) {
            if (automationTraceEnabled) {
              automationEmit('automation-trace-error', {
                stage: 'send-time-inspection',
                requestClass: objectClassName(args[1]),
                error: String(error),
                frames: automationBacktrace(this.context, 12)
              });
            }
          }
        }
      });
      attached += 1;
    }
  }
  automationFallbackInstalled = attached > 0;
  if (automationFallbackInstalled) {
    send({ kind: 'automation-request-inspector-ready', hooks: attached, observedAt: automationNow() });
  }
  return automationFallbackInstalled;
}

function automationEnsureFallbackInstalled() {
  if (automationFallbackInstalled) {
    if (automationFallbackTimer !== null) {
      clearInterval(automationFallbackTimer);
      automationFallbackTimer = null;
    }
    return;
  }
  try { installAutomationSendInspectionFallback(); } catch (_) {}
}

setImmediate(automationEnsureFallbackInstalled);
automationFallbackTimer = setInterval(automationEnsureFallbackInstalled, 500);
