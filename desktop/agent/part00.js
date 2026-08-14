'use strict';

let captureEnabled = false;
let hookInstalled = false;
let gameAssembly = null;
let api = null;
let lua = null;
let initTimer = null;
let sequence = 0;
const counters = Object.create(null);
const installedHooks = [];
const attachedAddresses = new Set();

const TARGET_COMMANDS = new Set([
  'al.battle.rank.info',
  'get.alliance.duel.season.info',
  'al.battle.week.result.info'
]);

const LUA_TNONE = -1;
const LUA_TNIL = 0;
const LUA_TBOOLEAN = 1;
const LUA_TLIGHTUSERDATA = 2;
const LUA_TNUMBER = 3;
const LUA_TSTRING = 4;
const LUA_TTABLE = 5;
const LUA_TFUNCTION = 6;
const LUA_TUSERDATA = 7;
const LUA_TTHREAD = 8;

const MAX_DEPTH = 10;
const MAX_TABLE_ENTRIES = 2500;
const MAX_STRING_BYTES = 1024 * 1024;

function bump(name) {
  counters[name] = (counters[name] || 0) + 1;
  return counters[name];
}

function log(level, message, extra) {
  send({ kind: 'diagnostic', level, message, extra: extra || null });
}

function pstr(p) {
  try {
    return (!p || p.isNull()) ? '<null>' : p.toString();
  } catch (_) {
    return '<invalid>';
  }
}

function readAnsi(p) {
  try {
    return (!p || p.isNull()) ? '' : (p.readUtf8String() || '');
  } catch (_) {
    return '';
  }
}

function resolveApi(module) {
  function fn(name, ret, args) {
    const address = module.getExportByName(name);
    return new NativeFunction(address, ret, args);
  }

  return {
    domain_get: fn('il2cpp_domain_get', 'pointer', []),
    domain_get_assemblies: fn('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']),
    thread_attach: fn('il2cpp_thread_attach', 'pointer', ['pointer']),
    assembly_get_image: fn('il2cpp_assembly_get_image', 'pointer', ['pointer']),
    image_get_name: fn('il2cpp_image_get_name', 'pointer', ['pointer']),
    class_from_name: fn('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']),
    class_get_methods: fn('il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']),
    class_get_method_from_name: fn('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']),
    class_get_name: fn('il2cpp_class_get_name', 'pointer', ['pointer']),
    class_get_namespace: fn('il2cpp_class_get_namespace', 'pointer', ['pointer']),
    class_get_parent: fn('il2cpp_class_get_parent', 'pointer', ['pointer']),
    method_get_name: fn('il2cpp_method_get_name', 'pointer', ['pointer']),
    method_get_param_count: fn('il2cpp_method_get_param_count', 'uint', ['pointer']),
    method_get_param: fn('il2cpp_method_get_param', 'pointer', ['pointer', 'uint']),
    method_get_return_type: fn('il2cpp_method_get_return_type', 'pointer', ['pointer']),
    type_get_name: fn('il2cpp_type_get_name', 'pointer', ['pointer']),
    object_get_class: fn('il2cpp_object_get_class', 'pointer', ['pointer']),
    runtime_invoke: fn('il2cpp_runtime_invoke', 'pointer', ['pointer', 'pointer', 'pointer', 'pointer']),
    string_length: fn('il2cpp_string_length', 'int', ['pointer']),
    string_chars: fn('il2cpp_string_chars', 'pointer', ['pointer'])
  };
}

function readManagedString(p) {
  if (!p || p.isNull()) return '';
  try {
    const n = api.string_length(p);
    if (n < 0 || n > 100000) return '<invalid-managed-string>';
    return n === 0 ? '' : (api.string_chars(p).readUtf16String(n) || '');
  } catch (e) {
    return `<string-read-error: ${e}>`;
  }
}

function classDisplayName(k) {
  if (!k || k.isNull()) return '<null-class>';
  const name = readAnsi(api.class_get_name(k));
  const ns = readAnsi(api.class_get_namespace(k));
  return ns ? `${ns}.${name}` : name;
}

function objectClassName(o) {
  try {
    return (!o || o.isNull()) ? '<null>' : classDisplayName(api.object_get_class(o));
  } catch (_) {
    return '<unknown>';
  }
}

function enumerateImages() {
  const domain = api.domain_get();
  if (domain.isNull()) throw new Error('il2cpp_domain_get returned null');
  api.thread_attach(domain);

  const sizep = Memory.alloc(Process.pointerSize);
  sizep.writePointer(ptr(0));
  const assemblies = api.domain_get_assemblies(domain, sizep);
  const count = Process.pointerSize === 8 ? Number(sizep.readU64()) : sizep.readU32();
  const out = [];

  for (let i = 0; i < count; i++) {
    const assembly = assemblies.add(i * Process.pointerSize).readPointer();
    if (assembly.isNull()) continue;
    const image = api.assembly_get_image(assembly);
    if (image.isNull()) continue;
    out.push({ image, name: readAnsi(api.image_get_name(image)) });
  }

  return out;
}

function findClass(ns, name) {
  const nsp = Memory.allocUtf8String(ns);
  const np = Memory.allocUtf8String(name);
  for (const entry of enumerateImages()) {
    const klass = api.class_from_name(entry.image, nsp, np);
    if (!klass.isNull()) return { klass, imageName: entry.name };
  }
  return null;
}

function enumerateMethods(klass, wantedName, wantedParams) {
  const out = [];
  const iter = Memory.alloc(Process.pointerSize);
  iter.writePointer(ptr(0));

  while (true) {
    const method = api.class_get_methods(klass, iter);
    if (method.isNull()) break;

    const name = readAnsi(api.method_get_name(method));
    const paramCount = Number(api.method_get_param_count(method));
    if ((wantedName !== null && name !== wantedName) ||
        (wantedParams !== null && paramCount !== wantedParams)) {
      continue;
    }

    const paramTypes = [];
    for (let i = 0; i < paramCount; i++) {
      try {
        paramTypes.push(readAnsi(api.type_get_name(api.method_get_param(method, i))));
      } catch (_) {
        paramTypes.push('?');
      }
    }

    let returnType = '?';
    try {
      returnType = readAnsi(api.type_get_name(api.method_get_return_type(method)));
    } catch (_) {}

    let primary = ptr(0);
    let virtualp = ptr(0);
    try { primary = method.readPointer(); } catch (_) {}
