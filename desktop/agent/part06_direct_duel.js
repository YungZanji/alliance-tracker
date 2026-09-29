
// Experimental read-only Alliance Duel request bridge.
//
// This does NOT expose arbitrary Lua execution to the desktop UI. The only RPC
// entrypoint below accepts a small named mode and builds a hard-coded whitelist of
// read-only SFSNetwork.SendMessage calls that have already been observed in normal
// game traffic. The Lua chunk itself is executed on XLuaManager.Update so it runs on
// the game's main thread, matching the proven xLua execution pattern used by the
// separate Last Z research harness.

let directDuelHookInstalled = false;
let directDuelManager = ptr(0);
let directDuelLuaEnv = ptr(0);
let directDuelDoString = null;
let directDuelDoStringMethod = ptr(0);
let directDuelStringNew = null;
let directDuelQueue = [];
let directDuelNextRequestId = 1;
let directDuelExecuted = 0;
let directDuelFailed = 0;
let directDuelLastError = '';
let directDuelLastReadyEmit = 0;

const DIRECT_DUEL_LUAENV_OFFSET = 0x20;
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
    hookInstalled: directDuelHookInstalled,
    manager: pstr(directDuelManager),
    luaEnv: pstr(directDuelLuaEnv),
    invokerReady: !!directDuelDoString,
    queued: directDuelQueue.length,
    executed: directDuelExecuted,
    failed: directDuelFailed,
    lastError: directDuelLastError,
    luaEnvOffset: DIRECT_DUEL_LUAENV_OFFSET
  };
}

function directDuelResolveStringNew() {
  if (directDuelStringNew || !gameAssembly) return !!directDuelStringNew;
  try {
    const address = gameAssembly.getExportByName('il2cpp_string_new');
    directDuelStringNew = new NativeFunction(address, 'pointer', ['pointer']);
    return true;
  } catch (error) {
    directDuelLastError = `il2cpp_string_new unavailable: ${error}`;
    return false;
  }
}

function directDuelResolveDoString() {
  if (directDuelDoString) return true;
  if (!api || !directDuelResolveStringNew()) return false;

  try {
    const found = findClass('XLua', 'LuaEnv');
    if (!found) {
      directDuelLastError = 'XLua.LuaEnv class was not found';
      return false;
    }

    const candidates = enumerateMethods(found.klass, 'DoString', 3);
    const method = candidates.find(item => {
      const types = item.paramTypes || [];
      return types.length === 3 &&
        String(types[0] || '').indexOf('System.String') >= 0 &&
        String(types[1] || '').indexOf('System.String') >= 0;
    }) || candidates[0];

    if (!method || !method.primary || method.primary.isNull()) {
      directDuelLastError = 'XLua.LuaEnv.DoString(string,string,env) was not found';
      return false;
    }

    // IL2CPP instance-method ABI on the current x64 game build:
    //   return DoString(this, chunk, chunkName, env, MethodInfo*)
    // The research harness verified this raw-ABI route on the same Windows client.
    directDuelDoStringMethod = method.method;
    directDuelDoString = new NativeFunction(
      method.primary,
      'pointer',
      ['pointer', 'pointer', 'pointer', 'pointer', 'pointer']
    );
    directDuelLastError = '';
    directDuelEmit('direct-duel-invoker-ready', {
      imageName: found.imageName,
      signature: `${method.returnType} ${method.name}(${(method.paramTypes || []).join(', ')})`,
      address: pstr(method.primary)
    });
    return true;
  } catch (error) {
    directDuelLastError = `DoString resolver failed: ${error.stack || error}`;
    return false;
  }
}

function directDuelObserveManager(manager) {
  if (!manager || manager.isNull()) return;
  directDuelManager = manager;

  if (!directDuelLuaEnv || directDuelLuaEnv.isNull()) {
    try {
      const candidate = manager.add(DIRECT_DUEL_LUAENV_OFFSET).readPointer();
      if (candidate && !candidate.isNull()) {
        const className = objectClassName(candidate);
        if (className === 'XLua.LuaEnv' || className.endsWith('.LuaEnv')) {
          directDuelLuaEnv = candidate;
          directDuelEmit('direct-duel-luaenv-ready', {
            manager: pstr(manager),
            luaEnv: pstr(candidate),
            className,
            fieldOffset: DIRECT_DUEL_LUAENV_OFFSET
          });
        } else {
          directDuelLastError = `XLuaManager + 0x20 was ${className || '<unknown>'}, not XLua.LuaEnv`;
        }
      }
    } catch (error) {
      directDuelLastError = `LuaEnv field read failed: ${error}`;
    }
  }

  directDuelResolveDoString();
}

