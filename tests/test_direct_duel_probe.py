from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
if str(DESKTOP) not in sys.path:
    sys.path.insert(0, str(DESKTOP))

from direct_duel import expected_commands, probe_complete, summarize_response, validate_sync_summary
from normalizers import AllianceDuelNormalizer


def full_sync_summary(*, completed_days: bool = True, include_group: bool = True) -> dict:
    ranks = ["current_day_combined", "weekly_combined", "weekly_own_alliance"]
    if completed_days:
        ranks.append("completed_days")
    datasets = [
        {"dataset": "alliance_duel_rankings"},
        {"dataset": "alliance_duel_results"},
        {"dataset": "alliance_duel_season"},
    ]
    if include_group:
        datasets.append({"dataset": "alliance_duel_group"})
    return {
        "datasets": datasets,
        "captureQuality": {
            "rankTypesCaptured": ranks,
            "officialResultsCaptured": True,
            "seasonCaptured": True,
        },
    }


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
    summary = full_sync_summary()
    valid, missing = validate_sync_summary(summary)
    assert valid
    assert missing == []

    summary["captureQuality"]["rankTypesCaptured"].remove("weekly_combined")
    valid, missing = validate_sync_summary(summary)
    assert not valid
    assert missing == ["weekly_combined"]


def test_sync_validation_requires_group_context() -> None:
    valid, missing = validate_sync_summary(full_sync_summary(include_group=False))
    assert not valid
    assert missing == ["duel_group_context"]


def test_first_day_sync_does_not_require_completed_day_snapshot() -> None:
    # On the first active Duel day, type 3 can validly return an empty rankInfo.
    # The response itself is required by probe_complete, but the normalizer has
    # no player rows to persist as a completed_days snapshot yet.
    valid, missing = validate_sync_summary(full_sync_summary(completed_days=False))
    assert valid
    assert missing == []


def test_group_info_normalizes_full_matchup_context() -> None:
    payload = {
        "_id": 1922,
        "groupInfos": [
            {
                "roundResult": "",
                "name": "Unified Raiders",
                "rankType": 3,
                "allianceId": "uf3r-id",
                "abbr": "UF3R",
                "serverId": 290,
                "group": "435_3_5",
                "position": 3,
            },
            {
                "roundResult": "",
                "name": "Zhus Wrath",
                "rankType": 3,
                "allianceId": "wdz-id",
                "abbr": "WDZ",
                "serverId": 305,
                "group": "435_3_5",
                "position": 4,
            },
        ],
    }
    snapshots = AllianceDuelNormalizer.normalize(
        "get.alliance.duel.group.info", payload, "2026-09-29T08:41:36Z", 12
    )
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert snapshot.dataset == "alliance_duel_group"
    assert snapshot.context["duelGroup"] == "435_3_5"
    assert snapshot.context["groupCount"] == 2
    uf3r = next(row for row in snapshot.rows if row["allianceAbbr"] == "UF3R")
    assert uf3r["allianceName"] == "Unified Raiders"
    assert uf3r["serverId"] == 290
    assert uf3r["group"] == "435_3_5"
    assert uf3r["position"] == 3


def test_combined_rank_preserves_overall_and_alliance_positions() -> None:
    payload = {
        "type": 0,
        "rankInfo": [
            {"uid": "x1", "name": "X1", "abbr": "UF3R", "score": 900},
            {"uid": "w1", "name": "W1", "abbr": "WDZ", "score": 800},
            {"uid": "x2", "name": "X2", "abbr": "UF3R", "score": 700},
            {"uid": "w2", "name": "W2", "abbr": "WDZ", "score": 600},
        ],
    }
    snapshot = AllianceDuelNormalizer.normalize(
        "al.battle.rank.info", payload, "2026-09-29T08:41:36Z", 13
    )[0]
    w2 = next(row for row in snapshot.rows if row["uid"] == "w2")
    assert w2["position"] == 4
    assert w2["overallPosition"] == 4
    assert w2["alliancePosition"] == 2


def test_completed_day_positions_reset_per_day() -> None:
    payload = {
        "type": 3,
        "rankInfo": [
            [
                {"uid": "d1w", "name": "D1 W", "abbr": "WDZ", "score": 100},
                {"uid": "d1x", "name": "D1 X", "abbr": "UF3R", "score": 90},
            ],
            [
                {"uid": "d2x", "name": "D2 X", "abbr": "UF3R", "score": 110},
                {"uid": "d2w", "name": "D2 W", "abbr": "WDZ", "score": 80},
            ],
        ],
    }
    snapshot = AllianceDuelNormalizer.normalize(
        "al.battle.rank.info", payload, "2026-09-30T08:41:36Z", 14
    )[0]
    rows = {row["uid"]: row for row in snapshot.rows}
    assert rows["d1w"]["dayIndex"] == 1
    assert rows["d1w"]["overallPosition"] == 1
    assert rows["d1x"]["overallPosition"] == 2
    assert rows["d2x"]["dayIndex"] == 2
    assert rows["d2x"]["overallPosition"] == 1
    assert rows["d2w"]["overallPosition"] == 2
    assert rows["d2w"]["alliancePosition"] == 1


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


def run_all() -> None:
    tests = [
        value for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"Direct Duel helper tests passed: {len(tests)}")


if __name__ == "__main__":
    run_all()
