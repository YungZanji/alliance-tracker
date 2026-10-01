// Historical Glory War lookup uses the fixed read-only Logs commands. The
// alliance IDs and battle times are supplied only from a decoded warHis row.
DIRECT_DUEL_MODES.add('glory-history');
const directBuildBeforeGloryHistory = directDuelBuildProbe;
directDuelBuildProbe = function (mode) {
  if (String(mode).toLowerCase() !== 'glory-history') return directBuildBeforeGloryHistory(mode);
  return {
    commands: ['domain.al.his'],
    chunk: 'if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end\n' +
      'pcall(function() _G.SFSNetwork.SendMessage("domain.al.his") end)'
  };
};

rpc.exports.queueDirectGloryHistoryScores = function (battle) {
  const start = Number(battle && battle.startTime);
  const end = Number(battle && battle.endTime);
  const sides = battle && battle.sides;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 1600000000000 || end <= start || end - start > 86400000 ||
      !Array.isArray(sides) || sides.length !== 2 ||
      !sides.every(side => /^[a-f0-9]{32}$/i.test(String(side.allianceId || '')) &&
        [1, 2].includes(Number(side.attack)))) {
    throw new Error('Historical request requires a valid warHis battle and two alliance sides.');
  }

  const command = 'domain.al.war.member.score.his';
  const requests = [];
  for (const side of sides) {
    const aid = JSON.stringify(String(side.allianceId));
    const attack = Number(side.attack);
    // Bounded read-only variants. A response is never treated as a score until
    // its alliance identity and the battle in warHis pass Python validation.
    requests.push([start, aid], [end, aid], [aid, start], [aid, end],
      [start, attack], [end, attack]);
  }
  const statements = requests.map(args =>
    `pcall(function() _G.SFSNetwork.SendMessage("${command}", ${args.join(', ')}) end)`);
  const item = {
    requestId: directDuelNextRequestId++, mode: 'glory-history-scores',
    commands: requests.map(args => `${command}:${args.join(',')}`),
    chunk: ['if not _G.SFSNetwork or not _G.SFSNetwork.SendMessage then error("SFSNetwork.SendMessage unavailable") end', ...statements].join('\n'),
    tries: 0
  };
  directDuelQueue.push(item);
  directDuelEmit('direct-glory-history-queued', {
    requestId: item.requestId, battleStartTime: start, battleEndTime: end,
    allianceIds: sides.map(side => side.allianceId), requestCount: requests.length
  });
  return { ok: true, requestId: item.requestId, requestCount: requests.length };
};
