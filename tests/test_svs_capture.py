from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from svs_capture import build_svs_snapshots


class SvsCaptureTests(unittest.TestCase):
    def test_score_rows_override_activity_only_credit_and_cutoff_is_pacific(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            sessions = Path(temp)
            session_id = "svs-test"
            raw = sessions / session_id / "raw"
            raw.mkdir(parents=True)
            responses = [
                {
                    "command": "server.battle.user.score.rank",
                    "capturedAt": "2026-08-15T15:20:00.000+00:00",
                    "payload": {
                        "list": [
                            {"uid": "1000000000000001", "name": "Alpha", "score": 8_000_000, "rank": 4},
                        ]
                    },
                },
                {
                    "command": "server.battle.user.score.rank",
                    "capturedAt": "2026-08-15T15:21:00.000+00:00",
                    "payload": {
                        "rows": [
                            ["1000000000000001", 8_500_000, 3],
                        ]
                    },
                },
            ]
            (raw / "responses.jsonl").write_text(
                "\n".join(json.dumps(row) for row in responses) + "\n",
                encoding="utf-8",
            )
            roster = {
                "capturedAt": "2026-08-15T15:30:00.000+00:00",
                "allianceId": "wdz",
                "members": [
                    {
                        "uid": "1000000000000001",
                        "name": "Alpha",
                        "serverId": 305,
                        "lastSeenAtUtc": "2026-08-15T12:00:00.000+00:00",
                    },
                    {
                        "uid": "1000000000000002",
                        "name": "Bravo",
                        "serverId": 305,
                        "lastSeenAtUtc": "2026-08-15T14:15:00.000+00:00",
                    },
                    {
                        "uid": "1000000000000003",
                        "name": "Charlie",
                        "serverId": 305,
                        "lastSeenAtUtc": "2026-08-15T13:59:00.000+00:00",
                    },
                ],
            }

            snapshots, summary = build_svs_snapshots(session_id, sessions, roster)

            ranking = next(row for row in snapshots if row.dataset == "state_ruler_rankings")
            attendance = next(row for row in snapshots if row.dataset == "state_ruler_attendance")

            self.assertEqual(summary["windowStart"], "2026-08-15T14:00:00.000+00:00")
            self.assertEqual(summary["windowEnd"], "2026-08-15T15:30:00.000+00:00")
            self.assertEqual(summary["leaderboardPlayers"], 1)
            self.assertEqual(summary["activityOnlyPlayers"], 1)
            self.assertEqual(summary["participants"], 2)

            self.assertEqual(ranking.rows[0]["uid"], "1000000000000001")
            self.assertEqual(ranking.rows[0]["score"], 8_500_000)
            self.assertEqual(ranking.rows[0]["position"], 3)

            attendance_by_uid = {row["uid"]: row for row in attendance.rows}
            self.assertEqual(set(attendance_by_uid), {"1000000000000001", "1000000000000002"})
            self.assertEqual(attendance_by_uid["1000000000000001"]["source"], "leaderboard_score")
            self.assertEqual(attendance_by_uid["1000000000000002"]["source"], "roster_last_seen")
            self.assertNotIn("1000000000000003", attendance_by_uid)


if __name__ == "__main__":
    unittest.main()
