  sequence += 1;
  send({
    kind: 'lua-stack-response',
    sequence,
    command,
    sourceHook: `XLuaManager.DispatchResponse(${signature})`,
    rawDataPointer: pstr(tableArgument),
    objectClass: 'LuaStackTable',
    json: JSON.stringify(payload),
    jsonOk: true,
    jsonError: '',
    luaStack: {
      oldTop: parsed.oldTop,
      currentTop: parsed.currentTop,
      index: parsed.index,
      state: pstr(parsed.L)
    },
    observedAt: new Date().toISOString()
  });
}

function installHooks() {
  const extensionController = findClass('Sfs2X.Controllers', 'ExtensionController');
  if (!extensionController) throw new Error('ExtensionController class not found');

  lua = resolveLuaApi();
  send({ kind: 'lua-api-ready', signatures: lua.signatures });

  for (const method of enumerateMethods(extensionController.klass, 'HandleMessage', 1)) {
    forMethodPointers(method, 'ExtensionController.HandleMessage', {
      onEnter(args) {
        const count = bump('HandleMessage');
        if (captureEnabled && (count <= 5 || count % 25 === 0)) {
          send({
            kind: 'hook-hit',
            hook: 'HandleMessage',
            count,
            objectClass: objectClassName(args[1]),
            observedAt: new Date().toISOString()
          });
        }
      }
    });
  }

  for (const method of enumerateMethods(extensionController.klass, 'HandleExtensionResponse', 2)) {
    forMethodPointers(method, 'ExtensionController.HandleExtensionResponse', {
      onEnter(args) {
        bump('HandleExtensionResponse');
        if (!captureEnabled) return;
        sendConverted(
          'extension-response',
          readManagedString(args[1]),
          args[2],
          'HandleExtensionResponse'
        );
      }
    });
  }

  const xLuaManager = findClass('', 'XLuaManager');
  if (xLuaManager) {
    for (const method of enumerateMethods(xLuaManager.klass, 'Update', 0)) {
      forMethodPointers(method, 'XLuaManager.Update', {
        onEnter() { bump('XLuaManager.Update'); }
      });
    }

    for (const method of enumerateMethods(xLuaManager.klass, 'DispatchResponse', 2)) {
      const signature = method.paramTypes.join(', ');
      const isStackTable = signature.indexOf('LuaStackTable') >= 0;
      const hookName = isStackTable
        ? 'XLuaManager.DispatchResponse.LuaStackTable'
        : 'XLuaManager.DispatchResponse.LuaTable';

      forMethodPointers(method, hookName, {
        onEnter(args) {
          const counterName = isStackTable
            ? 'DispatchResponse.LuaStackTable'
            : 'DispatchResponse.LuaTable';
          const count = bump(counterName);
          const command = readManagedString(args[1]);
          if (!captureEnabled) return;

          if (typeof traceAutomationResponse === 'function') {
            try { traceAutomationResponse(command); } catch (_) {}
          }

          send({
            kind: 'dispatch-response',
            count,
            command,
            overload: signature,
            objectClass: isStackTable ? 'LuaStackTable(value-type)' : objectClassName(args[2]),
            objectPointer: pstr(args[2]),
            discoveryAll: !!captureAllResponses,
            observedAt: new Date().toISOString()
          });

          if (!shouldCaptureCommand(command)) return;

          if (isStackTable) {
            try {
              dumpLuaStackTable(command, args[2], signature);
              bump('LuaStackTable.dumpsSucceeded');
            } catch (error) {
              bump('LuaStackTable.dumpsFailed');
              log('error', `LuaStackTable dump failed for ${command}: ${error.stack || error}`, {
                argument: pstr(args[2]),
                signature
              });
            }
          } else {
            // Keep the old managed-object route as a fallback for builds that use XLua.LuaTable.
            sendConverted('lua-object-response', command, args[2], `DispatchResponse(${signature})`);
          }
        }
      });
    }
  }

  const converter = findClass('', 'SFSObjectExtention');
  if (converter) {
    for (const method of enumerateMethods(converter.klass, 'ToLuaTable', 2)) {
      forMethodPointers(method, 'SFSObjectExtention.ToLuaTable', {
        onEnter(args) {
          const count = bump('ToLuaTable');
          if (!captureEnabled) return;
          const source = args[0];
          const className = objectClassName(source);
          if (className.indexOf('SFSObject') >= 0 || className.indexOf('ISFSObject') >= 0) {
            sendConverted('sfs-conversion', '', source, 'SFSObjectExtention.ToLuaTable');
          } else if (count <= 3) {
            send({
              kind: 'hook-hit',
              hook: 'ToLuaTable-nonobject',
              count,
              objectClass: className,
              observedAt: new Date().toISOString()
            });
          }
        }
      });
    }
  }

  if (typeof installAutomationTraceHooks === 'function') {
    try {
      installAutomationTraceHooks();
    } catch (error) {
      log('error', `Automation trace hook installation failed: ${error.stack || error}`);
    }
  }

  hookInstalled = installedHooks.length > 0;
  send({
    kind: 'hook-ready',
    imageName: extensionController.imageName,
    hooks: installedHooks,
    counters
  });
}

function initialize() {
  if (hookInstalled) return;
  try {
    gameAssembly = Process.getModuleByName('GameAssembly.dll');
  } catch (_) {
    return;
  }

  try {
    api = resolveApi(gameAssembly);
    installHooks();
    if (initTimer !== null) {
      clearInterval(initTimer);
      initTimer = null;
    }
  } catch (e) {
    log('error', `Initialization failed: ${e.stack || e}`);
  }
}

rpc.exports = {
  setDiscoveryCapture(enabled) {
    captureAllResponses = !!enabled;
    return { captureAllResponses };
  },
  startCapture() {
    captureEnabled = true;
    return { captureEnabled, captureAllResponses, hookInstalled, counters, installedHooks };
  },
  stopCapture() {
    captureEnabled = false;
    const previousDiscoveryAll = !!captureAllResponses;
    captureAllResponses = false;
    return { captureEnabled, captureAllResponses, previousDiscoveryAll, hookInstalled, counters, installedHooks };
  },
  getStatus() {
    return { captureEnabled, captureAllResponses, hookInstalled, counters, installedHooks, sequence };
  },
  startAutomationTrace() {
    return typeof startAutomationTrace === 'function' ? startAutomationTrace() : { enabled: false, error: 'trace unavailable' };
  },
  stopAutomationTrace() {
    return typeof stopAutomationTrace === 'function' ? stopAutomationTrace() : { enabled: false, error: 'trace unavailable' };
  },
  getAutomationTraceStatus() {
    return typeof getAutomationTraceStatus === 'function' ? getAutomationTraceStatus() : { enabled: false, error: 'trace unavailable' };
  }
};

setImmediate(initialize);
initTimer = setInterval(initialize, 1000);