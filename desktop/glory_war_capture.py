from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from normalizers import Snapshot
from utils import json_hash


GLORY_WAR_PURPOSE = "Glory War Score Capture"
GLORY_WAR_COMMAND = "alliance.declare.war.personal.rank"
PRIMARY_ALLIANCE = "WDZ"

_UID_KEYS = ("uid", "userId", "user_id", "playerId", "player_id", "roleId", "role_id")
_NAME_KEYS = ("name", "userName", "user_name", "playerName", "player_name", "roleName", "role_name", "nickname", "nickName")
_SCORE_KEYS = ("score", "totalScore", "total_score", "warScore", "war_score", "points", "point", "value")
_POSITION_KEYS = ("rank", "position", "pos", "ranking")
_ALLIANCE_ID_KEYS = ("aid", "allianceId", "alliance_id")
_ALLIANCE_ABBR_KEYS = ("abbr", "allianceAbbr", "alliance_abbr", "alAbbr", "allianceTag")
_ALLIANCE_NAME_KEYS = ("alName", "allianceName", "alliance_name")
_SERVER_KEYS = ("serverId", "server_id", "sid")
_COUNTRY_KEYS = ("country", "countryCode", "country_code")


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _looks_like_uid(value: Any) -> bool:
    text = str(value or "").strip()
    return text.isdigit() and 6 <= len(text) <= 24


def _dict_value(row: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if name in row:
            return row.get(name)
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _walk_candidates(value: Any):
    if isinstance(value, dict):
        uid = _dict_value(value, _UID_KEYS)
        score = _int_or_none(_dict_value(value, _SCORE_KEYS))
        if _looks_like_uid(uid) and score is not None:
            yield {
                "uid": str(uid).strip(),
                "name": str(_dict_value(value, _NAME_KEYS) or ""),
                "score": score,
                "position": _int_or_none(_dict_value(value, _POSITION_KEYS)),
                "allianceId": str(_dict_value(value, _ALLIANCE_ID_KEYS) or ""),
                "allianceAbbr": str(_dict_value(value, _ALLIANCE_ABBR_KEYS) or ""),
                "allianceName": str(_dict_value(value, _ALLIANCE_NAME_KEYS) or ""),
                "serverId": _int_or_none(_dict_value(value, _SERVER_KEYS)),
                "country": str(_dict_value(value, _COUNTRY_KEYS) or ""),
            }
        for child in value.values():
            if isinstance(child, (dict, list, tuple)):
                yield from _walk_candidates(child)
        return
    if isinstance(value, (list, tuple)):
        for child in value:
            if isinstance(child, (dict, list, tuple)):
                yield from _walk_candidates(child)


def _alliance_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("allianceId") or ""),
        str(row.get("allianceAbbr") or ""),
        str(row.get("allianceName") or ""),
    )


def _read_latest(session_id: str, sessions_dir: Path) -> tuple[dict[str, Any], str, int | None]:
    path = sessions_dir / session_id / "raw" / "responses.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"responses.jsonl was not found for {session_id}")

    latest: dict[str, Any] | None = None
    latest_at = ""
    latest_sequence: int | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            response = json.loads(line)
        except json.JSONDecodeError:
            continue
        if str(response.get("command") or "") != GLORY_WAR_COMMAND:
            continue
        captured_at = str(response.get("capturedAt") or "")
        if latest is None or captured_at >= latest_at:
            latest = response.get("payload") if isinstance(response.get("payload"), dict) else {"payload": response.get("payload")}
            latest_at = captured_at
            latest_sequence = _int_or_none(response.get("sequence"))

    if latest is None:
        raise ValueError(
            "No Glory War personal ranking response was captured. Open the Glory War personal score ranking before stopping."
        )
    return latest, latest_at, latest_sequence


