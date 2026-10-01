from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def latest_finished_war(payload: Any, *, now_ms: int | None = None) -> dict[str, Any] | None:
    """Pick the latest recent finished WDZ war with two identifiable sides."""
    if not isinstance(payload, dict) or not isinstance(payload.get("warHis"), list):
        return None
    now = now_ms if now_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    candidates: list[dict[str, Any]] = []
    for war in payload["warHis"]:
        if not isinstance(war, dict):
            continue
        try:
            start, end = int(war.get("startTime")), int(war.get("endTime"))
        except (TypeError, ValueError):
            continue
        if not (0 < end - start <= 86_400_000 and 0 <= now - end <= 8 * 86_400_000):
            continue
        sides = war.get("vsInfo")
        if not isinstance(sides, list) or len(sides) != 2:
            continue
        primary = next((s for s in sides if isinstance(s, dict) and str(s.get("abbr") or "").upper() == "WDZ"), None)
        opponent = next((s for s in sides if isinstance(s, dict) and s is not primary), None)
        if not primary or not opponent:
            continue
        if any(not str(s.get("allianceId") or "") or s.get("isAtk") not in (1, 2) for s in (primary, opponent)):
            continue
        candidates.append({
            "startTime": start, "endTime": end,
            "sides": [
                {"allianceId": str(s["allianceId"]), "abbr": str(s.get("abbr") or ""),
                 "serverId": s.get("serverId"), "attack": int(s["isAtk"]), "isWin": s.get("isWin")}
                for s in (primary, opponent)
            ],
        })
    return max(candidates, key=lambda item: item["endTime"], default=None)


def validate_historical_snapshot(snapshot: Any, target: dict[str, Any]) -> None:
    context = snapshot.context
    primary, opponent = target["sides"]
    if context.get("sourceMode") != "logs_history" or not context.get("historicalMatchDetected"):
        raise ValueError("The score lists did not match a Glory War Logs record.")
    if int(context.get("historicalBattleEndTime") or 0) != target["endTime"]:
        raise ValueError("The score lists belong to a different battle.")
    if (str(context.get("primaryAllianceId")) != primary["allianceId"] or
            str(context.get("opponentAllianceId")) != opponent["allianceId"]):
        raise ValueError("The score lists do not identify both expected alliances.")
    if int(context.get("primaryServerId") or 0) != int(primary.get("serverId") or 0) or \
            int(context.get("opponentServerId") or 0) != int(opponent.get("serverId") or 0):
        raise ValueError("The score lists do not match the battle's states.")
    if primary.get("isWin") in (0, 1):
        expected = "WIN" if primary["isWin"] == 1 else "LOSS"
        if context.get("result") != expected:
            raise ValueError("The score result disagrees with the official war record.")
    if not snapshot.rows or any(int(row.get("score") or 0) < 0 for row in snapshot.rows):
        raise ValueError("The WDZ score list was empty or invalid.")
