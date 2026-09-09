from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from glory_war_capture import build_glory_war_snapshot, find_glory_war_sessions


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        sessions = Path(temp)
        session_id = "glory-test"
        raw = sessions / session_id / "raw"
        raw.mkdir(parents=True)
        payload = {
            "rankInfo": [
                {"uid": "1000001", "name": "Alpha", "score": 100, "aid": "wdz-id", "abbr": "WDZ", "alName": "WDZ", "serverId": 305},
                {"uid": "1000002", "name": "Bravo", "score": 50, "aid": "wdz-id", "abbr": "WDZ", "alName": "WDZ", "serverId": 305},
                {"uid": "1000003", "name": "Other305", "score": 25, "aid": "ally-id", "abbr": "ALLY", "alName": "Ally", "serverId": 305},
                {"uid": "2000001", "name": "Enemy1", "score": 120, "aid": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311},
                {"uid": "2000002", "name": "Enemy2", "score": 80, "aid": "msft-id", "abbr": "msft", "alName": "Misfits", "serverId": 311},
                {"uid": "2000003", "name": "Other311", "score": 10, "aid": "other-id", "abbr": "ZZZ", "alName": "Other", "serverId": 311},
            ]
        }
        line = {
            "command": "alliance.declare.war.personal.rank",
            "capturedAt": "2026-09-09T06:00:00Z",
            "sequence": 42,
            "payload": payload,
        }
        (raw / "responses.jsonl").write_text(json.dumps(line) + "\n", encoding="utf-8")

        other_raw = sessions / "other-session" / "raw"
        other_raw.mkdir(parents=True)
        (other_raw / "responses.jsonl").write_text(
            json.dumps({"command": "al.rank", "capturedAt": "2026-09-09T05:00:00Z", "payload": {}}) + "\n",
            encoding="utf-8",
        )

        snapshot, summary = build_glory_war_snapshot(session_id, sessions)
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

        found = find_glory_war_sessions(
            sessions,
            [
                {"id": "glory-test", "label": "Full Data Discovery"},
                {"id": "other-session", "label": "Other"},
            ],
        )
        assert [row["id"] for row in found] == ["glory-test"]

    print("Verified Glory War state totals, opponent identity, result, WDZ-only archive, and saved-session discovery import.")


if __name__ == "__main__":
    main()
