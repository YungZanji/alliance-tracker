
// Automation discovery layer. This observes the client-side path used by a normal
// manual click so we can build deterministic replay profiles later without guessing
// protocol messages or payloads.
let automationTraceEnabled = false;
let automationTraceSequence = 0;
let automationClickSequence = 0;
let automationRequestSequence = 0;
let automationLastClick = null;
const automationRequestByPointer = new Map();
const automationRecentRequests = [];
const AUTOMATION_REQUEST_WINDOW_MS = 30000;
const AUTOMATION_CLICK_WINDOW_MS = 8000;

function automationNow() {
  return new Date().toISOString();
}

function automationEpoch() {
  return Date.now();
}

function automationBacktrace(context, limit) {
  try {
    return Thread.backtrace(context, Backtracer.ACCURATE)
      .slice(0, limit || 18)
      .map(address => {
        let module = null;
        try { module = Process.findModuleByAddress(address); } catch (_) {}
        let symbol = '';
        try { symbol = DebugSymbol.fromAddress(address).toString(); } catch (_) {}
        return {
          address: address.toString(),
          module: module ? module.name : '',
          offset: module ? address.sub(module.base).toString() : '',
          symbol
        };
      });
  } catch (_) {
    return [];
  }
}

function automationInvokeNoArgs(obj, methodName) {
  if (!obj || obj.isNull()) return ptr(0);
  try {
    const klass = api.object_get_class(obj);
    const method = findMethodInHierarchy(klass, methodName, 0);
    if (!method || method.isNull()) return ptr(0);
    const excp = Memory.alloc(Process.pointerSize);
    excp.writePointer(ptr(0));
    const returned = api.runtime_invoke(method, obj, ptr(0), excp);
    if (!excp.readPointer().isNull()) return ptr(0);
    return returned;
  } catch (_) {
    return ptr(0);
  }
}

function automationUnityObjectName(obj) {
  try {
    const gameObject = automationInvokeNoArgs(obj, 'get_gameObject');
    const target = gameObject && !gameObject.isNull() ? gameObject : obj;
    const nameObject = automationInvokeNoArgs(target, 'get_name');
    return nameObject && !nameObject.isNull() ? readManagedString(nameObject) : '';
  } catch (_) {
    return '';
  }
}

function automationEmit(kind, payload) {
  if (!automationTraceEnabled) return;
  automationTraceSequence += 1;
  send({
    kind,
    traceSequence: automationTraceSequence,
    observedAt: automationNow(),
    ...(payload || {})
  });
}

function automationClickContext(nowMs) {
  if (!automationLastClick) return null;
  const age = nowMs - automationLastClick.epochMs;
  if (age < 0 || age > AUTOMATION_CLICK_WINDOW_MS) return null;
  return {
    clickId: automationLastClick.clickId,
    buttonName: automationLastClick.buttonName,
    clickAgeMs: age
  };
}

function automationRememberRequest(meta) {
  automationRequestByPointer.set(meta.requestPointer, meta);
  automationRecentRequests.push(meta);
  const cutoff = automationEpoch() - AUTOMATION_REQUEST_WINDOW_MS;
  while (automationRecentRequests.length && automationRecentRequests[0].createdEpochMs < cutoff) {
    const old = automationRecentRequests.shift();
    if (old && automationRequestByPointer.get(old.requestPointer) === old) {
      automationRequestByPointer.delete(old.requestPointer);
    }
  }
}

function automationRequestPayload(obj) {
  if (!obj || obj.isNull()) return { ok: true, json: '{}', className: '<null>' };
  try {
    const converted = invokeToJson(obj);
    return {
      ok: !!converted.ok,
      json: converted.json || '',
      className: converted.className || objectClassName(obj),
      error: converted.error || ''
    };
  } catch (error) {
    return { ok: false, json: '', className: objectClassName(obj), error: String(error) };
  }
}

