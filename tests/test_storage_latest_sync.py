import json
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from storage import Store


class LatestSessionSyncTests(unittest.TestCase):
    def test_latest_session_snapshots_include_already_synced_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = Store(Path(temp_dir) / "tracker.sqlite3")
            with store._connect() as db:
                db.execute(
                    "INSERT INTO sessions(id,label,started_at,stopped_at,response_count,snapshot_count) VALUES(?,?,?,?,?,?)",
                    ("older", "Old", "2026-08-06T10:00:00Z", "2026-08-06T10:01:00Z", 1, 1),
                )
                db.execute(
                    "INSERT INTO sessions(id,label,started_at,stopped_at,response_count,snapshot_count) VALUES(?,?,?,?,?,?)",
                    ("latest", "WDZ", "2026-08-07T11:33:16Z", "2026-08-07T11:33:43Z", 1, 1),
                )
                db.execute(
                    "INSERT INTO snapshots(session_id,dataset,command,captured_at,context_json,rows_json,sequence,source_hash,synced_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    ("older", "alliance_duel_rankings", "al.battle.rank.info", "2026-08-06T10:00:01Z", "{}", "[]", 1, "older-hash", "2026-08-06T10:02:00Z"),
                )
                db.execute(
                    "INSERT INTO snapshots(session_id,dataset,command,captured_at,context_json,rows_json,sequence,source_hash,synced_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        "latest",
                        "alliance_duel_rankings",
                        "al.battle.rank.info",
                        "2026-08-07T11:33:25Z",
                        json.dumps({"rankTypeLabel": "weekly_own_alliance"}),
                        json.dumps([{"uid": "123", "name": "Player", "score": 42}]),
                        2,
                        "latest-hash",
                        "2026-08-07T11:35:00Z",
                    ),
                )

            session_id, snapshots = store.latest_session_snapshots()
            self.assertEqual(session_id, "latest")
            self.assertEqual(len(snapshots), 1)
            self.assertEqual(snapshots[0]["source_hash"], "latest-hash")
            self.assertEqual(snapshots[0]["context"]["rankTypeLabel"], "weekly_own_alliance")
            self.assertEqual(snapshots[0]["rows"][0]["score"], 42)


if __name__ == "__main__":
    unittest.main()
