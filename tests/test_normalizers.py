from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop"))

from normalizers import AllianceDuelNormalizer  # noqa: E402


class AllianceDuelNormalizerTests(unittest.TestCase):
    def test_ranking_response_produces_snapshot(self) -> None:
        payload = {
            "type": 2,
            "rankInfo": [
                {
                    "uid": "101",
                    "name": "Player One",
                    "score": 123456,
                    "aid": "9001",
                    "abbr": "WDZ",
                    "alName": "Alliance",
                    "serverId": 305,
                    "country": "CA",
                },
                {
                    "uid": "102",
                    "name": "Player Two",
                    "score": 654321,
                    "aid": "9001",
                    "abbr": "WDZ",
                    "alName": "Alliance",
                    "serverId": 305,
                    "country": "US",
                },
            ],
            "_id": 42,
            "_time": 100,
        }

        snapshots = AllianceDuelNormalizer.normalize(
            "al.battle.rank.info",
            payload,
            "2026-08-06T00:00:00.000Z",
            7,
        )

        self.assertEqual(len(snapshots), 1)
        snapshot = snapshots[0]
        self.assertEqual(snapshot.command, "al.battle.rank.info")
        self.assertEqual(snapshot.dataset, "alliance_duel_rankings")
        self.assertEqual(snapshot.context["rankTypeLabel"], "weekly_own_alliance")
        self.assertEqual(snapshot.context["allianceTotals"]["WDZ"], 777777)
        self.assertEqual(len(snapshot.rows), 2)
        self.assertEqual(snapshot.rows[0]["uid"], "101")
        self.assertEqual(snapshot.rows[1]["score"], 654321)

    def test_completed_days_preserve_day_index(self) -> None:
        payload = {
            "type": 3,
            "rankInfo": [
                [{"uid": "1", "name": "A", "score": 10, "abbr": "WDZ"}],
                [{"uid": "1", "name": "A", "score": 20, "abbr": "WDZ"}],
            ],
        }

        snapshot = AllianceDuelNormalizer.normalize(
            "al.battle.rank.info",
            payload,
            "2026-08-06T00:00:00.000Z",
            8,
        )[0]

        self.assertEqual([row["dayIndex"] for row in snapshot.rows], [1, 2])


if __name__ == "__main__":
    unittest.main()
