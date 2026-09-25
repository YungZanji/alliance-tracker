from __future__ import annotations

import json
from datetime import datetime, timezone
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from normalizers import Snapshot
from utils import json_hash


GLORY_WAR_PURPOSE = "Glory War Score Capture"
GLORY_WAR_COMMAND = "alliance.declare.war.personal.rank"
GLORY_WAR_HISTORY_SCORE_COMMAND = "domain.al.war.member.score.his"
GLORY_WAR_HISTORY_INDEX_COMMAND = "domain.al.his"
GLORY_WAR_CAPTURE_COMMANDS = (GLORY_WAR_COMMAND, GLORY_WAR_HISTORY_SCORE_COMMAND)
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


def session_has_glory_war(session_id: str, sessions_dir: Path) -> bool:
    path = sessions_dir / session_id / "raw" / "responses.jsonl"
    if not path.exists():
        return False
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not any(command in line for command in GLORY_WAR_CAPTURE_COMMANDS):
                    continue
                try:
                    response = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if str(response.get("command") or "") in GLORY_WAR_CAPTURE_COMMANDS:
                    return True
    except OSError:
        return False
    return False


def find_glory_war_sessions(
    sessions_dir: Path,
    sessions: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for session in sessions:
        session_id = str(session.get("id") or "").strip()
        if session_id and session_has_glory_war(session_id, sessions_dir):
            output.append(dict(session))
    return output


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


def _build_live_glory_war_snapshot(
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


def _response_time(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _iso_from_millis(value: Any) -> str:
    millis = _int_or_none(value)
    if millis is None or millis <= 0:
        return ""
    try:
        return datetime.fromtimestamp(millis / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return ""


def _read_responses(session_id: str, sessions_dir: Path) -> list[dict[str, Any]]:
    path = sessions_dir / session_id / "raw" / "responses.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"responses.jsonl was not found for {session_id}")
    output: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            response = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(response, dict):
            output.append(response)
    return output


def _history_rows(response: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
    alliance = payload.get("alInfo") if isinstance(payload.get("alInfo"), dict) else {}
    raw_rows = payload.get("memberScores") if isinstance(payload.get("memberScores"), list) else []
    rows: list[dict[str, Any]] = []
    for raw in raw_rows:
        if not isinstance(raw, dict):
            continue
        uid = str(raw.get("uid") or "").strip()
        score = _int_or_none(raw.get("score"))
        if not _looks_like_uid(uid) or score is None:
            continue
        rows.append({
            "uid": uid,
            "name": str(raw.get("name") or ""),
            "score": score,
            "position": None,
            "allianceId": str(alliance.get("allianceId") or ""),
            "allianceAbbr": str(alliance.get("abbr") or ""),
            "allianceName": str(alliance.get("alName") or ""),
            "serverId": _int_or_none(alliance.get("serverId")),
            "country": str(raw.get("country") or ""),
        })
    return alliance, rows


def _same_alliance(side: dict[str, Any], alliance: dict[str, Any]) -> bool:
    side_id = str(side.get("allianceId") or "")
    alliance_id = str(alliance.get("allianceId") or "")
    if side_id and alliance_id:
        return side_id == alliance_id
    return (
        str(side.get("abbr") or "").strip().lower() == str(alliance.get("abbr") or "").strip().lower()
        and _int_or_none(side.get("serverId")) == _int_or_none(alliance.get("serverId"))
    )


def _match_history_record(
    responses: list[dict[str, Any]],
    primary_alliance: dict[str, Any],
    opponent_alliance: dict[str, Any],
    primary_count: int,
    opponent_count: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    candidates: list[tuple[tuple[int, int, int, int], dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    for response in responses:
        if str(response.get("command") or "") != GLORY_WAR_HISTORY_INDEX_COMMAND:
            continue
        payload = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        wars = payload.get("warHis") if isinstance(payload.get("warHis"), list) else []
        for war in wars:
            if not isinstance(war, dict):
                continue
            sides = war.get("vsInfo") if isinstance(war.get("vsInfo"), list) else []
            primary_side = next((side for side in sides if isinstance(side, dict) and _same_alliance(side, primary_alliance)), None)
            opponent_side = next((side for side in sides if isinstance(side, dict) and _same_alliance(side, opponent_alliance)), None)
            if primary_side is None or opponent_side is None:
                continue
            primary_fighters = max(0, _int_or_none(primary_side.get("fightMember")) or 0)
            opponent_fighters = max(0, _int_or_none(opponent_side.get("fightMember")) or 0)
            count_distance = abs(primary_fighters - primary_count) + abs(opponent_fighters - opponent_count)
            exact_counts = 0 if count_distance == 0 else 1
            attack_penalty = 0
            primary_attack = _int_or_none(primary_alliance.get("attack"))
            opponent_attack = _int_or_none(opponent_alliance.get("attack"))
            if primary_attack is not None and _int_or_none(primary_side.get("isAtk")) != primary_attack:
                attack_penalty += 1
            if opponent_attack is not None and _int_or_none(opponent_side.get("isAtk")) != opponent_attack:
                attack_penalty += 1
            end_time = max(0, _int_or_none(war.get("endTime")) or 0)
            candidates.append(((exact_counts, attack_penalty, count_distance, -end_time), war, primary_side, opponent_side))
    if not candidates:
        return None, None, None
    candidates.sort(key=lambda item: item[0])
    _rank, war, primary_side, opponent_side = candidates[0]
    return war, primary_side, opponent_side


def _latest_historical_pair(
    responses: list[dict[str, Any]],
    primary_alliance: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]] | None:
    primary_upper = str(primary_alliance or PRIMARY_ALLIANCE).strip().upper()
    score_responses = [
        response for response in responses
        if str(response.get("command") or "") == GLORY_WAR_HISTORY_SCORE_COMMAND
        and isinstance(response.get("payload"), dict)
    ]
    primary_candidates = []
    for response in score_responses:
        alliance = response["payload"].get("alInfo") if isinstance(response["payload"].get("alInfo"), dict) else {}
        if str(alliance.get("abbr") or "").strip().upper() == primary_upper:
            primary_candidates.append(response)
    primary_candidates.sort(key=lambda response: str(response.get("capturedAt") or ""), reverse=True)

    for primary_response in primary_candidates:
        primary_alliance_info, primary_rows = _history_rows(primary_response)
        if not primary_rows:
            continue
        primary_time = _response_time(primary_response.get("capturedAt"))
        opponents: list[tuple[float, dict[str, Any]]] = []
        for response in score_responses:
            if response is primary_response:
                continue
            opponent_info, opponent_rows = _history_rows(response)
            if not opponent_rows:
                continue
            if str(opponent_info.get("abbr") or "").strip().upper() == primary_upper:
                continue
            delta = abs(_response_time(response.get("capturedAt")) - primary_time)
            if delta <= 5.0:
                opponents.append((delta, response))
        if not opponents:
            continue
        opponents.sort(key=lambda item: (item[0], str(item[1].get("capturedAt") or "")))
        opponent_response = opponents[0][1]
        opponent_alliance_info, opponent_rows = _history_rows(opponent_response)
        return (
            primary_response,
            primary_alliance_info,
            primary_rows,
            opponent_response,
            opponent_alliance_info,
            opponent_rows,
        )
    return None


def _build_historical_glory_war_snapshot(
    session_id: str,
    sessions_dir: Path,
    primary_alliance: str = PRIMARY_ALLIANCE,
) -> tuple[Snapshot, dict[str, Any]]:
    responses = _read_responses(session_id, sessions_dir)
    pair = _latest_historical_pair(responses, primary_alliance)
    if pair is None:
        raise ValueError(
            "Historical Glory War scores were not captured as a complete pair. Open Glory War → Logs → View so both alliance score lists load."
        )

    (
        primary_response,
        primary_info,
        primary_rows,
        opponent_response,
        opponent_info,
        opponent_rows,
    ) = pair

    war, primary_side, opponent_side = _match_history_record(
        responses,
        primary_info,
        opponent_info,
        len(primary_rows),
        len(opponent_rows),
    )

    primary_score = sum(int(row.get("score") or 0) for row in primary_rows)
    opponent_score = sum(int(row.get("score") or 0) for row in opponent_rows)
    result = ""
    if primary_side is not None and primary_side.get("isWin") is not None:
        result = "WIN" if int(primary_side.get("isWin") or 0) == 1 else "LOSS"
    if not result:
        result = "WIN" if primary_score > opponent_score else "LOSS" if primary_score < opponent_score else "TIE"

    ranking_rows = sorted(primary_rows, key=lambda row: (-int(row.get("score") or 0), str(row.get("name") or "")))
    for index, row in enumerate(ranking_rows, 1):
        row["position"] = index

    response_captured_at = max(
        str(primary_response.get("capturedAt") or ""),
        str(opponent_response.get("capturedAt") or ""),
    )
    battle_end_ms = _int_or_none(war.get("endTime")) if war is not None else None
    battle_start_ms = _int_or_none(war.get("startTime")) if war is not None else None
    captured_at = _iso_from_millis(battle_end_ms) or response_captured_at
    sequence_values = [
        _int_or_none(primary_response.get("sequence")),
        _int_or_none(opponent_response.get("sequence")),
    ]
    sequence = max((value for value in sequence_values if value is not None), default=None)

    primary_server_id = _int_or_none(primary_info.get("serverId")) or _int_or_none(primary_side.get("serverId") if primary_side else None)
    opponent_server_id = _int_or_none(opponent_info.get("serverId")) or _int_or_none(opponent_side.get("serverId") if opponent_side else None)
    context = {
        "battleScope": "alliance_log_member_scores",
        "sourceMode": "logs_history",
        "primaryAllianceAbbr": str(primary_info.get("abbr") or primary_alliance).strip(),
        "primaryAllianceId": str(primary_info.get("allianceId") or ""),
        "primaryAllianceName": str(primary_info.get("alName") or ""),
        "primaryServerId": primary_server_id,
        "opponentAllianceId": str(opponent_info.get("allianceId") or ""),
        "opponentAllianceAbbr": str(opponent_info.get("abbr") or ""),
        "opponentAllianceName": str(opponent_info.get("alName") or ""),
        "opponentServerId": opponent_server_id,
        "primaryStateScore": primary_score,
        "opponentStateScore": opponent_score,
        "primaryAllianceScore": primary_score,
        "opponentAllianceScore": opponent_score,
        "result": result,
        "isWin": result == "WIN",
        "opponentPlayerRowsStored": False,
        "capturedPlayerRows": len(primary_rows) + len(opponent_rows),
        "primaryPlayerRows": len(ranking_rows),
        "sourceCommand": GLORY_WAR_HISTORY_SCORE_COMMAND,
        "historyCommand": GLORY_WAR_HISTORY_INDEX_COMMAND if war is not None else "",
        "historicalMatchDetected": war is not None,
        "historicalBattleStartTime": battle_start_ms,
        "historicalBattleEndTime": battle_end_ms,
        "historyFightMemberPrimary": _int_or_none(primary_side.get("fightMember")) if primary_side else None,
        "historyFightMemberOpponent": _int_or_none(opponent_side.get("fightMember")) if opponent_side else None,
    }

    snapshot = Snapshot(
        dataset="glory_war_rankings",
        command=GLORY_WAR_HISTORY_SCORE_COMMAND,
        captured_at=captured_at,
        context=context,
        rows=ranking_rows,
        sequence=sequence,
        source_hash=json_hash({
            "dataset": "glory_war_rankings",
            "sourceMode": "logs_history",
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


def _latest_command_time(session_id: str, sessions_dir: Path, commands: set[str]) -> str:
    latest = ""
    for response in _read_responses(session_id, sessions_dir):
        if str(response.get("command") or "") not in commands:
            continue
        captured_at = str(response.get("capturedAt") or "")
        if captured_at > latest:
            latest = captured_at
    return latest


def build_glory_war_snapshot(
    session_id: str,
    sessions_dir: Path,
    primary_alliance: str = PRIMARY_ALLIANCE,
) -> tuple[Snapshot, dict[str, Any]]:
    live_at = _latest_command_time(session_id, sessions_dir, {GLORY_WAR_COMMAND})
    history_at = _latest_command_time(session_id, sessions_dir, {GLORY_WAR_HISTORY_SCORE_COMMAND})

    if history_at and history_at >= live_at:
        try:
            return _build_historical_glory_war_snapshot(session_id, sessions_dir, primary_alliance)
        except ValueError:
            if not live_at:
                raise
    if live_at:
        return _build_live_glory_war_snapshot(session_id, sessions_dir, primary_alliance)
    if history_at:
        return _build_historical_glory_war_snapshot(session_id, sessions_dir, primary_alliance)
    raise ValueError(
        "No Glory War score response was captured. Open either the post-war Personal Ranking or Glory War → Logs → View before stopping."
    )
