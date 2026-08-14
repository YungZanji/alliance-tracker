    try { virtualp = method.add(Process.pointerSize).readPointer(); } catch (_) {}

    out.push({
      method,
      name,
      paramCount,
      paramTypes,
      returnType,
      primary,
      virtualp
    });
  }

  return out;
}

function findMethodInHierarchy(klass, name, count) {
  const np = Memory.allocUtf8String(name);
  let current = klass;
  for (let depth = 0; depth < 16 && current && !current.isNull(); depth++) {
    const method = api.class_get_method_from_name(current, np, count);
    if (!method.isNull()) return method;
    current = api.class_get_parent(current);
  }
  return ptr(0);
}

function invokeToJson(obj) {
  if (!obj || obj.isNull()) {
    return { ok: false, error: 'Object was null', json: '', className: '<null>' };
  }

  let klass;
  try {
    klass = api.object_get_class(obj);
  } catch (e) {
    return { ok: false, error: `object_get_class failed: ${e}`, json: '', className: '<unknown>' };
  }

  const className = classDisplayName(klass);
  const method = findMethodInHierarchy(klass, 'ToJson', 0);
  if (method.isNull()) {
    return { ok: false, error: 'No ToJson() method found', json: '', className };
  }

  const excp = Memory.alloc(Process.pointerSize);
  excp.writePointer(ptr(0));
  let returned;
  try {
    returned = api.runtime_invoke(method, obj, ptr(0), excp);
  } catch (e) {
    return { ok: false, error: `runtime_invoke(ToJson) failed: ${e}`, json: '', className };
  }

  const exc = excp.readPointer();
  if (!exc.isNull()) {
    return { ok: false, error: `ToJson raised exception at ${exc}`, json: '', className };
  }
  if (returned.isNull()) {
    return { ok: false, error: 'ToJson returned null', json: '', className };
  }

  return { ok: true, error: '', json: readManagedString(returned), className };
}

function hookAddress(address, label, callbacks, signature) {
  if (!address || address.isNull()) return false;
  const key = address.toString();
  if (attachedAddresses.has(key)) return false;
  Interceptor.attach(address, callbacks);
  attachedAddresses.add(key);
  installedHooks.push({ label, address: key, signature });
  return true;
}

function forMethodPointers(methodInfo, label, callbacks) {
  const signature = `${methodInfo.returnType} ${methodInfo.name}(${methodInfo.paramTypes.join(', ')})`;
  hookAddress(methodInfo.primary, `${label}:method`, callbacks, signature);
  if (!methodInfo.virtualp.equals(methodInfo.primary)) {
    hookAddress(methodInfo.virtualp, `${label}:virtual`, callbacks, signature);
  }
}

function sendConverted(kind, command, obj, sourceHook) {
  const converted = invokeToJson(obj);
  sequence += 1;
  send({
    kind,
    sequence,
    command: command || '',
    sourceHook,
    rawDataPointer: pstr(obj),
    objectClass: converted.className,
    json: converted.json,
    jsonOk: converted.ok,
    jsonError: converted.error,
    observedAt: new Date().toISOString()
  });
}

function selectMethod(klass, name, paramCount) {
  const candidates = enumerateMethods(klass, name, paramCount);
  if (candidates.length === 0) {
    throw new Error(`XLua method not found: ${name}/${paramCount}`);
  }
  return candidates[0];
}

function bindStatic(methodInfo, returnType, argTypes) {
  if (!methodInfo.primary || methodInfo.primary.isNull()) {
    throw new Error(`Method pointer was null for ${methodInfo.name}`);
  }
  const native = new NativeFunction(
    methodInfo.primary,
    returnType,
    argTypes.concat(['pointer'])
  );
  return function (...args) {
    return native.apply(null, args.concat([methodInfo.method]));
  };
}

function resolveLuaApi() {
  const luaClass = findClass('XLua.LuaDLL', 'Lua');
  if (!luaClass) throw new Error('XLua.LuaDLL.Lua class not found');

  const methods = {
    gettop: selectMethod(luaClass.klass, 'lua_gettop', 1),
    settop: selectMethod(luaClass.klass, 'lua_settop', 2),
    type: selectMethod(luaClass.klass, 'lua_type', 2),
    isinteger: selectMethod(luaClass.klass, 'lua_isinteger', 2),
    pushnil: selectMethod(luaClass.klass, 'lua_pushnil', 1),
    next: selectMethod(luaClass.klass, 'lua_next', 2),
    tonumber: selectMethod(luaClass.klass, 'lua_tonumber', 2),
    tointeger: selectMethod(luaClass.klass, 'xlua_tointeger', 2),
    toboolean: selectMethod(luaClass.klass, 'lua_toboolean', 2),
    tostring: selectMethod(luaClass.klass, 'lua_tostring', 2),
    topointer: selectMethod(luaClass.klass, 'lua_topointer', 2)
  };

  const bound = {
    gettop: bindStatic(methods.gettop, 'int', ['pointer']),
    settop: bindStatic(methods.settop, 'void', ['pointer', 'int']),
    type: bindStatic(methods.type, 'int', ['pointer', 'int']),
    isinteger: bindStatic(methods.isinteger, 'int', ['pointer', 'int']),
    pushnil: bindStatic(methods.pushnil, 'void', ['pointer']),
    next: bindStatic(methods.next, 'int', ['pointer', 'int']),
    tonumber: bindStatic(methods.tonumber, 'double', ['pointer', 'int']),
    tointeger: bindStatic(methods.tointeger, 'int64', ['pointer', 'int']),
    toboolean: bindStatic(methods.toboolean, 'int', ['pointer', 'int']),
    tostring: bindStatic(methods.tostring, 'pointer', ['pointer', 'int']),
    topointer: bindStatic(methods.topointer, 'pointer', ['pointer', 'int']),
    signatures: {}
  };

  for (const [key, value] of Object.entries(methods)) {
    bound.signatures[key] = `${value.returnType} ${value.name}(${value.paramTypes.join(', ')}) @ ${pstr(value.primary)}`;
  }
  return bound;
}

function safeRange(address) {
  try {
    return Process.findRangeByAddress(address);
  } catch (_) {
    return null;
  }
}

function int64ToJson(value) {
  try {
    const text = value.toString();
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) return numeric;
    return text;
