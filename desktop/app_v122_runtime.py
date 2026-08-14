from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from app import Colors
from app_v120_runtime import App as BaseApp
from utils import SESSIONS_DIR


PROFILE_AUTO = "Auto (UTC game day)"
PROFILE_WEEKDAY = "Monday-Saturday Duel"
PROFILE_SUNDAY_AUTO = "Sunday Auto (Early → Late)"
PROFILE_SUNDAY_EARLY = "Sunday Early / First View"
PROFILE_SUNDAY_LATE = "Sunday Late / Already Viewed"
LEGACY_SUNDAY = "Sunday Finished Week"

WEEKDAY_SEQUENCE = [
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 3000, "optional": True},
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 2500},
    {"controlType": "Button", "name": "rankBtn", "replayKey": "rankBtn", "delayMs": 3508},
    {"controlType": "Toggle", "name": "Toggle2", "replayKey": "Toggle2", "delayMs": 1890},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 1073},
    {"controlType": "Toggle", "name": "Toggle1", "replayKey": "Toggle1", "delayMs": 1849},
    {"controlType": "Button", "name": "CloseBtn", "replayKey": "CloseBtn", "delayMs": 0},
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 2225},
]

SUNDAY_EARLY_SEQUENCE = [
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0, "optional": True},
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 3114},
    {"controlType": "Button", "name": "UIPlayerHead", "replayKey": "UIPlayerHead", "delayMs": 3267},
    {"controlType": "Toggle", "name": "CheckBox", "replayKey": "CheckBox", "delayMs": 7222},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 3565},
]

SUNDAY_LATE_SEQUENCE = [
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0, "optional": True},
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 1596},
    {"controlType": "Button", "name": "rankBtn", "replayKey": "rankBtn", "delayMs": 3803},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 8201},
    {"controlType": "Button", "name": "CloseBtn", "replayKey": "CloseBtn", "delayMs": 9370},
]


