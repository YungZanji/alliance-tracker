// Direct Duel request bridge using the same main-thread SafeDoString route proven
// by the Last Z Gambler research harness. This module deliberately exposes only a
// small hard-coded set of read-only Alliance Duel requests; there is no arbitrary
// Lua/command console in Alliance Tracker.

let directDuelManager = ptr(0);
let directDuelSafeDoStringMethod = null;
let directDuelLuaEnv = ptr(0);
let directDuelDoStringMethod = null;
let directDuelStringNew = null;
let directDuelQueue = [];
let directDuelNextRequestId = 1;
let directDuelExecuted = 0;
let directDuelFailed = 0;
let directDuelLastError = '';
let directDuelExecutionRoute = '';
let directDuelLastWaitingEmit = 0;
let directDuelFieldApi = null;

const DIRECT_DUEL_MODES = new Set(['context', 'current', 'previous', 'both']);

function directDuelEmit(kind, payload) {
  send({
    kind,
    observedAt: new Date().toISOString(),
    ...(payload || {})
  });
}

function directDuelStatus() {
  return {
    sharedUpdateHook: true,
    managerReady: !!directDuelManager && !directDuelManager.isNull(),
    manager: pstr(directDuelManager),
    safeDoStringReady: !!directDuelSafeDoStringMethod,
    luaEnvReady: !!directDuelLuaEnv && !directDuelLuaEnv.isNull(),
    luaEnv: pstr(directDuelLuaEnv),
    doStringReady: !!directDuelDoStringMethod,
    executionRoute: directDuelExecutionRoute,
    queued: directDuelQueue.length,
    executed: directDuelExecuted,
    failed: directDuelFailed,
    lastError: directDuelLastError
  };
}

function directDuelRememberManagerInstance(obj) {
  if (!obj || obj.isNull()) return;
  if (!directDuelManager || directDuelManager.isNull()) {
    directDuelManager = obj;
    directDuelEmit('direct-duel-manager-ready', {
      manager: pstr(obj),
      source: 'existing XLuaManager.Update/DispatchResponse hook'
    });
  }
}

function directDuelFindXLuaManagerInstance() {
  if (directDuelManager && !directDuelManager.isNull()) return directDuelManager;
  try {
    const found = findClass('', 'XLuaManager');
    if (!found) {
      directDuelLastError = 'XLuaManager class was not found';
      return ptr(0);
    }
    if (typeof automationGetResolverApi !== 'function' ||
        typeof automationResolveResourcesFindAll !== 'function' ||
        typeof automationManagedArrayPointers !== 'function') {
      directDuelLastError = 'Unity Resources resolver is not ready';
      return ptr(0);
    }
    const resolver = automationGetResolverApi();
    if (!resolver) {
      directDuelLastError = 'Managed resolver API is not ready';
      return ptr(0);
    }
    const type = resolver.class_get_type(found.klass);
    const typeObject = resolver.type_get_object(type);
    const findAll = automationResolveResourcesFindAll();
    const arrayObject = automationInvokeMethod(findAll, ptr(0), [typeObject]);
    const instances = automationManagedArrayPointers(arrayObject, 20);
    if (!instances.length) {
      directDuelLastError = 'Resources.FindObjectsOfTypeAll found no XLuaManager instances';
      return ptr(0);
    }
    directDuelRememberManagerInstance(instances[0]);
    directDuelEmit('direct-duel-manager-sweep', {
      instances: instances.length,
      selected: pstr(instances[0])
    });
    return directDuelManager;
  } catch (error) {
    directDuelLastError = `XLuaManager instance sweep failed: ${error.stack || error}`;
    return ptr(0);
  }
}

function directDuelResolveStringNew() {
  if (directDuelStringNew) return directDuelStringNew;
  if (!gameAssembly) return null;
  try {
    directDuelStringNew = new NativeFunction(
      gameAssembly.getExportByName('il2cpp_string_new'),
      'pointer',
      ['pointer']
    );
    return directDuelStringNew;
  } catch (error) {
    directDuelLastError = `il2cpp_string_new unavailable: ${error}`;
    return null;
  }
}