function directDuelManagedString(value) {
  if (!directDuelStringNew) throw new Error('il2cpp_string_new is not ready');
  return directDuelStringNew(Memory.allocUtf8String(String(value || '')));
}

function directDuelExecute(item) {
  if (!directDuelLuaEnv || directDuelLuaEnv.isNull()) throw new Error('XLua.LuaEnv is not ready');
  if (!directDuelResolveDoString()) throw new Error(directDuelLastError || 'LuaEnv.DoString is not ready');

  const chunk = directDuelManagedString(item.chunk);
  const chunkName = directDuelManagedString(`alliance_tracker_${item.mode}_${item.requestId}`);
  directDuelDoString(
    directDuelLuaEnv,
    chunk,
    chunkName,
    ptr(0),
    directDuelDoStringMethod
  );
}

function directDuelPump(manager) {
  try {
    directDuelObserveManager(manager);
    if (!directDuelQueue.length) {
      const now = Date.now();
      if (now - directDuelLastReadyEmit > 5000 && directDuelLuaEnv && !directDuelLuaEnv.isNull() && directDuelDoString) {
        directDuelLastReadyEmit = now;
        directDuelEmit('direct-duel-ready', directDuelStatus());
      }
      return;
    }

    if (!directDuelLuaEnv || directDuelLuaEnv.isNull() || !directDuelDoString) return;

    const item = directDuelQueue.shift();
    try {
      directDuelExecute(item);
      directDuelExecuted += 1;
      directDuelLastError = '';
      directDuelEmit('direct-duel-executed', {
        requestId: item.requestId,
        mode: item.mode,
        commands: item.commands,
        queuedRemaining: directDuelQueue.length
      });
    } catch (error) {
      directDuelFailed += 1;
      directDuelLastError = String(error.stack || error);
      directDuelEmit('direct-duel-error', {
        requestId: item.requestId,
        mode: item.mode,
        error: directDuelLastError
      });
    }
  } catch (error) {
    directDuelLastError = String(error.stack || error);
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
    chunk: built.chunk
  };
  directDuelQueue.push(item);
  directDuelEmit('direct-duel-queued', {
    requestId: item.requestId,
    mode: item.mode,
    commands: item.commands,
    queueDepth: directDuelQueue.length
  });
  return {
    ok: true,
    requestId: item.requestId,
    mode: item.mode,
    commands: item.commands,
    status: directDuelStatus()
  };
}

function installDirectDuelHook() {
  if (directDuelHookInstalled || !api) return false;
  try {
    const found = findClass('', 'XLuaManager');
    if (!found) return false;
    let hooks = 0;
    for (const method of enumerateMethods(found.klass, 'Update', 0)) {
      forMethodPointers(method, 'DirectDuel.XLuaManager.Update', {
        onEnter(args) {
          directDuelPump(args[0]);
        }
      });
      hooks += 1;
    }
    directDuelHookInstalled = hooks > 0;
    if (directDuelHookInstalled) {
      directDuelEmit('direct-duel-hook-ready', { hooks, imageName: found.imageName });
    }
    return directDuelHookInstalled;
  } catch (error) {
    directDuelLastError = `Direct Duel hook installation failed: ${error.stack || error}`;
    return false;
  }
}

// part03 establishes rpc.exports. This part sorts after it, so extend that object
// rather than replacing any of the production capture exports.
rpc.exports.queueDirectDuelProbe = function (mode) {
  return directDuelQueueProbe(mode || 'previous');
};
rpc.exports.getDirectDuelStatus = function () {
  return directDuelStatus();
};

setImmediate(function () {
  try { installDirectDuelHook(); } catch (_) {}
});
setInterval(function () {
  if (!directDuelHookInstalled) {
    try { installDirectDuelHook(); } catch (_) {}
  }
}, 1000);
