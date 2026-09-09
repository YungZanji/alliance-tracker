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
    def test_score_rows_override_activity_only_credit_cutoff_is_pacific_and_opponent_is_detected(self) -> None:
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
                        "opponentServerId": 311,
                        "list": [
                            {"uid": "1000000000000001", "name": "Alpha", "score": 8_000_000, "rank": 4, "serverId": 305},
                            {"uid": "2000000000000001", "name": "Enemy", "score": 9_000_000, "rank": 2, "serverId": 311},
                        ],
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
            self.assertEqual(summary["primaryServerId"], 305)
            self.assertEqual(summary["opponentServerId"], 311)
            self.assertEqual(summary["opponentLabel"], "State 311")
            self.assertEqual(summary["opponentDetectionConfidence"], "explicit")

            self.assertEqual(ranking.rows[0]["uid"], "1000000000000001")
            self.assertEqual(ranking.rows[0]["score"], 8_500_000)
            self.assertEqual(ranking.rows[0]["position"], 3)
            self.assertEqual(ranking.context["opponentServerId"], 311)
            self.assertEqual(attendance.context["opponentServerId"], 311)

            attendance_by_uid = {row["uid"]: row for row in attendance.rows}
            self.assertEqual(set(attendance_by_uid), {"1000000000000001", "1000000000000002"})
            self.assertEqual(attendance_by_uid["1000000000000001"]["source"], "leaderboard_score")
            self.assertEqual(attendance_by_uid["1000000000000002"]["source"], "roster_last_seen")
            self.assertNotIn("1000000000000003", attendance_by_uid)
            self.assertNotIn("2000000000000001", attendance_by_uid)

    def test_opponent_can_be_inferred_from_ranking_rows_without_explicit_hint(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            sessions = Path(temp)
            session_id = "svs-ranking-opponent"
            raw = sessions / session_id / "raw"
            raw.mkdir(parents=True)
            response = {
                "command": "server.battle.user.score.rank",
                "capturedAt": "2026-09-12T17:00:00Z",
                "payload": {
                    "list": [
                        {"uid": "1000000000000001", "name": "Alpha", "score": 10, "serverId": 305},
                        {"uid": "2000000000000001", "name": "Enemy A", "score": 20, "serverId": 411},
                        {"uid": "2000000000000002", "name": "Enemy B", "score": 15, "serverId": 411},
                    ]
                },
            }
            (raw / "responses.jsonl").write_text(json.dumps(response) + "\n", encoding="utf-8")
            roster = {
                "capturedAt": "2026-09-12T17:05:00Z",
                "allianceId": "wdz",
                "members": [
                    {"uid": "1000000000000001", "name": "Alpha", "serverId": 305, "lastSeenAtUtc": "2026-09-12T17:00:00Z"}
                ],
            }
            snapshots, summary = build_svs_snapshots(session_id, sessions, roster)
            self.assertEqual(summary["opponentServerId"], 411)
            self.assertEqual(summary["opponentDetectionConfidence"], "ranking_rows")
            self.assertEqual(next(s for s in snapshots if s.dataset == "state_ruler_rankings").context["opponentState"], 411)


if __name__ == "__main__":
    unittest.main()