class App(BaseApp):
    """1.2.2 Sunday router: detect first-view vs already-viewed Duel UI without clicking."""

    LATE_RANKINGS_SETTLE_SECONDS = 8.0
    LATE_ROSTER_SETTLE_SECONDS = 5.0
    LATE_CLOSE_SETTLE_SECONDS = 3.0

    def __init__(self) -> None:
        self.duel_sunday_mode = "auto"
        self.duel_sunday_branch = ""
        self.duel_sunday_branch_reason = ""
        self.duel_sunday_probe_started = False
        super().__init__()
        self._configure_sunday_profile_menu()

    def _configure_sunday_profile_menu(self) -> None:
        if not hasattr(self, "duel_profile_menu"):
            return
        values = [PROFILE_AUTO, PROFILE_WEEKDAY, PROFILE_SUNDAY_AUTO, PROFILE_SUNDAY_EARLY, PROFILE_SUNDAY_LATE]
        self.duel_profile_menu.configure(values=values)
        configured = str(self.config.values.get("duelProfileMode") or PROFILE_AUTO)
        if configured == LEGACY_SUNDAY:
            configured = PROFILE_SUNDAY_AUTO
        if configured not in values:
            configured = PROFILE_AUTO
        self.duel_profile_menu.set(configured)
        self.config.values["duelProfileMode"] = configured
        self.config.save()
        if hasattr(self, "duel_profile_hint"):
            self.duel_profile_hint.configure(text=self._profile_hint(configured))

    def _profile_hint(self, mode: str) -> str:
        if mode == PROFILE_SUNDAY_AUTO:
            return "Sunday Auto opens the shared Duel screen, probes UIPlayerHead without clicking, then selects Early or Late automatically."
        if mode == PROFILE_SUNDAY_EARLY:
            return "Force the first-view Sunday path: PCMask → Alliance Duel → Player Head → CheckBox → My Alliance."
        if mode == PROFILE_SUNDAY_LATE:
            return "Force the already-viewed Sunday path: PCMask → Alliance Duel → Rankings → My Alliance → Close."
        if mode == PROFILE_WEEKDAY:
            return "Force the Monday-Saturday path and collect current, completed, weekly combined and My Alliance data."
        chosen = "Sunday Auto (Early → Late)" if datetime.now(timezone.utc).weekday() == 6 else "Monday-Saturday Duel"
        return f"Auto currently resolves to: {chosen}."

    def _resolve_profile(self) -> str:
        mode = self.duel_profile_menu.get() if hasattr(self, "duel_profile_menu") else PROFILE_AUTO
        self.duel_sunday_branch = ""
        self.duel_sunday_branch_reason = ""
        self.duel_sunday_probe_started = False
        if mode == PROFILE_WEEKDAY:
            self.duel_sunday_mode = ""
            return "weekday"
        if mode == PROFILE_SUNDAY_EARLY:
            self.duel_sunday_mode = "early"
            self.duel_sunday_branch = "early"
            self.duel_sunday_branch_reason = "manual profile"
            return "sunday"
        if mode == PROFILE_SUNDAY_LATE:
            self.duel_sunday_mode = "late"
            self.duel_sunday_branch = "late"
            self.duel_sunday_branch_reason = "manual profile"
            return "sunday"
        if mode == PROFILE_SUNDAY_AUTO:
            self.duel_sunday_mode = "auto"
            return "sunday"
        if datetime.now(timezone.utc).weekday() == 6:
            self.duel_sunday_mode = "auto"
            return "sunday"
        self.duel_sunday_mode = ""
        return "weekday"

    def _is_sunday_auto(self) -> bool:
        return self.duel_profile_kind == "sunday" and self.duel_sunday_mode == "auto"

    def _is_late_sunday(self) -> bool:
        return self.duel_profile_kind == "sunday" and (
            self.duel_sunday_mode == "late" or self.duel_sunday_branch == "late"
        )

    def _active_sequence(self) -> list[dict[str, Any]]:
        if self.duel_profile_kind != "sunday":
            return WEEKDAY_SEQUENCE
        return SUNDAY_LATE_SEQUENCE if self._is_late_sunday() else SUNDAY_EARLY_SEQUENCE

    def run_duel_sync(self) -> None:
        super().run_duel_sync()
        if not self.duel_running:
            return
        if self.duel_profile_kind == "sunday":
            if self.duel_sunday_mode == "auto":
                self._set_duel_status("Sunday Auto selected. The tracker will detect Early vs Late after opening Alliance Duel.")
            elif self.duel_sunday_mode == "early":
                self._set_duel_status("Forced Sunday Early / First View profile selected.")
            elif self.duel_sunday_mode == "late":
                self._set_duel_status("Forced Sunday Late / Already Viewed profile selected.")

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        name = str(data.get("name") or "")
        ok = bool(data.get("ok"))
        auto_probe = (
            self._is_sunday_auto()
            and not self.duel_sunday_branch
            and self.duel_current_control == "UIMain_icon_AlCompete"
            and ok
        )
        super()._handle_duel_replay_result(data)
        if not self.duel_running or not ok:
            return
        if auto_probe:
            self.duel_wait_kind = "sunday-probe-settle"
            self.duel_step_deadline = time.monotonic() + 5.0
            self._set_duel_status(
                "Alliance Duel opened. Waiting 5.0s, then checking whether the first-view UIPlayerHead control exists without clicking it."
            )
            return
        if self._is_late_sunday():
            if name == "rankBtn" and self.duel_wait_kind in {"settle-back", "settle-close"}:
                self.duel_wait_kind = "settle-back"
                self.duel_step_deadline = time.monotonic() + self.LATE_RANKINGS_SETTLE_SECONDS
                self._set_duel_status(
                    f"Late Sunday Rankings opened. Waiting {self.LATE_RANKINGS_SETTLE_SECONDS:.1f}s before switching to My Alliance."
                )
            elif name == "CloseBtn" and self.duel_wait_kind in {"settle-back", "settle-close"}:
                self.duel_wait_kind = "settle-close"
                self.duel_step_deadline = time.monotonic() + self.LATE_CLOSE_SETTLE_SECONDS
                self._set_duel_status(
                    f"Late Sunday rankings closed. Waiting {self.LATE_CLOSE_SETTLE_SECONDS:.1f}s for the UI to settle."
                )

    def _duel_sequence_tick(self, generation: int | None = None) -> None:
        if not self.duel_running or self.duel_stage != "sequence":
            return
        if generation is not None and generation != self._duel_generation:
            return
        if self.duel_wait_kind == "sunday-probe-settle":
            if time.monotonic() >= self.duel_step_deadline:
                self._queue_sunday_ui_probe()
            else:
                self._schedule_duel_tick(250, generation)
            return
        if self.duel_wait_kind == "sunday-probe":
            if time.monotonic() >= self.duel_step_deadline:
                self._choose_sunday_branch(
                    "late",
                    "UIPlayerHead probe timed out; treating the screen as the already-viewed/late Sunday layout.",
                )
            else:
                self._schedule_duel_tick(250, generation)
            return
        if (
            self._is_late_sunday()
            and self.duel_current_control == "Toggle3"
            and self.duel_wait_kind == "data"
            and self._duel_data_condition_met()
        ):
            self.duel_wait_kind = "post-data-settle"
            self.duel_step_deadline = time.monotonic() + self.LATE_ROSTER_SETTLE_SECONDS
            self._set_duel_status(
                f"Late Sunday My Alliance roster arrived. Waiting {self.LATE_ROSTER_SETTLE_SECONDS:.1f}s before closing the rankings UI."
            )
            self._schedule_duel_tick(250, generation)
            return
        if (
            self._is_sunday_auto()
            and self.duel_sunday_branch == "early"
            and self.duel_current_control == "Toggle3"
            and self.duel_wait_kind == "data"
            and time.monotonic() >= self.duel_step_deadline
        ):
            self._fallback_early_to_late(
                "The Early Sunday My Alliance control produced no fresh weekly roster before timeout."
            )
            return
        super()._duel_sequence_tick(generation)

    def _queue_sunday_ui_probe(self) -> None:
        if not self.duel_running:
            return
        script = getattr(self.capture.state, "script", None)
        if script is None:
            self._duel_fail("The capture script detached before Sunday UI detection.")
            return
        self.duel_sunday_probe_started = True
        self.duel_wait_kind = "sunday-probe"
        self.duel_step_deadline = time.monotonic() + 8.0
        try:
            script.post({"type": "automation-probe-control", "payload": {"name": "UIPlayerHead"}})
        except Exception as exc:
            self._choose_sunday_branch(
                "late",
                f"Could not queue UIPlayerHead probe ({exc}); falling back to the Late Sunday path.",
            )
            return
        self._set_duel_status(
            "Detecting Sunday layout: probing UIPlayerHead without invoking it. If unavailable, Late Sunday will be selected automatically."
        )

    def _handle_sunday_probe_result(self, data: dict[str, Any]) -> None:
        if (
            not self.duel_running
            or not self._is_sunday_auto()
            or self.duel_wait_kind != "sunday-probe"
            or str(data.get("name") or "") != "UIPlayerHead"
        ):
            return
        if bool(data.get("ok")):
            self._choose_sunday_branch(
                "early",
                "UIPlayerHead is active, so the first-view Sunday layout is on screen.",
            )
        else:
            reason = str(data.get("error") or "UIPlayerHead is not active on this Sunday screen.")
            self._choose_sunday_branch(
                "late",
                f"{reason} Using the already-viewed Late Sunday rankings path.",
            )

    def _choose_sunday_branch(self, branch: str, reason: str) -> None:
        if not self.duel_running:
            return
        self.duel_sunday_branch = branch
        self.duel_sunday_branch_reason = reason
        self._duel_generation += 1
        self.duel_wait_kind = ""
        self.duel_step_deadline = 0.0
        label = "Early / First View" if branch == "early" else "Late / Already Viewed"
        next_control = "UIPlayerHead" if branch == "early" else "rankBtn"
        self._set_duel_status(f"Sunday Auto chose {label}. {reason} Next control: {next_control}.")
        self._write_duel_sequence_file()
        self._advance_duel_step()

    def _fallback_early_to_late(self, reason: str) -> None:
        if not self.duel_running:
            return
        self.duel_sunday_branch = "late"
        self.duel_sunday_branch_reason = "Early fallback: " + reason
        self._duel_generation += 1
        self.duel_wait_kind = ""
        self.duel_step_attempts = 0
        self.duel_current_control = ""
        self.duel_step_index = 2
        self._set_duel_status(
            f"Early Sunday path could not verify. Switching in-place to Late Sunday. {reason} Trying rankBtn next."
        )
        self._write_duel_sequence_file()
        self.after(self.INTER_STEP_GAP_MS, self._queue_current_duel_step)

    def _retry_duel_step(self, reason: str) -> None:
        if (
            self.duel_running
            and self._is_sunday_auto()
            and self.duel_sunday_branch == "early"
            and self.duel_current_control in {"UIPlayerHead", "CheckBox"}
            and self.duel_step_attempts >= 3
        ):
            self._fallback_early_to_late(
                f"{self.duel_current_control} was not usable after {self.duel_step_attempts} attempts. Last reason: {reason}"
            )
            return
        super()._retry_duel_step(reason)

    def _write_duel_sequence_file(self) -> None:
        if not self.duel_session_id:
            return
        raw = SESSIONS_DIR / self.duel_session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 3,
            "name": "Alliance Duel Auto Sync",
            "profile": self.duel_profile_kind,
            "sundayMode": self.duel_sunday_mode,
            "sundayBranch": self.duel_sunday_branch or None,
            "sundayBranchReason": self.duel_sunday_branch_reason or None,
            "timingMode": "response-driven + recorded pacing floors",
            "startupSettleSeconds": self.CITY_SETTLE_SECONDS,
            "steps": [dict(step) for step in self._active_sequence()],
            "knownProfiles": {
                "weekday": [dict(step) for step in WEEKDAY_SEQUENCE],
                "sundayEarly": [dict(step) for step in SUNDAY_EARLY_SEQUENCE],
                "sundayLate": [dict(step) for step in SUNDAY_LATE_SEQUENCE],
            },
        }
        (raw / "control-sequence.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        merged = dict(extra or {})
        merged.update({
            "sundayMode": self.duel_sunday_mode,
            "sundayBranch": self.duel_sunday_branch or None,
            "sundayBranchReason": self.duel_sunday_branch_reason or None,
            "sundayProbeStarted": self.duel_sunday_probe_started,
        })
        super()._write_duel_run_report(status, merged)

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}
        if kind == "automation-probe-result":
            self._handle_sunday_probe_result(data)
        super().handle(kind, payload)
