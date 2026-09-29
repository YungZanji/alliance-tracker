from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
if str(DESKTOP) not in sys.path:
    sys.path.insert(0, str(DESKTOP))

from direct_duel import expected_commands, probe_complete, summarize_response


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


def test_rank_summary_counts_wdz_rows() -> None:
    decoded = {
        "rankInfo": [
            {"uid": "1", "name": "A", "abbr": "WDZ", "score": 10},
            {"uid": "2", "name": "B", "abbr": "ARE", "score": 20},
            {"uid": "3", "name": "C", "abbr": "WDZ", "score": 30},
        ]
    }
    assert summarize_response("al.battle.rank.info", decoded) == "ranking response: 3 player row(s), 2 WDZ row(s)"


def test_season_summary_reports_current_and_previous_groups() -> None:
    decoded = {
        "duelInfo": {"group": "435_3_5"},
        "lastDuelInfo": {"group": "400_3_1"},
    }
    text = summarize_response("get.alliance.duel.season.info", decoded)
    assert "435_3_5" in text
    assert "400_3_1" in text
