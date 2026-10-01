from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))
from direct_glory_history import latest_finished_war, validate_historical_snapshot


def main() -> None:
    now = 1_790_829_000_000
    start, end = now - 90_000_000, now - 86_400_000
    sides = [
        {"allianceId": "a" * 32, "abbr": "WDZ", "serverId": 305, "isAtk": 1, "isWin": 0},
        {"allianceId": "b" * 32, "abbr": "WRFG", "serverId": 311, "isAtk": 2, "isWin": 1},
    ]
    payload = {"warHis": [{"startTime": start, "endTime": end, "vsInfo": sides}]}
    target = latest_finished_war(payload, now_ms=now)
    assert target and target["sides"][1]["abbr"] == "WRFG"
    assert latest_finished_war({"warHis": [{**payload["warHis"][0], "endTime": now - 20 * 86_400_000}]}, now_ms=now) is None
    context = {
        "sourceMode": "logs_history", "historicalMatchDetected": True,
        "historicalBattleEndTime": end, "primaryAllianceId": "a" * 32,
        "opponentAllianceId": "b" * 32, "primaryServerId": 305,
        "opponentServerId": 311, "result": "LOSS",
    }
    snapshot = SimpleNamespace(context=context, rows=[{"uid": "1000001", "score": 42}])
    validate_historical_snapshot(snapshot, target)
    for wrong in ({"result": "WIN"}, {"historicalBattleEndTime": end - 1}, {"opponentAllianceId": "c" * 32}):
        bad = SimpleNamespace(context={**context, **wrong}, rows=snapshot.rows)
        try:
            validate_historical_snapshot(bad, target)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid Glory War pair was accepted: {wrong}")
    print("Direct Glory War history validation passed.")


if __name__ == "__main__":
    main()
