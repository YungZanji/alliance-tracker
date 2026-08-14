from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROSTER_EXPORT_NAME = "alliance-roster.json"
STATE_RULER_CONTEXT_NAME = "state-ruler-activity-context.json"


def _int_or_none(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except Exception:
        return None


def _parse_iso(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _epoch_iso(value: int | None) -> str:
    if not value:
        return ""
    try:
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000.0
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat(timespec="milliseconds")
    except Exception:
        return ""


def _epoch_datetime(value: int | None) -> datetime | None:
    if not value:
        return None
    try:
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000.0
        return datetime.fromtimestamp(number, tz=timezone.utc)
    except Exception:
        return None


def _datetime_epoch_ms(value: datetime | None) -> int | None:
    if value is None:
        return None
    try:
        return int(round(value.timestamp() * 1000.0))
    except Exception:
        return None


def _power_rank_map(members: Iterable[dict[str, Any]], key: str) -> dict[str, int]:
    ordered = sorted(
        [row for row in members if isinstance(row.get(key), int)],
        key=lambda row: int(row.get(key) or 0),
        reverse=True,
    )
    return {str(row.get("uid") or ""): index + 1 for index, row in enumerate(ordered)}


def build_roster_export(session_id: str, sessions_dir: Path, require_arena: bool = True) -> dict[str, Any]:
    """Join al.rank + al.arena.power into one portable alliance roster dataset."""
    responses = sessions_dir / session_id / "raw" / "responses.jsonl"
    if not responses.exists():
        raise FileNotFoundError(f"responses.jsonl was not found for {session_id}")

    rank_row: dict[str, Any] | None = None
    arena_row: dict[str, Any] | None = None
    for line in responses.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        command = str(row.get("command") or "")
        if command == "al.rank":
            rank_row = row
        elif command == "al.arena.power":
            arena_row = row

    if rank_row is None:
        raise ValueError(
            "No al.rank roster response was captured. Open Alliance Members while recording so Total Power and Last Online are emitted."
        )
    if require_arena and arena_row is None:
        raise ValueError(
            "al.rank was captured, but al.arena.power was not. Open the Arena Power/ranking screen once before stopping."
        )

    rank_payload = rank_row.get("payload") if isinstance(rank_row.get("payload"), dict) else {}
    arena_payload = arena_row.get("payload") if arena_row and isinstance(arena_row.get("payload"), dict) else {}
    rank_members = [row for row in (rank_payload.get("list") or []) if isinstance(row, dict)]
    arena_members = [row for row in (arena_payload.get("list") or []) if isinstance(row, dict)]
    if not rank_members:
        raise ValueError("al.rank was decoded, but it did not contain an alliance member list.")

    arena_by_uid = {
        str(row.get("uid") or ""): _int_or_none(row.get("arenaPower"))
        for row in arena_members
        if str(row.get("uid") or "")
    }
    captured_at = str(rank_row.get("capturedAt") or "")
    captured_dt = _parse_iso(captured_at)
    captured_epoch_ms = _datetime_epoch_ms(captured_dt)
    captured_at_utc = captured_dt.isoformat(timespec="milliseconds") if captured_dt is not None else captured_at

    members: list[dict[str, Any]] = []
    for raw in rank_members:
        uid = str(raw.get("uid") or "").strip()
        if not uid:
            continue
        online = bool(raw.get("online"))
        offline_epoch = _int_or_none(raw.get("offLineTime", raw.get("offlineTime")))
        offline_dt = _epoch_datetime(offline_epoch)
        offline_for_seconds = None
        if not online and offline_dt is not None and captured_dt is not None:
            offline_for_seconds = max(0, int((captured_dt - offline_dt).total_seconds()))

        # offLineTime is the authoritative Last Z "last online" value whenever the
        # game supplies it. Currently-online members often omit offLineTime entirely,
        # so do not turn that into a misleading blank activity record. For those
        # members, lastSeen* means "confirmed online at roster capture time" while
        # lastOnline* remains the literal game-provided offline timestamp, if any.
        if online:
            activity_status = "online_at_capture"
            last_seen_epoch_ms = captured_epoch_ms
            last_seen_at_utc = captured_at_utc
            last_seen_basis = "capture_time_online"
        elif offline_epoch is not None:
            activity_status = "offline"
            last_seen_epoch_ms = offline_epoch
            last_seen_at_utc = _epoch_iso(offline_epoch)
            last_seen_basis = "offLineTime"
        else:
            activity_status = "offline_last_online_unknown"
            last_seen_epoch_ms = None
            last_seen_at_utc = ""
            last_seen_basis = "missing_offLineTime"

        total_power = _int_or_none(raw.get("power"))
        arena_power = arena_by_uid.get(uid)
        members.append({
            "uid": uid,
            "name": str(raw.get("name") or ""),
            "serverId": _int_or_none(raw.get("serverId")),
            "currentServerId": _int_or_none(raw.get("curServerId")),
            "allianceRank": _int_or_none(raw.get("rank")),
            "cityLevel": _int_or_none(raw.get("mainCityLv")),
            "totalPower": total_power,
            "arenaPower": arena_power,
            "powerOutsideArena": (total_power - arena_power) if total_power is not None and arena_power is not None else None,
            "online": online,
            "activityStatus": activity_status,
            "lastOnlineKnown": offline_epoch is not None,
            "lastOnlineEpochMs": offline_epoch,
            "lastOnlineAtUtc": _epoch_iso(offline_epoch),
            "lastSeenEpochMs": last_seen_epoch_ms,
            "lastSeenAtUtc": last_seen_at_utc,
            "lastSeenBasis": last_seen_basis,
            "offlineForSecondsAtCapture": offline_for_seconds,
            "armyKills": _int_or_none(raw.get("armyKill")),
            "joinTimeEpochMs": _int_or_none(raw.get("joinTime")),
        })

    total_rank = _power_rank_map(members, "totalPower")
    arena_rank = _power_rank_map(members, "arenaPower")
    for member in members:
        uid = str(member.get("uid") or "")
        member["totalPowerRank"] = total_rank.get(uid)
        member["arenaPowerRank"] = arena_rank.get(uid)

    arena_count = sum(1 for member in members if member.get("arenaPower") is not None)
    online_count = sum(1 for member in members if member.get("online") is True)
    last_online_known_count = sum(1 for member in members if member.get("lastOnlineKnown") is True)
    activity_known_count = sum(1 for member in members if bool(member.get("lastSeenAtUtc")))
    return {
        "schemaVersion": 2,
        "dataset": "alliance_roster_power_activity",
        "sessionId": session_id,
        "capturedAt": captured_at,
        "allianceId": rank_payload.get("allianceId") or arena_payload.get("allianceId"),
        "memberCount": len(members),
        "arenaPowerCount": arena_count,
        "onlineCount": online_count,
        "offlineCount": len(members) - online_count,
        "lastOnlineKnownCount": last_online_known_count,
        "activityKnownCount": activity_known_count,
        "activityComplete": activity_known_count == len(members),
        "complete": arena_count == len(members) and activity_known_count == len(members),
        "sources": {
            "identityTotalPowerAndActivity": "al.rank",
            "arenaPower": "al.arena.power" if arena_row is not None else "",
            "lastOnlineField": "offLineTime",
            "onlineActivityFallback": "al.rank.online + roster capturedAt",
        },
        "members": members,
    }


def state_ruler_activity_context(session_id: str, roster: dict[str, Any] | None, reason: str = "") -> dict[str, Any]:
    if roster is None:
        return {
            "schemaVersion": 2,
            "dataset": "state_ruler_activity_context",
            "sessionId": session_id,
            "capturedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "available": False,
            "reason": reason or "al.rank was not captured in this State Ruler session",
            "requiredCommand": "al.rank",
            "memberCount": 0,
            "members": [],
        }
    return {
        "schemaVersion": 2,
        "dataset": "state_ruler_activity_context",
        "sessionId": session_id,
        "capturedAt": roster.get("capturedAt") or datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "available": True,
        "reason": "",
        "requiredCommand": "al.rank",
        "memberCount": int(roster.get("memberCount") or 0),
        "activityComplete": bool(roster.get("activityComplete")),
        "members": [
            {
                "uid": member.get("uid"),
                "name": member.get("name"),
                "online": member.get("online"),
                "activityStatus": member.get("activityStatus"),
                "lastOnlineKnown": member.get("lastOnlineKnown"),
                "lastOnlineEpochMs": member.get("lastOnlineEpochMs"),
                "lastOnlineAtUtc": member.get("lastOnlineAtUtc"),
                "lastSeenEpochMs": member.get("lastSeenEpochMs"),
                "lastSeenAtUtc": member.get("lastSeenAtUtc"),
                "lastSeenBasis": member.get("lastSeenBasis"),
                "offlineForSecondsAtCapture": member.get("offlineForSecondsAtCapture"),
                "totalPower": member.get("totalPower"),
                "arenaPower": member.get("arenaPower"),
            }
            for member in (roster.get("members") or [])
            if isinstance(member, dict)
        ],
    }


def write_json_export(
    payload: dict[str, Any],
    session_id: str,
    sessions_dir: Path,
    session_filename: str,
    latest_path: Path,
) -> Path:
    normalized = sessions_dir / session_id / "normalized"
    normalized.mkdir(parents=True, exist_ok=True)
    session_path = normalized / session_filename
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    session_path.write_text(text, encoding="utf-8")
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(text, encoding="utf-8")

    zip_path = sessions_dir / f"{session_id}.zip"
    if zip_path.exists():
        with zipfile.ZipFile(zip_path, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(session_path, f"normalized/{session_filename}")
    return session_path
