// Production-oriented read-only Direct Duel full sync.
// Pulls every current Duel dataset Alliance Tracker already knows how to normalize,
// without opening or rendering the Duel UI.

DIRECT_DUEL_MODES.add('sync');

const directDuelBuildProbeBeforeFullSync = directDuelBuildProbe;

directDuelBuildProbe = function (mode) {
  const selected = String(mode || 'previous').toLowerCase();
  if (selected !== 'sync') return directDuelBuildProbeBeforeFullSync(selected);

  const calls = [
    ['get.alliance.duel.season.info', null],
    ['get.alliance.duel.group.info', null],
    ['al.battle.week.result.info', null],
    ['al.battle.rank.info', 0],
    ['al.battle.rank.info', 1],
    ['al.battle.rank.info', 2],
    ['al.battle.rank.info', 3]
  ];

  const commands = calls.map(row => row[1] === null ? row[0] : `${row[0]}:${row[1]}`);
  const statements = calls.map(row => {
    const command = JSON.stringify(row[0]);
    return row[1] === null
      ? `pcall(function() _G.SFSNetwork.SendMessage(${command}) end)`
      : `pcall(function() _G.SFSNetwork.SendMessage(${command}, ${Number(row[1])}) end)`;
  });

  directDuelEmit('direct-duel-full-sync-plan', {
    requestCount: calls.length,
    commands
  });

  return {
    commands,
    chunk: [
      'if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end',
      ...statements
    ].join('\n')
  };
};
