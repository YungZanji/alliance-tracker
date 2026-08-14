  } catch (_) {
    return String(value);
  }
}

function luaString(L, index) {
  // XLua.LuaDLL.Lua.lua_tostring returns a managed System.String in this
  // Last Z build. The previous build treated that return value as a raw UTF-8
  // char pointer, so it read the Il2CppString object header as text and produced
  // errors such as "can't decode byte 0xb2". Decode it through IL2CPP's
  // string_length/string_chars API instead.
  const managedString = lua.tostring(L, index);
  if (!managedString || managedString.isNull()) return '';
  const value = readManagedString(managedString);
  if (value.startsWith('<string-read-error:') || value === '<invalid-managed-string>') {
    bump('Lua.managedStringDecodeFailed');
  } else {
    bump('Lua.managedStringsDecoded');
  }
  return value;
}

function absoluteLuaIndex(L, index) {
  if (index > 0) return index;
  const top = lua.gettop(L);
  return top + index + 1;
}

function luaKeyToString(L, index) {
  const type = lua.type(L, index);
  switch (type) {
    case LUA_TSTRING:
      return luaString(L, index);
    case LUA_TNUMBER:
      if (lua.isinteger(L, index)) {
        return String(int64ToJson(lua.tointeger(L, index)));
      }
      return String(lua.tonumber(L, index));
    case LUA_TBOOLEAN:
      return lua.toboolean(L, index) ? 'true' : 'false';
    case LUA_TLIGHTUSERDATA:
    case LUA_TUSERDATA:
    case LUA_TFUNCTION:
    case LUA_TTHREAD:
    case LUA_TTABLE:
      return `<lua-key-type-${type}@${pstr(lua.topointer(L, index))}>`;
    case LUA_TNIL:
      return '<nil-key>';
    default:
      return `<lua-key-type-${type}>`;
  }
}

function luaValueToJs(L, index, depth, seen) {
  if (depth > MAX_DEPTH) return '<max-depth>';
  const type = lua.type(L, index);
  switch (type) {
    case LUA_TNONE:
      return '<none>';
    case LUA_TNIL:
      return null;
    case LUA_TBOOLEAN:
      return lua.toboolean(L, index) !== 0;
    case LUA_TNUMBER:
      if (lua.isinteger(L, index)) {
        return int64ToJson(lua.tointeger(L, index));
      }
      return lua.tonumber(L, index);
    case LUA_TSTRING:
      return luaString(L, index);
    case LUA_TTABLE:
      return luaTableToJs(L, index, depth + 1, seen);
    case LUA_TLIGHTUSERDATA:
      return { __luaType: 'lightuserdata', pointer: pstr(lua.topointer(L, index)) };
    case LUA_TFUNCTION:
      return { __luaType: 'function', pointer: pstr(lua.topointer(L, index)) };
    case LUA_TUSERDATA:
      return { __luaType: 'userdata', pointer: pstr(lua.topointer(L, index)) };
    case LUA_TTHREAD:
      return { __luaType: 'thread', pointer: pstr(lua.topointer(L, index)) };
    default:
      return { __luaType: `unknown-${type}` };
  }
}

function maybeArrayFromObject(objectValue) {
  const keys = Object.keys(objectValue);
  if (keys.length === 0) return objectValue;
  const numeric = keys.map(key => Number(key));
  if (!numeric.every(value => Number.isInteger(value) && value >= 1)) return objectValue;
  numeric.sort((a, b) => a - b);
  for (let i = 0; i < numeric.length; i++) {
    if (numeric[i] !== i + 1) return objectValue;
  }
  return numeric.map(value => objectValue[String(value)]);
}

function luaTableToJs(L, index, depth, seen) {
  const initialTop = lua.gettop(L);
  const absoluteIndex = absoluteLuaIndex(L, index);
  const tablePointer = lua.topointer(L, absoluteIndex);
  const tableId = pstr(tablePointer);

  if (seen.has(tableId)) return { __luaCycle: tableId };
  seen.add(tableId);

  const output = Object.create(null);
  let count = 0;

  try {
    lua.pushnil(L);
    while (lua.next(L, absoluteIndex) !== 0) {
      count += 1;
      if (count > MAX_TABLE_ENTRIES) {
        output.__truncated = true;
        lua.settop(L, -2);
        break;
      }

      let key = luaKeyToString(L, -2);
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        let suffix = 2;
        while (Object.prototype.hasOwnProperty.call(output, `${key}#${suffix}`)) suffix += 1;
        key = `${key}#${suffix}`;
      }

      output[key] = luaValueToJs(L, -1, depth, seen);
      lua.settop(L, -2); // Pop the value, keep the key for lua_next.
    }
  } finally {
    lua.settop(L, initialTop);
    seen.delete(tableId);
  }

  return maybeArrayFromObject(output);
}

function parseLuaStackTableArgument(tableArgument) {
  if (!tableArgument || tableArgument.isNull()) {
    throw new Error('LuaStackTable argument pointer was null');
  }

  const argumentRange = safeRange(tableArgument);
  if (!argumentRange || argumentRange.protection.indexOf('r') < 0) {
    throw new Error(`LuaStackTable argument was not readable: ${pstr(tableArgument)}`);
  }

  // Metadata layout for this build:
  //   Int32 oldTop @ +0
  //   padding      @ +4
  //   IntPtr L     @ +8
  //   Int32 index_ @ +16
  const oldTop = tableArgument.readS32();
  const L = tableArgument.add(8).readPointer();
  const index = tableArgument.add(16).readS32();
  const luaRange = safeRange(L);

  if (!luaRange || luaRange.protection.indexOf('r') < 0) {
    throw new Error(
      `Lua state pointer failed validation. arg=${pstr(tableArgument)} L=${pstr(L)} oldTop=${oldTop} index=${index}`
    );
  }
  if (index < -100000 || index > 100000) {
    throw new Error(`LuaStackTable index looked invalid: ${index}`);
  }

  const currentTop = lua.gettop(L);
  const valueType = lua.type(L, index);
  if (valueType !== LUA_TTABLE) {
    throw new Error(
      `LuaStackTable did not reference a table. oldTop=${oldTop} currentTop=${currentTop} index=${index} type=${valueType}`
    );
  }

  return { L, index, oldTop, currentTop };
}

function dumpLuaStackTable(command, tableArgument, signature) {
  const parsed = parseLuaStackTableArgument(tableArgument);
  const payload = luaTableToJs(parsed.L, parsed.index, 0, new Set());
