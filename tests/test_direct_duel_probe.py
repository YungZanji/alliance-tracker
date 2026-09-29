from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
if str(DESKTOP) not in sys.path:
    sys.path.insert(0, str(DESKTOP))

from direct_duel import expected_commands, probe_complete, summarize_response, validate_sync_summary


def test_previous_probe_requires_context_and_one_rank_response() -> None:
    expected = expected_commands("previous")
    assert expected["get.alliance.duel.season.info"] == 1
    assert expected["get.alliance.duel.group.info"] == 1
    assert expected["al.battle.week.result.info"] == 1
    assert expected["al.battle.rank.info"] == 1

    observed = Counter(expected)
    assert probe_complete("previous", observed)
    observed["al.battle.rank.info"] = 0
    assert not probe_complete("previous", observed)


def test_both_probe_requires_two_rank_responses() -> None:
    expected = expected_commands("both")
    assert expected["al.battle.rank.info"] == 2


def test_full_sync_requires_all_four_rank_views() -> None:
    expected = expected_commands("sync")
    assert expected["get.alliance.duel.season.info"] == 1
    assert expected["get.alliance.duel.group.info"] == 1
    assert expected["al.battle.week.result.info"] == 1
    assert expected["al.battle.rank.info"] == 4
    assert probe_complete("sync", Counter(expected))


def test_sync_validation_requires_every_authoritative_dataset() -> None:
    summary = {
        "captureQuality": {
            "rankTypesCaptured": [
                "current_day_combined",
                "weekly_combined",
                "weekly_own_alliance",
                "completed_days",
            ],
            "officialResultsCaptured": True,
            "seasonCaptured": True,
        }
    }
    valid, missing = validate_sync_summary(summary)
    assert valid
    assert missing == []

    summary["captureQuality"]["rankTypesCaptured"].remove("weekly_combined")
    valid, missing = validate_sync_summary(summary)
    assert not valid
    assert missing == ["weekly_combined"]


def test_first_day_sync_does_not_require_completed_day_snapshot() -> None:
    # On the first active Duel day, type 3 can validly return an empty rankInfo.
    # The response itself is required by probe_complete, but the normalizer has
    # no player rows to persist as a completed_days snapshot yet.
    summary = {
        "captureQuality": {
            "rankTypesCaptured": [
                "current_day_combined",
                "weekly_combined",
                "weekly_own_alliance",
            ],
            "officialResultsCaptured": True,
            "seasonCaptured": True,
        }
    }
    valid, missing = validate_sync_summary(summary)
    assert valid
    assert missing == []


def test_explorer_tracks_bounded_request_counts() -> None:
    expected = expected_commands("explore")
    assert expected["get.alliance.duel.season.info"] == 1
    assert expected["get.alliance.duel.group.info"] == 2
    assert expected["al.battle.week.result.info"] == 3
    assert expected["al.battle.rank.info"] == 15


def test_rank_summary_counts_wdz_rows() -> None:
    decoded = {
        "type": 1,
        "rankInfo": [
            {"uid": "1", "name": "A", "abbr": "WDZ", "score": 10},
            {"uid": "2", "name": "B", "abbr": "ARE", "score": 20},
            {"uid": "3", "name": "C", "abbr": "WDZ", "score": 30},
        ],
    }
    assert summarize_response("al.battle.rank.info", decoded) == "ranking type 1: 3 player row(s), 2 WDZ row(s)"


def test_rank_summary_flattens_completed_day_groups() -> None:
    decoded = {
        "type": 3,
        "rankInfo": [[
            {"uid": "1", "name": "A", "abbr": "WDZ", "score": 10},
            {"uid": "2", "name": "B", "abbr": "UF3R", "score": 20},
        ]],
    }
    assert summarize_response("al.battle.rank.info", decoded) == (
        "ranking type 3: 2 player row(s), 1 WDZ row(s), 1 day group(s)"
    )


def test_season_summary_reports_current_and_previous_groups() -> None:
    decoded = {
        "duelInfo": {"group": "435_3_5"},
        "lastDuelInfo": {"group": "400_3_1"},
    }
    text = summarize_response("get.alliance.duel.season.info", decoded)
    assert "435_3_5" in text
    assert "400_3_1" in text
