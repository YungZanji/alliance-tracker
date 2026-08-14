from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from utils import integer, json_hash


@dataclass
class Snapshot:
    dataset: str
    command: str
    captured_at: str
    context: dict[str, Any]
    rows: list[dict[str, Any]]
    sequence: int | None
    source_hash: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "dataset": self.dataset,
            "command": self.command,
            "capturedAt": self.captured_at,
            "context": self.context,
            "rows": self.rows,
            "sourceSequence": self.sequence,
            "sourceHash": self.source_hash,
        }


def _is_player(value: Any) -> bool:
    return isinstance(value, dict) and any(
        key in value for key in ("uid", "name", "score", "aid")
    )


def _players(
    value: Any, group: int | None = None
) -> list[tuple[int | None, dict[str, Any]]]:
    result: list[tuple[int | None, dict[str, Any]]] = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            if _is_player(item):
                result.append((group, item))
            elif isinstance(item, list):
                result.extend(_players(item, index))
            elif isinstance(item, dict):
                result.extend(_players(list(item.values()), group))
    elif isinstance(value, dict):
        result.extend(_players(list(value.values()), group))
    return result


class AllianceDuelNormalizer:
    RANKING_COMMAND = "al.battle.rank.info"
    RESULTS_COMMAND = "al.battle.week.result.info"
    SEASON_COMMAND = "get.alliance.duel.season.info"

    LABELS = {
        0: "current_day_combined",
        1: "weekly_combined",
        2: "weekly_own_alliance",
        3: "completed_days",
    }

    @classmethod
    def normalize(
        cls,
        command: str,
        payload: Any,
        captured_at: str,
        sequence: int | None,
    ) -> list[Snapshot]:
        if command == cls.RANKING_COMMAND:
            return cls._rankings(payload, captured_at, sequence)
        if command == cls.RESULTS_COMMAND:
            return cls._results(payload, captured_at, sequence)
        if command == cls.SEASON_COMMAND:
            return [
                Snapshot(
                    "alliance_duel_season",
                    cls.SEASON_COMMAND,
                    captured_at,
                    {},
                    [payload],
                    sequence,
                    json_hash(payload),
                )
            ]
        return []

    @classmethod
    def _rankings(
        cls, payload: Any, captured_at: str, sequence: int | None
    ) -> list[Snapshot]:
        if not isinstance(payload, dict):
            return []

        rank_type = integer(payload.get("type"))
        source_rows = _players(payload.get("rankInfo"))
        if not source_rows:
            return []

        rows: list[dict[str, Any]] = []
        counts: dict[str, int] = {}
        totals: dict[str, int] = {}

        for position, (group, source) in enumerate(source_rows, 1):
            abbr = str(source.get("abbr") or "")
            score = integer(source.get("score"))
            counts[abbr] = counts.get(abbr, 0) + 1
            totals[abbr] = totals.get(abbr, 0) + score
            rows.append(
                {
                    "position": position,
                    "dayIndex": None if group is None else group + 1,
                    "uid": str(source.get("uid") or ""),
                    "name": str(source.get("name") or ""),
                    "score": score,
                    "allianceId": str(source.get("aid") or ""),
                    "allianceAbbr": abbr,
                    "allianceName": str(source.get("alName") or ""),
                    "serverId": source.get("serverId"),
                    "country": str(source.get("country") or ""),
                    "updatedAt": source.get("time"),
                }
            )

        context = {
            "rankType": rank_type,
            "rankTypeLabel": cls.LABELS.get(rank_type, f"unknown_{rank_type}"),
            "allianceCounts": counts,
            "allianceTotals": totals,
            "messageId": payload.get("_id"),
            "messageTime": payload.get("_time"),
        }
        return [
            Snapshot(
                "alliance_duel_rankings",
                cls.RANKING_COMMAND,
                captured_at,
                context,
                rows,
                sequence,
                json_hash(payload),
            )
        ]

    @classmethod
    def _results(
        cls, payload: Any, captured_at: str, sequence: int | None
    ) -> list[Snapshot]:
        if not isinstance(payload, dict) or not isinstance(
            payload.get("resultArray"), list
        ):
            return []

        rows = []
        for index, source in enumerate(payload["resultArray"], 1):
            if isinstance(source, dict):
                rows.append({"dayIndex": index, **source})

        context = {
            "weekStartTime": payload.get("startTime"),
            "messageId": payload.get("_id"),
            "messageTime": payload.get("_time"),
        }
        return [
            Snapshot(
                "alliance_duel_results",
                cls.RESULTS_COMMAND,
                captured_at,
                context,
                rows,
                sequence,
                json_hash(payload),
            )
        ]
