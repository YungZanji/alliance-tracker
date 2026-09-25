from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from glory_war_capture import build_glory_war_snapshot, find_glory_war_sessions


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        sessions = Path(temp)

        live_id = "glory-live"
        live_raw = sessions / live_id / "raw"
        live_raw.mkdir(parents=True)
        live_payload = {
            "rankInfo": [
                {"uid": "1000001", "name": "Alpha", "score": 100, "aid": "wdz-id", "abbr": "WDZ", "alName": "WDZ", "serverId": 305},
                {"uid": "1000002", "name": "Bravo", "score": 50, "aid": "wdz-id", "abbr": "WDZ", "alName": "WDZ", "serverId": 305},
                {"uid": "1000003", "name": "Other305", "score": 25, "aid": "ally-id", "abbr": "ALLY", "alName": "Ally", "serverId": 305},
                {"uid": "2000001", "name": "Enemy1", "score": 120, "aid": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311},
                {"uid": "2000002", "name": "Enemy2", "score": 80, "aid": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311},
                {"uid": "2000003", "name": "Other311", "score": 10, "aid": "other-id", "abbr": "ZZZ", "alName": "Other", "serverId": 311},
            ]
        }
        _write_jsonl(live_raw / "responses.jsonl", [{
            "command": "alliance.declare.war.personal.rank",
            "capturedAt": "2026-09-09T06:00:00Z",
            "sequence": 42,
            "payload": live_payload,
        }])

        snapshot, summary = build_glory_war_snapshot(live_id, sessions)
        assert snapshot.dataset == "glory_war_rankings"
        assert [row["name"] for row in snapshot.rows] == ["Alpha", "Bravo"]
        assert summary["primaryServerId"] == 305
        assert summary["opponentServerId"] == 311
        assert summary["primaryStateScore"] == 175
        assert summary["opponentStateScore"] == 210
        assert summary["primaryAllianceScore"] == 150
        assert summary["opponentAllianceScore"] == 200
        assert summary["opponentAllianceAbbr"] == "msft"
        assert summary["result"] == "LOSS"
        assert snapshot.context["opponentPlayerRowsStored"] is False

        history_id = "glory-history"
        history_raw = sessions / history_id / "raw"
        history_raw.mkdir(parents=True)
        history_rows = [
            {
                "command": "domain.al.his",
                "capturedAt": "2026-09-25T01:42:41.146Z",
                "sequence": 3,
                "payload": {
                    "warHis": [
                        {
                            "startTime": 1790107200000,
                            "endTime": 1790110800000,
                            "vsInfo": [
                                {"allianceId": "wdz-id", "abbr": "WDZ", "alName": "Zhus Wrath", "serverId": 305, "fightMember": 2, "isAtk": 1, "isWin": 1},
                                {"allianceId": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311, "fightMember": 1, "isAtk": 2, "isWin": 0},
                            ],
                        },
                        {
                            "startTime": 1790712000000,
                            "endTime": 1790715600000,
                            "vsInfo": [
                                {"allianceId": "wdz-id", "abbr": "WDZ", "alName": "Zhus Wrath", "serverId": 305, "fightMember": 2, "isAtk": 1, "isWin": 0},
                                {"allianceId": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311, "fightMember": 2, "isAtk": 2, "isWin": 1},
                            ],
                        },
                    ]
                },
            },
            {
                "command": "domain.al.war.member.score.his",
                "capturedAt": "2026-09-25T01:42:42.090Z",
                "sequence": 4,
                "payload": {
                    "alInfo": {"attack": 1, "allianceId": "wdz-id", "abbr": "WDZ", "alName": "Zhus Wrath", "serverId": 305},
                    "memberScores": [
                        {"uid": "1029340881000307", "name": "Zhu-xin", "score": 6697400, "country": "PH"},
                        {"uid": "1374694742000307", "name": "Mr Zanji", "score": 2010590, "country": "CA"},
                    ],
                },
            },
            {
                "command": "domain.al.war.member.score.his",
                "capturedAt": "2026-09-25T01:42:42.099Z",
                "sequence": 5,
                "payload": {
                    "alInfo": {"attack": 2, "allianceId": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311},
                    "memberScores": [
                        {"uid": "1170736165000295", "name": "SILENC£R", "score": 5655450, "country": "US"},
                    ],
                },
            },
        ]
        _write_jsonl(history_raw / "responses.jsonl", history_rows)

        historical, historical_summary = build_glory_war_snapshot(history_id, sessions)
        assert historical.command == "domain.al.war.member.score.his"
        assert historical.context["sourceMode"] == "logs_history"
        assert historical.context["historicalMatchDetected"] is True
        assert historical.captured_at == "2026-09-22T21:00:00Z"
        assert historical_summary["result"] == "WIN"
        assert historical_summary["primaryServerId"] == 305
        assert historical_summary["opponentServerId"] == 311
        assert historical_summary["primaryStateScore"] == 8_707_990
        assert historical_summary["opponentStateScore"] == 5_655_450
        assert [row["name"] for row in historical.rows] == ["Zhu-xin", "Mr Zanji"]
        assert historical.rows[0]["score"] == 6_697_400
        assert historical.rows[1]["score"] == 2_010_590
        assert historical.context["historyFightMemberPrimary"] == 2
        assert historical.context["historyFightMemberOpponent"] == 1
        assert historical.context["opponentPlayerRowsStored"] is False

        history_only_id = "glory-history-without-index"
        history_only_raw = sessions / history_only_id / "raw"
        history_only_raw.mkdir(parents=True)
        _write_jsonl(history_only_raw / "responses.jsonl", history_rows[1:])
        fallback, fallback_summary = build_glory_war_snapshot(history_only_id, sessions)
        assert fallback.context["historicalMatchDetected"] is False
        assert fallback_summary["result"] == "WIN"
        assert fallback.captured_at == "2026-09-25T01:42:42.099Z"

        other_raw = sessions / "other-session" / "raw"
        other_raw.mkdir(parents=True)
        _write_jsonl(other_raw / "responses.jsonl", [
            {"command": "al.rank", "capturedAt": "2026-09-09T05:00:00Z", "payload": {}}
        ])

        found = find_glory_war_sessions(
            sessions,
            [
                {"id": live_id, "label": "Live"},
                {"id": history_id, "label": "Logs"},
                {"id": history_only_id, "label": "Logs cached"},
                {"id": "other-session", "label": "Other"},
            ],
        )
        assert [row["id"] for row in found] == [live_id, history_id, history_only_id]

    print(
        "Verified live and Logs Glory War capture, historical matchup matching, event-time recovery, "
        "WDZ-only score archive, and saved-session import."
    )


if __name__ == "__main__":
    main()
