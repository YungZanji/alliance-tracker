// Bounded read-only historical explorer for Alliance Duel.
//
// 1.7.9 proved the direct request bridge itself works. The old assumption that
// rank type 3 means "previous week" was wrong on the current client: type 3 is
// the current matchup's completed-day history. This module adds one finite probe
// set to map the remaining read-only request shapes without exposing arbitrary
// Lua or arbitrary server commands.

DIRECT_DUEL_MODES.add('explore');

const DIRECT_DUEL_RECOVERY_GROUP = '400_3_1';
const DIRECT_DUEL_RECOVERY_WEEK_START = 1789956000000;
const directDuelBuildProbeBeforeHistoricalExplorer = directDuelBuildProbe;

function directDuelExplorerLuaValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  throw new Error(`Unsupported historical explorer argument type: ${typeof value}`);
}

directDuelBuildProbe = function (mode) {
  const selected = String(mode || 'previous').toLowerCase();
  if (selected !== 'explore') return directDuelBuildProbeBeforeHistoricalExplorer(selected);

  // All entries are known Alliance Duel READ requests. The previous group and
  // previous week start come from the successful 2026-09-28 context capture.
  // No guessed alliance/player IDs and no mutation commands are used.
  const calls = [
    { label: 'season/current+previous', command: 'get.alliance.duel.season.info', args: [] },
    { label: 'group/current-default', command: 'get.alliance.duel.group.info', args: [] },
    { label: 'week/current-default', command: 'al.battle.week.result.info', args: [] },

    { label: 'rank/type0', command: 'al.battle.rank.info', args: [0] },
    { label: 'rank/type1', command: 'al.battle.rank.info', args: [1] },
    { label: 'rank/type2', command: 'al.battle.rank.info', args: [2] },
    { label: 'rank/type3', command: 'al.battle.rank.info', args: [3] },
    { label: 'rank/type4', command: 'al.battle.rank.info', args: [4] },
    { label: 'rank/type5', command: 'al.battle.rank.info', args: [5] },

    { label: 'group/previous-group', command: 'get.alliance.duel.group.info', args: [DIRECT_DUEL_RECOVERY_GROUP] },
    { label: 'week/previous-start', command: 'al.battle.week.result.info', args: [DIRECT_DUEL_RECOVERY_WEEK_START] },
    { label: 'week/previous-group', command: 'al.battle.week.result.info', args: [DIRECT_DUEL_RECOVERY_GROUP] },

    { label: 'rank/type0+weekAgo1', command: 'al.battle.rank.info', args: [0, 1] },
    { label: 'rank/type1+weekAgo1', command: 'al.battle.rank.info', args: [1, 1] },
    { label: 'rank/type2+weekAgo1', command: 'al.battle.rank.info', args: [2, 1] },
    { label: 'rank/type3+weekAgo1', command: 'al.battle.rank.info', args: [3, 1] },

    { label: 'rank/type1+previous-group', command: 'al.battle.rank.info', args: [1, DIRECT_DUEL_RECOVERY_GROUP] },
    { label: 'rank/type2+previous-group', command: 'al.battle.rank.info', args: [2, DIRECT_DUEL_RECOVERY_GROUP] },
    { label: 'rank/type3+previous-group', command: 'al.battle.rank.info', args: [3, DIRECT_DUEL_RECOVERY_GROUP] },

    { label: 'rank/type1+previous-start', command: 'al.battle.rank.info', args: [1, DIRECT_DUEL_RECOVERY_WEEK_START] },
    { label: 'rank/type2+previous-start', command: 'al.battle.rank.info', args: [2, DIRECT_DUEL_RECOVERY_WEEK_START] }
  ];

  const statements = calls.map(call => {
    const command = JSON.stringify(call.command);
    const args = call.args.map(directDuelExplorerLuaValue);
    const suffix = args.length ? `, ${args.join(', ')}` : '';
    return `pcall(function() _G.SFSNetwork.SendMessage(${command}${suffix}) end)`;
  });

  const commands = calls.map(call => `${call.label} => ${call.command}${call.args.length ? ':' + call.args.join(',') : ''}`);
  directDuelEmit('direct-duel-explorer-plan', {
    recoveryGroup: DIRECT_DUEL_RECOVERY_GROUP,
    recoveryWeekStart: DIRECT_DUEL_RECOVERY_WEEK_START,
    requestCount: calls.length,
    requests: calls
  });

  return {
    commands,
    chunk: [
      'if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end',
      ...statements
    ].join('\n')
  };
};