function directDuelManagedString(value) {
  const stringNew = directDuelResolveStringNew();
  if (!stringNew) throw new Error(directDuelLastError || 'il2cpp_string_new is not ready');
  return stringNew(Memory.allocUtf8String(String(value || '')));
}

function directDuelResolveSafeDoString() {
  if (directDuelSafeDoStringMethod) return directDuelSafeDoStringMethod;
  try {
    const managerClass = findClass('', 'XLuaManager');
    if (!managerClass) {
      directDuelLastError = 'XLuaManager class was not found';
      return null;
    }
    const candidates = enumerateMethods(managerClass.klass, 'SafeDoString', null);
    const chosen = candidates.find(method =>
      method.paramCount === 1 &&
      method.paramTypes.length === 1 &&
      String(method.paramTypes[0] || '').indexOf('System.String') >= 0
    );
    if (!chosen) {
      directDuelLastError = 'XLuaManager.SafeDoString(System.String) was not found';
      return null;
    }
    directDuelSafeDoStringMethod = chosen;
    directDuelEmit('direct-duel-invoker-ready', {
      route: 'XLuaManager.SafeDoString',
      signature: `${chosen.returnType} ${chosen.name}(${chosen.paramTypes.join(', ')})`,
      address: pstr(chosen.primary)
    });
    return chosen;
  } catch (error) {
    directDuelLastError = `SafeDoString resolver failed: ${error.stack || error}`;
    return null;
  }
}

function directDuelBindFieldApi() {
  if (directDuelFieldApi) return directDuelFieldApi;
  try {
    directDuelFieldApi = {
      class_get_fields: new NativeFunction(
        gameAssembly.getExportByName('il2cpp_class_get_fields'), 'pointer', ['pointer', 'pointer']
      ),
      field_get_flags: new NativeFunction(
        gameAssembly.getExportByName('il2cpp_field_get_flags'), 'uint', ['pointer']
      ),
      field_get_type: new NativeFunction(
        gameAssembly.getExportByName('il2cpp_field_get_type'), 'pointer', ['pointer']
      ),
      field_get_value: new NativeFunction(
        gameAssembly.getExportByName('il2cpp_field_get_value'), 'void', ['pointer', 'pointer', 'pointer']
      ),
      field_get_offset: new NativeFunction(
        gameAssembly.getExportByName('il2cpp_field_get_offset'), 'int', ['pointer']
      )
    };
    return directDuelFieldApi;
  } catch (error) {
    directDuelLastError = `LuaEnv field API unavailable: ${error}`;
    return null;
  }
}

function directDuelFindLuaEnvInstance() {
  if (directDuelLuaEnv && !directDuelLuaEnv.isNull()) return directDuelLuaEnv;
  if (!directDuelManager || directDuelManager.isNull()) directDuelFindXLuaManagerInstance();
  if (!directDuelManager || directDuelManager.isNull()) return ptr(0);

  const managerClass = findClass('', 'XLuaManager');
  const fieldApi = directDuelBindFieldApi();
  if (!managerClass || !fieldApi) return ptr(0);

  const iter = Memory.alloc(Process.pointerSize);
  iter.writePointer(ptr(0));
  let field = ptr(0);
  let luaEnvField = ptr(0);
  while (!(field = fieldApi.class_get_fields(managerClass.klass, iter)).isNull()) {
    const flags = fieldApi.field_get_flags(field);
    if ((flags & 0x10) !== 0) continue;
    let typeName = '';
    try { typeName = readAnsi(api.type_get_name(fieldApi.field_get_type(field))); } catch (_) {}
    if (typeName && typeName.indexOf('LuaEnv') >= 0) {
      luaEnvField = field;
      break;
    }
  }

  if (!luaEnvField || luaEnvField.isNull()) {
    directDuelLastError = 'No LuaEnv-typed instance field was found on XLuaManager';
    return ptr(0);
  }

  const out = Memory.alloc(Process.pointerSize);
  fieldApi.field_get_value(directDuelManager, luaEnvField, out);
  const value = out.readPointer();
  if (!value || value.isNull()) {
    directDuelLastError = 'XLuaManager LuaEnv field was null';
    return ptr(0);
  }

  directDuelLuaEnv = value;
  let className = '';
  let offset = -1;
  try { className = objectClassName(value); } catch (_) {}
  try { offset = fieldApi.field_get_offset(luaEnvField); } catch (_) {}
  directDuelEmit('direct-duel-luaenv-ready', {
    manager: pstr(directDuelManager),
    luaEnv: pstr(value),
    className,
    fieldOffset: offset
  });
  return directDuelLuaEnv;
}

