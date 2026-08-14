// Event-discovery extension loaded immediately after part00.js.
// The shared captureAllResponses flag and shouldCaptureCommand() helper live in
// part-01.js so every concatenated agent/RPC function resolves the same binding.
[
  'server.battle.score.person.rank',
  'server.battle.score.ali.rank',
  'server.battle.score.info',
  'get.person.arms.group.rank'
].forEach(command => TARGET_COMMANDS.add(command));
