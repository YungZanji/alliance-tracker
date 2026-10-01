// Fixed read-only event requests sent through the proven main-thread bridge.
// The live score command names came from the existing UI-driven response decoders.
DIRECT_DUEL_MODES.add('glory');
DIRECT_DUEL_MODES.add('ruler');
DIRECT_DUEL_MODES.add('all-events');

const directBuildBeforeEvents = directDuelBuildProbe;
directDuelBuildProbe = function (mode) {
  const selected = String(mode || '').toLowerCase();
  if (!['glory', 'ruler', 'all-events'].includes(selected)) {
    return directBuildBeforeEvents(selected);
  }

  const duel = [
    ['get.alliance.duel.season.info', []],
    ['get.alliance.duel.group.info', []],
    ['al.battle.week.result.info', []],
    ...[0, 1, 2, 3].map(type => ['al.battle.rank.info', [type]])
  ];
  const glory = [['alliance.declare.war.personal.rank', []]];
  const ruler = [
    ['server.battle.user.score.rank', []],
    ['al.rank', []]
  ];
  const calls = selected === 'glory' ? glory :
    selected === 'ruler' ? ruler : [...duel, ...glory, ...ruler];
  const commands = calls.map(([command, args]) =>
    `${command}${args.length ? ':' + args.join(',') : ''}`);
  const statements = calls.map(([command, args]) =>
    `pcall(function() _G.SFSNetwork.SendMessage(${JSON.stringify(command)}${args.length ? ', ' + args.join(', ') : ''}) end)`);
  directDuelEmit('direct-event-plan', { mode: selected, commands });
  return {
    commands,
    chunk: [
      'if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end',
      ...statements
    ].join('\n')
  };
};