function directDuelResolveDoString() {
  if (directDuelDoStringMethod) return directDuelDoStringMethod;
  const luaEnv = directDuelFindLuaEnvInstance();
  if (!luaEnv || luaEnv.isNull()) return null;
  try {
    const klass = api.object_get_class(luaEnv);
    const candidates = enumerateMethods(klass, 'DoString', null);
    const chosen = candidates.find(method =>
      method.paramCount === 3 &&
      method.paramTypes.length >= 1 &&
      String(method.paramTypes[0] || '').indexOf('System.String') >= 0
    ) || candidates.find(method =>
      method.paramCount === 1 &&
      method.paramTypes.length === 1 &&
      String(method.paramTypes[0] || '').indexOf('System.String') >= 0
    ) || candidates[0];

    if (!chosen) {
      directDuelLastError = 'XLua.LuaEnv.DoString was not found';
      return null;
    }
    directDuelDoStringMethod = chosen;
    directDuelEmit('direct-duel-invoker-ready', {
      route: 'XLua.LuaEnv.DoString fallback',
      signature: `${chosen.returnType} ${chosen.name}(${chosen.paramTypes.join(', ')})`,
      address: pstr(chosen.primary)
    });
    return chosen;
  } catch (error) {
    directDuelLastError = `DoString resolver failed: ${error.stack || error}`;
    return null;
  }
}

