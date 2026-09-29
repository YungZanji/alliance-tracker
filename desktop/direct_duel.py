from __future__ import annotations

from collections import Counter
from typing import Any

DIRECT_DUEL_MODES = ("previous", "current", "context", "both", "explore")
DIRECT_DUEL_CONTEXT_COMMANDS = (
    "get.alliance.duel.season.info",
    "get.alliance.duel.group.info",
    "al.battle.week.result.info",
)


def expected_commands(mode: str) -> Counter[str]:
    selected = str(mode or "previous").lower()
    if selected not in DIRECT_DUEL_MODES:
        raise ValueError(f"Unsupported Direct Duel mode: {selected}")
    commands = Counter(DIRECT_DUEL_CONTEXT_COMMANDS)
    if selected in {"current", "previous"}:
        commands["al.battle.rank.info"] += 1
    elif selected == "both":
        commands["al.battle.rank.info"] += 2
    elif selected == "explore":
        # Explorer sends 21 bounded read-only requests. Some experimental
        # argument shapes may be ignored or may not receive a response, so the
        # UI packages on a timed grace period rather than requiring these counts.
        commands["get.alliance.duel.group.info"] = 2
        commands["al.battle.week.result.info"] = 3
        commands["al.battle.rank.info"] = 15
    return commands


def probe_complete(mode: str, observed: Counter[str]) -> bool:
    wanted = expected_commands(mode)
    return all(int(observed.get(command, 0)) >= count for command, count in wanted.items())


def _find_key(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = _find_key(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_key(child, key)
            if found is not None:
                return found
    return None


def _flatten_player_rows(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if any(key in value for key in ("uid", "name", "score", "aid")):
            rows.append(value)
        else:
            for child in value.values():
                rows.extend(_flatten_player_rows(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(_flatten_player_rows(child))
    return rows


def summarize_response(command: str, decoded: Any) -> str:
    command = str(command or "")
    if command == "al.battle.rank.info":
        source = _find_key(decoded, "rankInfo")
        if source is None:
            source = _find_key(decoded, "rankInfos")
        rows = _flatten_player_rows(source)
        wdz = sum(1 for row in rows if str(row.get("abbr") or "").upper() == "WDZ")
        rank_type = _find_key(decoded, "type")
        day_groups = len(source) if isinstance(source, list) and source and isinstance(source[0], list) else 0
        extra = f", {day_groups} day group(s)" if day_groups else ""
        return f"ranking type {rank_type}: {len(rows)} player row(s), {wdz} WDZ row(s){extra}"

    if command == "get.alliance.duel.season.info":
        current = _find_key(decoded, "duelInfo")
        previous = _find_key(decoded, "lastDuelInfo")
        current_group = current.get("group") if isinstance(current, dict) else ""
        previous_group = previous.get("group") if isinstance(previous, dict) else ""
        return f"season context: current={current_group or '—'}, previous={previous_group or '—'}"

    if command == "get.alliance.duel.group.info":
        rows = _find_key(decoded, "groupInfos")
        count = len(rows) if isinstance(rows, list) else 0
        return f"duel group context: {count} alliance row(s)"

    if command == "al.battle.week.result.info":
        rows = _find_key(decoded, "resultArray")
        count = len(rows) if isinstance(rows, list) else 0
        start = _find_key(decoded, "startTime")
        return f"week results: start={start or '—'}, {count} day result(s)"

    return command or "unknown response"