def build_glory_war_snapshot(
    session_id: str,
    sessions_dir: Path,
    primary_alliance: str = PRIMARY_ALLIANCE,
) -> tuple[Snapshot, dict[str, Any]]:
    payload, captured_at, sequence = _read_latest(session_id, sessions_dir)
    primary_upper = str(primary_alliance or PRIMARY_ALLIANCE).strip().upper()

    best_by_uid: dict[str, dict[str, Any]] = {}
    for candidate in _walk_candidates(payload):
        uid = str(candidate.get("uid") or "")
        current = best_by_uid.get(uid)
        if current is None or int(candidate.get("score") or 0) > int(current.get("score") or 0):
            best_by_uid[uid] = candidate

    players = list(best_by_uid.values())
    if not players:
        raise ValueError("The Glory War ranking response was captured, but no player score rows could be decoded.")

    primary_rows = [row for row in players if str(row.get("allianceAbbr") or "").strip().upper() == primary_upper]
    if not primary_rows:
        raise ValueError(f"The Glory War ranking did not contain any {primary_upper} player rows.")

    server_counter = Counter(int(row["serverId"]) for row in primary_rows if row.get("serverId") is not None)
    if not server_counter:
        raise ValueError("The Glory War ranking did not expose a server/state ID for the primary alliance.")
    primary_server_id = server_counter.most_common(1)[0][0]

    server_totals: dict[int, int] = defaultdict(int)
    for row in players:
        server_id = row.get("serverId")
        if server_id is None:
            continue
        server_totals[int(server_id)] += int(row.get("score") or 0)

    opponent_candidates = [(score, sid) for sid, score in server_totals.items() if sid != primary_server_id]
    if not opponent_candidates:
        raise ValueError("The Glory War ranking did not expose an opposing state/server.")
    opponent_state_score, opponent_server_id = max(opponent_candidates)
    primary_state_score = int(server_totals.get(primary_server_id, 0))

    opponent_rows = [row for row in players if row.get("serverId") == opponent_server_id]
    opponent_groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in opponent_rows:
        opponent_groups[_alliance_key(row)].append(row)
    if not opponent_groups:
        raise ValueError("The opposing Glory War side did not contain alliance identity fields.")

    opponent_key, opponent_alliance_rows = max(
        opponent_groups.items(),
        key=lambda item: sum(int(row.get("score") or 0) for row in item[1]),
    )
    opponent_alliance_id, opponent_alliance_abbr, opponent_alliance_name = opponent_key

    primary_alliance_score = sum(int(row.get("score") or 0) for row in primary_rows)
    opponent_alliance_score = sum(int(row.get("score") or 0) for row in opponent_alliance_rows)
    result = "WIN" if primary_state_score > opponent_state_score else "LOSS" if primary_state_score < opponent_state_score else "TIE"

    ranking_rows = sorted(primary_rows, key=lambda row: (-int(row.get("score") or 0), str(row.get("name") or "")))
    for index, row in enumerate(ranking_rows, 1):
        row["position"] = index

    context = {
        "battleScope": "state_side_personal_rank",
        "primaryAllianceAbbr": primary_upper,
        "primaryAllianceId": str(primary_rows[0].get("allianceId") or ""),
        "primaryAllianceName": str(primary_rows[0].get("allianceName") or ""),
        "primaryServerId": primary_server_id,
        "opponentAllianceId": opponent_alliance_id,
        "opponentAllianceAbbr": opponent_alliance_abbr,
        "opponentAllianceName": opponent_alliance_name,
        "opponentServerId": opponent_server_id,
        "primaryStateScore": primary_state_score,
        "opponentStateScore": opponent_state_score,
        "primaryAllianceScore": primary_alliance_score,
        "opponentAllianceScore": opponent_alliance_score,
        "result": result,
        "isWin": result == "WIN",
        "opponentPlayerRowsStored": False,
        "capturedPlayerRows": len(players),
        "primaryPlayerRows": len(ranking_rows),
        "sourceCommand": GLORY_WAR_COMMAND,
    }

    snapshot = Snapshot(
        dataset="glory_war_rankings",
        command=GLORY_WAR_COMMAND,
        captured_at=captured_at,
        context=context,
        rows=ranking_rows,
        sequence=sequence,
        source_hash=json_hash({
            "dataset": "glory_war_rankings",
            "sessionId": session_id,
            "capturedAt": captured_at,
            "context": context,
            "rows": ranking_rows,
        }),
    )
    summary = {
        "sessionId": session_id,
        "capturedAt": captured_at,
        "players": len(ranking_rows),
        **context,
    }
    return snapshot, summary