function directDuelInvokeManaged(method, instance, args) {
  if (typeof automationInvokeMethod === 'function') {
    return automationInvokeMethod(method, instance, args);
  }
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

function directDuelDoStringOnMainThread(chunk) {
  if (!directDuelManager || directDuelManager.isNull()) directDuelFindXLuaManagerInstance();
  if (!directDuelManager || directDuelManager.isNull()) {
    return { ok: false, error: directDuelLastError || 'XLuaManager instance not found' };
  }

  const safeMethod = directDuelResolveSafeDoString();
  if (safeMethod) {
    try {
      directDuelInvokeManaged(
        safeMethod.method,
        directDuelManager,
        [directDuelManagedString(chunk)]
      );
      directDuelExecutionRoute = 'XLuaManager.SafeDoString';
      directDuelLastError = '';
      return { ok: true, route: directDuelExecutionRoute };
    } catch (safeError) {
      directDuelLastError = `SafeDoString failed: ${safeError.stack || safeError}`;
      directDuelEmit('direct-duel-route-fallback', {
        from: 'XLuaManager.SafeDoString',
        error: directDuelLastError
      });
    }
  }

  try {
    const luaEnv = directDuelFindLuaEnvInstance();
    const method = directDuelResolveDoString();
    if (!luaEnv || luaEnv.isNull() || !method) {
      return { ok: false, error: directDuelLastError || 'LuaEnv.DoString fallback unavailable' };
    }
    const args = [directDuelManagedString(chunk)];
    if (method.paramCount >= 2) args.push(directDuelManagedString('AllianceTracker.DirectDuel'));
    if (method.paramCount >= 3) args.push(ptr(0));
    directDuelInvokeManaged(method.method, luaEnv, args);
    directDuelExecutionRoute = 'XLua.LuaEnv.DoString';
    directDuelLastError = '';
    return { ok: true, route: directDuelExecutionRoute };
  } catch (fallbackError) {
    directDuelLastError = `LuaEnv.DoString failed: ${fallbackError.stack || fallbackError}`;
    return { ok: false, error: directDuelLastError };
  }
}

function directDuelBuildProbe(mode) {
  const selected = String(mode || 'previous').toLowerCase();
  if (!DIRECT_DUEL_MODES.has(selected)) throw new Error(`Unsupported Direct Duel mode: ${selected}`);

  const calls = [
    ['get.alliance.duel.season.info', null],
    ['get.alliance.duel.group.info', null],
    ['al.battle.week.result.info', null]
  ];
  if (selected === 'current' || selected === 'both') calls.push(['al.battle.rank.info', 0]);
  if (selected === 'previous' || selected === 'both') calls.push(['al.battle.rank.info', 3]);

  const commands = calls.map(row => row[1] === null ? row[0] : `${row[0]}:${row[1]}`);
  const statements = calls.map(row => {
    const command = JSON.stringify(row[0]);
    return row[1] === null
      ? `pcall(function() _G.SFSNetwork.SendMessage(${command}) end)`
      : `pcall(function() _G.SFSNetwork.SendMessage(${command}, ${Number(row[1])}) end)`;
  });

  return {
    commands,
    chunk: [
      'if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end',
      ...statements
    ].join('\n')
  };
}

function directDuelQueueProbe(mode) {
  const built = directDuelBuildProbe(mode);
  const item = {
    requestId: directDuelNextRequestId++,
    mode: String(mode || 'previous').toLowerCase(),
    commands: built.commands,
    chunk: built.chunk,
    tries: 0
  };
  directDuelQueue.push(item);
  directDuelEmit('direct-duel-queued', {
    requestId: item.requestId,
    mode: item.mode,
    commands: item.commands,
    queueDepth: directDuelQueue.length,
    status: directDuelStatus()
  });
  return {
    ok: true,
    requestId: item.requestId,
    mode: item.mode,
    commands: item.commands,
    status: directDuelStatus()
  };
}

function directDuelProcessQueue() {
  if (!directDuelQueue.length) return;
  const item = directDuelQueue.shift();

  if (!directDuelManager || directDuelManager.isNull()) directDuelFindXLuaManagerInstance();
  if ((!directDuelManager || directDuelManager.isNull()) && item.tries < 900) {
    item.tries += 1;
    directDuelQueue.unshift(item);
    const now = Date.now();
    if (now - directDuelLastWaitingEmit > 5000) {
      directDuelLastWaitingEmit = now;
      directDuelEmit('direct-duel-waiting', {
        stage: 'manager',
        tries: item.tries,
        queueDepth: directDuelQueue.length,
        status: directDuelStatus()
      });
    }
    return;
  }

  const result = directDuelDoStringOnMainThread(item.chunk);
  if (result.ok) {
    directDuelExecuted += 1;
    directDuelLastError = '';
    directDuelEmit('direct-duel-executed', {
      requestId: item.requestId,
      mode: item.mode,
      commands: item.commands,
      route: result.route,
      queuedRemaining: directDuelQueue.length,
      status: directDuelStatus()
    });
  } else {
    directDuelFailed += 1;
    directDuelLastError = result.error || 'unknown Direct Duel execution error';
    directDuelEmit('direct-duel-error', {
      requestId: item.requestId,
      mode: item.mode,
      error: directDuelLastError,
      status: directDuelStatus()
    });
  }
}

// Mirror the proven Last Z Gambler design: piggyback on the already-installed
// automation main-thread replay pump rather than attaching a second interceptor at
// XLuaManager.Update. The previous prototype used forMethodPointers() here, but that
// address had already been claimed by part03 and was deduplicated, so its pump never
// ran. This wrapper executes Direct Duel work in the same known-good main-thread
// callback as Sequence Studio replay.
const directDuelOriginalProcessReplayQueue = automationProcessReplayQueue;
automationProcessReplayQueue = function () {
  directDuelOriginalProcessReplayQueue();
  directDuelProcessQueue();
};

rpc.exports.queueDirectDuelProbe = function (mode) {
  return directDuelQueueProbe(mode || 'previous');
};
rpc.exports.getDirectDuelStatus = function () {
  return directDuelStatus();
};

setImmediate(function () {
  directDuelEmit('direct-duel-hook-ready', {
    sharedUpdateHook: true,
    message: 'Direct Duel is integrated with the existing automation main-thread Update pump.'
  });
});
