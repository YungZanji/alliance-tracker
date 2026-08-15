from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from normalizers import Snapshot
from utils import json_compact, json_hash


SVS_PURPOSE = "SVS Participation + Score Capture"
SVS_SCORE_COMMANDS = (
    "server.battle.user.score.rank",
    "server.battle.score.person.rank",
    "server.battle.rank",
)
PACIFIC = ZoneInfo("America/Vancouver")

_UID_KEYS = ("uid", "userId", "user_id", "playerId", "player_id", "roleId", "role_id")
_NAME_KEYS = ("name", "userName", "user_name", "playerName", "player_name", "roleName", "role_name", "nickname", "nickName")
_SCORE_KEYS = ("score", "totalScore", "total_score", "battleScore", "battle_score", "points", "point", "value")
_POSITION_KEYS = ("rank", "position", "pos", "ranking")
_ALLIANCE_ID_KEYS = ("aid", "allianceId", "alliance_id")
_ALLIANCE_ABBR_KEYS = ("abbr", "allianceAbbr", "alliance_abbr", "alAbbr", "allianceTag")
_ALLIANCE_NAME_KEYS = ("alName", "allianceName", "alliance_name")
_SERVER_KEYS = ("serverId", "server_id", "sid")


def _parse_iso(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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


def _walk_score_candidates(value: Any):
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
            }
        for child in value.values():
            if isinstance(child, (dict, list, tuple)):
                yield from _walk_score_candidates(child)
        return

    if isinstance(value, (list, tuple)):
        # Some State Ruler rank payloads flatten each row to [uid, score, position].
        if len(value) >= 2 and _looks_like_uid(value[0]):
            score = _int_or_none(value[1])
            if score is not None:
                yield {
                    "uid": str(value[0]).strip(),
                    "name": "",
                    "score": score,
                    "position": _int_or_none(value[2]) if len(value) > 2 else None,
                    "allianceId": "",
                    "allianceAbbr": "",
                    "allianceName": "",
                    "serverId": None,
                }
                return
        for child in value:
            if isinstance(child, (dict, list, tuple)):
                yield from _walk_score_candidates(child)


def _activity_window(captured_at: Any) -> tuple[datetime, datetime]:
    end = _parse_iso(captured_at) or datetime.now(timezone.utc)
    local_end = end.astimezone(PACIFIC)
    local_start = datetime.combine(local_end.date(), time(7, 0), tzinfo=PACIFIC)
    if local_end < local_start:
        local_start -= timedelta(days=1)
    return local_start.astimezone(timezone.utc), end


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def _read_score_rows(session_id: str, sessions_dir: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    path = sessions_dir / session_id / "raw" / "responses.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"responses.jsonl was not found for {session_id}")

    best: dict[str, dict[str, Any]] = {}
    source_commands: set[str] = set()
    response_count = 0
    parsed_rows = 0
    latest_capture = ""

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            response = json.loads(line)
        except json.JSONDecodeError:
            continue
        command = str(response.get("command") or "")
        if command not in SVS_SCORE_COMMANDS:
            continue
        response_count += 1
        source_commands.add(command)
        captured_at = str(response.get("capturedAt") or "")
        if captured_at > latest_capture:
            latest_capture = captured_at

        payload = response.get("payload")
        position_fallback = 0
        for candidate in _walk_score_candidates(payload):
            position_fallback += 1
            parsed_rows += 1
            if candidate.get("position") is None:
                candidate["position"] = position_fallback
            candidate["_command"] = command
            candidate["_capturedAt"] = captured_at
            uid = str(candidate.get("uid") or "")
            current = best.get(uid)
            if (
                current is None
                or int(candidate.get("score") or 0) > int(current.get("score") or 0)
                or (
                    int(candidate.get("score") or 0) == int(current.get("score") or 0)
                    and captured_at > str(current.get("_capturedAt") or "")
                )
            ):
                best[uid] = candidate

    return best, {
        "scoreResponseCount": response_count,
        "parsedScoreRows": parsed_rows,
        "sourceCommands": sorted(source_commands),
        "latestScoreCapture": latest_capture,
    }


def save_snapshot(store: Any, session_id: str, snapshot: Snapshot) -> int:
    """Persist one derived snapshot through the same local table/files used by captured datasets."""
    inserted = False
    snapshot_id = 0
    with store._connect() as db:
        cursor = db.execute(
            "INSERT OR IGNORE INTO snapshots"
            "(session_id,dataset,command,captured_at,context_json,rows_json,sequence,source_hash) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                session_id,
                snapshot.dataset,
                snapshot.command,
                snapshot.captured_at,
                json_compact(snapshot.context),
                json_compact(snapshot.rows),
                snapshot.sequence,
                snapshot.source_hash,
            ),
        )
        if cursor.rowcount:
            inserted = True
            snapshot_id = int(cursor.lastrowid)
        else:
            row = db.execute(
                "SELECT id FROM snapshots WHERE session_id=? AND dataset=? AND source_hash=?",
                (session_id, snapshot.dataset, snapshot.source_hash),
            ).fetchone()
            snapshot_id = int(row["id"]) if row else 0
    if inserted and snapshot_id:
        store._write_snapshot(session_id, snapshot_id, snapshot)
    return snapshot_id


