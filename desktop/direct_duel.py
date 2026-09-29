from __future__ import annotations

from collections import Counter
from typing import Any

DIRECT_DUEL_MODES = ("previous", "current", "context", "both")
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


def summarize_response(command: str, decoded: Any) -> str:
    command = str(command or "")
    if command == "al.battle.rank.info":
        rows = _find_key(decoded, "rankInfo")
        if not isinstance(rows, list):
            rows = _find_key(decoded, "rankInfos")
        count = len(rows) if isinstance(rows, list) else 0
        wdz = 0
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and str(row.get("abbr") or "").upper() == "WDZ":
                    wdz += 1
        return f"ranking response: {count} player row(s), {wdz} WDZ row(s)"

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
        return f"week results: {count} day result(s)"

    return command or "unknown response"