function installAutomationTraceHooks() {
  let hookCount = 0;

  const buttonClass = findClass('UnityEngine.UI', 'Button');
  if (buttonClass) {
    for (const method of enumerateMethods(buttonClass.klass, 'OnPointerClick', 1)) {
      forMethodPointers(method, 'Automation.UnityButton.OnPointerClick', {
        onEnter(args) {
          if (!automationTraceEnabled) return;
          automationClickSequence += 1;
          const button = args[0];
          const nowMs = automationEpoch();
          const buttonName = automationUnityObjectName(button);
          automationLastClick = {
            clickId: automationClickSequence,
            buttonName,
            buttonPointer: pstr(button),
            epochMs: nowMs
          };
          automationEmit('automation-click', {
            clickId: automationClickSequence,
            buttonName,
            buttonPointer: pstr(button),
            pointerEventClass: objectClassName(args[1]),
            frames: automationBacktrace(this.context, 16)
          });
        }
      });
      hookCount += 1;
    }
  } else {
    log('warning', 'Automation trace: UnityEngine.UI.Button class was not found');
  }

  const extensionRequest = findClass('Sfs2X.Requests', 'ExtensionRequest');
  if (extensionRequest) {
    for (const method of enumerateMethods(extensionRequest.klass, '.ctor', null)) {
      if (!method.paramTypes.length || method.paramTypes[0].indexOf('System.String') < 0) continue;
      forMethodPointers(method, 'Automation.ExtensionRequest.ctor', {
        onEnter(args) {
          if (!automationTraceEnabled) return;
          const nowMs = automationEpoch();
          const command = readManagedString(args[1]);
          const payloadObject = method.paramCount >= 2 ? args[2] : ptr(0);
          const payload = automationRequestPayload(payloadObject);
          automationRequestSequence += 1;
          const requestPointer = pstr(args[0]);
          const click = automationClickContext(nowMs);
          const meta = {
            requestId: automationRequestSequence,
            requestPointer,
            command,
            payloadJson: payload.json,
            payloadClass: payload.className,
            payloadOk: payload.ok,
            payloadError: payload.error || '',
            constructorSignature: `${method.returnType} ${method.name}(${method.paramTypes.join(', ')})`,
            createdAt: automationNow(),
            createdEpochMs: nowMs,
            sentAt: '',
            sentEpochMs: 0,
            responseAt: '',
            clickId: click ? click.clickId : null,
            buttonName: click ? click.buttonName : '',
            clickAgeMs: click ? click.clickAgeMs : null,
            frames: automationBacktrace(this.context, 22)
          };
          automationRememberRequest(meta);
          automationEmit('automation-request-created', meta);
        }
      });
      hookCount += 1;
    }
  } else {
    log('warning', 'Automation trace: Sfs2X.Requests.ExtensionRequest class was not found');
  }

  const smartFox = findClass('Sfs2X', 'SmartFox');
  if (smartFox) {
    for (const method of enumerateMethods(smartFox.klass, 'Send', 1)) {
      forMethodPointers(method, 'Automation.SmartFox.Send', {
        onEnter(args) {
          if (!automationTraceEnabled) return;
          const nowMs = automationEpoch();
          const requestPointer = pstr(args[1]);
          const meta = automationRequestByPointer.get(requestPointer) || null;
          if (meta) {
            meta.sentAt = automationNow();
            meta.sentEpochMs = nowMs;
          }
          automationEmit('automation-request-sent', {
            requestId: meta ? meta.requestId : null,
            requestPointer,
            requestClass: objectClassName(args[1]),
            smartFoxPointer: pstr(args[0]),
            command: meta ? meta.command : '',
            payloadJson: meta ? meta.payloadJson : '',
            payloadClass: meta ? meta.payloadClass : '',
            clickId: meta ? meta.clickId : null,
            buttonName: meta ? meta.buttonName : '',
            clickToSendMs: meta && meta.clickId ? nowMs - meta.createdEpochMs + (meta.clickAgeMs || 0) : null,
            frames: automationBacktrace(this.context, 22)
          });
        }
      });
      hookCount += 1;
    }
  } else {
    log('warning', 'Automation trace: Sfs2X.SmartFox class was not found');
  }

  send({
    kind: 'automation-trace-ready',
    hookCount,
    buttonHook: !!buttonClass,
    extensionRequestHook: !!extensionRequest,
    smartFoxHook: !!smartFox,
    observedAt: automationNow()
  });
}

function traceAutomationResponse(command) {
  if (!automationTraceEnabled || !command) return;
  const nowMs = automationEpoch();
  let match = null;
  for (let index = automationRecentRequests.length - 1; index >= 0; index--) {
    const candidate = automationRecentRequests[index];
    if (candidate.command !== command || candidate.responseAt) continue;
    const base = candidate.sentEpochMs || candidate.createdEpochMs;
    if (nowMs - base > AUTOMATION_REQUEST_WINDOW_MS) continue;
    match = candidate;
    break;
  }
  if (match) match.responseAt = automationNow();
  automationEmit('automation-response', {
    command,
    requestId: match ? match.requestId : null,
    requestPointer: match ? match.requestPointer : '',
    clickId: match ? match.clickId : null,
    buttonName: match ? match.buttonName : '',
    requestToResponseMs: match ? nowMs - (match.sentEpochMs || match.createdEpochMs) : null,
    clickToResponseMs: match && match.clickId ? nowMs - match.createdEpochMs + (match.clickAgeMs || 0) : null
  });
}

function startAutomationTrace() {
  automationTraceEnabled = true;
  automationTraceSequence = 0;
  automationClickSequence = 0;
  automationRequestSequence = 0;
  automationLastClick = null;
  automationRequestByPointer.clear();
  automationRecentRequests.splice(0, automationRecentRequests.length);
  return getAutomationTraceStatus();
}

function stopAutomationTrace() {
  automationTraceEnabled = false;
  return getAutomationTraceStatus();
}

function getAutomationTraceStatus() {
  return {
    enabled: automationTraceEnabled,
    traceSequence: automationTraceSequence,
    clickCount: automationClickSequence,
    requestCount: automationRequestSequence,
    recentRequests: automationRecentRequests.length
  };
}
