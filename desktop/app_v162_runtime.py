from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app_v124_runtime import STARTUP_NONE, TIMING_RECORDED
from app_v130_runtime import DEFAULT_WEEKDAY_SEQUENCE, _resource_path
from app_v160_runtime import BACKGROUND_DIR, LATEST_BACKGROUND_RUN
from app_v161_runtime import App as BaseApp
from app_v100 import SEQUENCE_DIR
from utils import utc_now


PRODUCTION_WEEKDAY_SEQUENCE = "Alliance Duel - Weekday Production"
PACIFIC_ZONE = ZoneInfo("America/Vancouver")
GAME_RESET_HOUR_PACIFIC = 19
PROFILE_SCHEMA_VERSION = 4
SYNC_PLAN_PRODUCTION_SCHEMA_VERSION = 1
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")


class App(BaseApp):
    """1.6.2 review: package the proven weekday route and align game-day selection to the 7 p.m. Pacific reset."""

    def __init__(self) -> None:
        super().__init__()
        self._migrate_production_weekday_profiles()
        self._migrate_production_sync_plans()
        self._refresh_day_profile_editor()
        if hasattr(self, "_refresh_quick_run_card"):
            self._refresh_quick_run_card()
        if hasattr(self, "_refresh_all_event_profile_controls"):
            self._refresh_all_event_profile_controls()
        if hasattr(self, "_refresh_today_plan_card"):
            self._refresh_today_plan_card()

    def _install_builtin_sequences(self) -> None:
        # Preserve all legacy/default sequences, but also install one protected production
        # route whose contents are refreshed from the bundled EXE on every launch.
        super()._install_builtin_sequences()
        try:
            SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
            source = _resource_path("default-sequences/Alliance Duel - Weekday Production.json")
            target = SEQUENCE_DIR / "Alliance Duel - Weekday Production.json"
            if source.is_file():
                shutil.copyfile(source, target)
        except Exception:
            pass

    def _default_day_profile(self, day: str) -> dict[str, Any]:
        return {
            "sequence": PRODUCTION_WEEKDAY_SEQUENCE if day != "Sunday" else "",
            "startupWait": "10 seconds",
            "startupAction": STARTUP_NONE,
            "timing": TIMING_RECORDED,
            "retries": "4",
        }

    def _production_duel_job(self) -> dict[str, Any]:
        return {
            "eventType": "alliance_duel",
            "sequence": PRODUCTION_WEEKDAY_SEQUENCE,
            "order": 1,
            "startupWait": "10 seconds",
            "startupAction": STARTUP_NONE,
            "timing": TIMING_RECORDED,
            "retries": "4",
            "enabled": True,
        }

    def _migrate_production_weekday_profiles(self) -> None:
        try:
            current = int(self.config.values.get("duelDayProfileSchemaVersion") or 0)
        except Exception:
            current = 0
        if current >= PROFILE_SCHEMA_VERSION:
            return
        profiles = self._day_profiles()
        for day in WEEKDAYS:
            profile = dict(profiles.get(day) or self._default_day_profile(day))
            sequence = str(profile.get("sequence") or "").strip()
            # Only replace generated/legacy defaults. Operator-assigned custom sequences remain untouched.
            if sequence in {"", DEFAULT_WEEKDAY_SEQUENCE, PRODUCTION_WEEKDAY_SEQUENCE}:
                profile.update({
                    "sequence": PRODUCTION_WEEKDAY_SEQUENCE,
                    "startupWait": "10 seconds",
                    "startupAction": STARTUP_NONE,
                    "timing": TIMING_RECORDED,
                    "retries": "4",
                })
                profiles[day] = profile
        # Sunday intentionally remains manual/unassigned until a stable Sunday route is proven.
        sunday = dict(profiles.get("Sunday") or self._default_day_profile("Sunday"))
        if str(sunday.get("sequence") or "") in {DEFAULT_WEEKDAY_SEQUENCE, PRODUCTION_WEEKDAY_SEQUENCE}:
            sunday["sequence"] = ""
            profiles["Sunday"] = sunday
        self.config.values["duelDayProfiles"] = profiles
        self.config.values["duelDayProfileSchemaVersion"] = PROFILE_SCHEMA_VERSION
        self.config.save()

    def _migrate_production_sync_plans(self) -> None:
        try:
            current = int(self.config.values.get("autoSyncProductionSchemaVersion") or 0)
        except Exception:
            current = 0
        if current >= SYNC_PLAN_PRODUCTION_SCHEMA_VERSION:
            return

        plans = self._sync_plans()
        for day in WEEKDAYS:
            rows = [dict(row) for row in plans.get(day, [])]
            duel_index = next((i for i, row in enumerate(rows) if row.get("eventType") == "alliance_duel"), None)
            if duel_index is None:
                rows.append(self._production_duel_job())
            else:
                existing = dict(rows[duel_index])
                sequence = str(existing.get("sequence") or "").strip()
                if sequence in {"", DEFAULT_WEEKDAY_SEQUENCE, PRODUCTION_WEEKDAY_SEQUENCE}:
                    existing.update(self._production_duel_job())
                    rows[duel_index] = existing
            rows.sort(key=lambda row: int(row.get("order") or 1))
            plans[day] = rows

        # Never generate a Sunday Duel job from one of our weekday defaults. Preserve
        # an operator-created custom Sunday route if one already exists.
        sunday_rows: list[dict[str, Any]] = []
        for row in plans.get("Sunday", []):
            item = dict(row)
            if item.get("eventType") == "alliance_duel" and str(item.get("sequence") or "") in {
                "", DEFAULT_WEEKDAY_SEQUENCE, PRODUCTION_WEEKDAY_SEQUENCE
            }:
                continue
            sunday_rows.append(item)
        plans["Sunday"] = sunday_rows

        self.config.values["autoSyncDayPlans"] = plans
        self.config.values["autoSyncProductionSchemaVersion"] = SYNC_PLAN_PRODUCTION_SCHEMA_VERSION
        self.config.save()

    def _utc_day(self) -> str:
        """Return the Last Z game day, using the 7 p.m. Pacific reset instead of UTC midnight."""
        now = datetime.now(PACIFIC_ZONE)
        game_date = now.date()
        if now.hour >= GAME_RESET_HOUR_PACIFIC:
            game_date = game_date + timedelta(days=1)
        return game_date.strftime("%A")

    def game_day_diagnostics(self) -> dict[str, Any]:
        now = datetime.now(PACIFIC_ZONE)
        return {
            "pacificNow": now.isoformat(timespec="seconds"),
            "resetHourPacific": GAME_RESET_HOUR_PACIFIC,
            "gameDay": self._utc_day(),
            "weekdayProductionSequence": PRODUCTION_WEEKDAY_SEQUENCE,
        }

    def _write_background_status(self, status: str, message: str) -> None:
        BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "schemaVersion": 1,
            "release": "1.6.2-review",
            "status": status,
            "message": message,
            "startedAt": self.background_started_at,
            "updatedAt": utc_now(),
            "day": str(getattr(self, "sync_plan_day", "") or self._utc_day()),
            "gameDayDiagnostics": self.game_day_diagnostics(),
            "weekdayProductionSequence": PRODUCTION_WEEKDAY_SEQUENCE,
            "sessionId": str(getattr(self, "duel_session_id", "") or ""),
            "results": list(getattr(self, "sync_plan_results", []) or []),
            "closeGameRequested": bool(self.background_close_game),
            "exitCode": int(self.background_exit_code),
        }
        timestamp = payload["updatedAt"].replace(":", "-").replace("+", "_")
        history = BACKGROUND_DIR / f"run-{timestamp}.json"
        text = json.dumps(payload, indent=2, ensure_ascii=False)
        LATEST_BACKGROUND_RUN.write_text(text, encoding="utf-8")
        history.write_text(text, encoding="utf-8")
