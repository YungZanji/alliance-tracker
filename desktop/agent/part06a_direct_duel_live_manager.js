// Direct Duel manager-source correction.
//
// part03 now hands the actual live XLuaManager `this` pointer (args[0]) to
// directDuelRememberManagerInstance from the existing Update/DispatchResponse hooks.
// The previous Resources.FindObjectsOfTypeAll fallback is therefore removed from the
// critical path: the queue simply waits for the real pointer already observed by the
// capture engine.

directDuelFindXLuaManagerInstance = function () {
  if (directDuelManager && !directDuelManager.isNull()) return directDuelManager;
  directDuelLastError = 'Waiting for live XLuaManager pointer from existing game hooks';
  return ptr(0);
};

setImmediate(function () {
  directDuelEmit('direct-duel-manager-source-ready', {
    source: 'XLuaManager.Update/DispatchResponse args[0]',
    resourcesSweepDisabled: true
  });
});