def build_svs_snapshots(
    session_id: str,
    sessions_dir: Path,
    roster: dict[str, Any],
) -> tuple[list[Snapshot], dict[str, Any]]:
    members = [row for row in (roster.get("members") or []) if isinstance(row, dict)]
    member_by_uid = {
        str(row.get("uid") or ""): row
        for row in members
        if str(row.get("uid") or "")
    }
    if not member_by_uid:
        raise ValueError("The Alliance Members response did not contain any roster members.")

    all_scores, score_meta = _read_score_rows(session_id, sessions_dir)
    if score_meta["scoreResponseCount"] < 1:
        raise ValueError(
            "No SVS personal score ranking response was captured. Open the SVS Personal/High Score leaderboard before stopping."
        )
    if score_meta["parsedScoreRows"] < 1:
        raise ValueError(
            "An SVS score response was captured, but its player rows could not be read. Keep the session package for inspection and try the Personal/High Score leaderboard again."
        )

    scores: dict[str, dict[str, Any]] = {}
    for uid, source in all_scores.items():
        member = member_by_uid.get(uid)
        if member is None:
            continue
        scores[uid] = {
            "position": source.get("position"),
            "uid": uid,
            "name": str(source.get("name") or member.get("name") or ""),
            "score": int(source.get("score") or 0),
            "allianceId": str(source.get("allianceId") or roster.get("allianceId") or ""),
            "allianceAbbr": str(source.get("allianceAbbr") or "WDZ"),
            "allianceName": str(source.get("allianceName") or ""),
            "serverId": source.get("serverId") if source.get("serverId") is not None else member.get("serverId"),
        }

    roster_captured_at = str(roster.get("capturedAt") or "")
    window_start, window_end = _activity_window(roster_captured_at)
    window_start_iso = _iso(window_start)
    window_end_iso = _iso(window_end)

    attendance_rows: list[dict[str, Any]] = []
    activity_only = 0
    for uid, member in member_by_uid.items():
        scored = uid in scores
        last_seen = _parse_iso(member.get("lastSeenAtUtc"))
        active_in_window = bool(last_seen and window_start <= last_seen <= window_end)
        if not scored and not active_in_window:
            continue
        source = "leaderboard_score" if scored else "roster_last_seen"
        if not scored:
            activity_only += 1
        attendance_rows.append(
            {
                "uid": uid,
                "name": str(member.get("name") or scores.get(uid, {}).get("name") or ""),
                "attended": True,
                "lastOnlineAt": str(member.get("lastSeenAtUtc") or ""),
                "windowStart": window_start_iso,
                "windowEnd": window_end_iso,
                "source": source,
            }
        )

    captured_at = score_meta["latestScoreCapture"] or roster_captured_at or window_end_iso
    source_commands = list(score_meta["sourceCommands"])
    preferred_command = next(
        (command for command in SVS_SCORE_COMMANDS if command in source_commands),
        source_commands[0] if source_commands else SVS_SCORE_COMMANDS[0],
    )

    snapshots: list[Snapshot] = []
    if scores:
        ranking_rows = sorted(
            scores.values(),
            key=lambda row: (int(row.get("position") or 10**9), -int(row.get("score") or 0), str(row.get("name") or "")),
        )
        snapshots.append(
            Snapshot(
                dataset="state_ruler_rankings",
                command=preferred_command,
                captured_at=captured_at,
                context={
                    "rankingScope": "partial_main_user_score_leaderboard",
                    "leaderboardComplete": False,
                    "memberFiltered": True,
                    "sourceCommands": source_commands,
                },
                rows=ranking_rows,
                sequence=None,
                source_hash=json_hash(
                    {
                        "dataset": "state_ruler_rankings",
                        "sessionId": session_id,
                        "commands": source_commands,
                        "rows": ranking_rows,
                    }
                ),
            )
        )

    snapshots.append(
        Snapshot(
            dataset="state_ruler_attendance",
            command="al.rank",
            captured_at=roster_captured_at or window_end_iso,
            context={
                "windowStart": window_start_iso,
                "windowEnd": window_end_iso,
                "cutoff": "07:00 America/Vancouver",
                "scorePlayersIncluded": len(scores),
                "activityOnlyPlayersIncluded": activity_only,
            },
            rows=attendance_rows,
            sequence=None,
            source_hash=json_hash(
                {
                    "dataset": "state_ruler_attendance",
                    "sessionId": session_id,
                    "windowStart": window_start_iso,
                    "windowEnd": window_end_iso,
                    "rows": attendance_rows,
                }
            ),
        )
    )

    summary = {
        "sessionId": session_id,
        "windowStart": window_start_iso,
        "windowEnd": window_end_iso,
        "cutoffLocal": "07:00 America/Vancouver",
        "scoreResponseCount": int(score_meta["scoreResponseCount"]),
        "parsedScoreRows": int(score_meta["parsedScoreRows"]),
        "sourceCommands": source_commands,
        "rosterMembers": len(member_by_uid),
        "leaderboardPlayers": len(scores),
        "activityOnlyPlayers": activity_only,
        "participants": len(attendance_rows),
    }
    return snapshots, summary
