// Agent prelude loaded before the original split capture source.
// Keep capture-selection state/helpers here so they remain top-level even though the
// legacy part00/part01/part02/part03 files split functions across file boundaries.
// Use `var` deliberately: Frida's bundled script/RPC functions must all resolve the
// exact same binding after the individual agent parts are concatenated.
var captureAllResponses = false;

const DISCOVERY_COMMAND_KEYWORDS = [
  'glory',
  'ruler',
  'server.battle',
  'server.cross.battle',
  'cross.battle',
  'arms.group',
  'state.battle',
  'state.ruler',
  'throne',
  'svs'
];

const CONFIRMED_RUNTIME_COMMANDS = new Set([
  'server.battle.maininfo',
  'server.battle.score.info',
  'server.battle.user.score.rank',
  'server.battle.rank',
  'server.battle.score.person.rank',
  'server.battle.score.ali.rank',
  'server.cross.battle.maininfo',
  'get.person.arms.group.rank'
]);

function shouldCaptureCommand(command) {
  const value = String(command || '').trim().toLowerCase();
  if (!value) return false;
  if (captureAllResponses) return true;
  if (TARGET_COMMANDS.has(value) || CONFIRMED_RUNTIME_COMMANDS.has(value)) return true;
  return DISCOVERY_COMMAND_KEYWORDS.some(keyword => value.indexOf(keyword) >= 0);
}
