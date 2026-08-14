from __future__ import annotations

import json
import queue
import time
from datetime import datetime, timezone
from typing import Any

import customtkinter as ctk

import app_v110 as v110
from app import Colors
from app_v110_runtime import App as BaseApp
from utils import SESSIONS_DIR, utc_now


WEEKDAY_SEQUENCE = [
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0, "optional": True},
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 0},
    {"controlType": "Button", "name": "rankBtn", "replayKey": "rankBtn", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle2", "replayKey": "Toggle2", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle1", "replayKey": "Toggle1", "delayMs": 0},
    {"controlType": "Button", "name": "CloseBtn", "replayKey": "CloseBtn", "delayMs": 0},
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0},
]

SUNDAY_SEQUENCE = [
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0, "optional": True},
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 0},
    {"controlType": "Button", "name": "UIPlayerHead", "replayKey": "UIPlayerHead", "delayMs": 0},
    {"controlType": "Toggle", "name": "CheckBox", "replayKey": "CheckBox", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 0},
]

WEEKDAY_REQUIRED_RANKS = {
    "current_day_combined",
    "weekly_combined",
    "weekly_own_alliance",
    "completed_days",
}
SUNDAY_REQUIRED_RANKS = {"weekly_own_alliance"}
PROFILE_AUTO = "Auto (UTC game day)"
PROFILE_WEEKDAY = "Monday-Saturday Duel"
PROFILE_SUNDAY = "Sunday Finished Week"


class App(BaseApp):
    """Alliance Tracker 1.2 review with weekday and Sunday Duel automation."""

    def __init__(self) -> None:
        self.duel_profile_kind = "weekday"
        self.duel_settle_started = False
        super().__init__()

    def _duel_auto_page(self) -> None:
        super()._duel_auto_page()
        page = self.pages.get("duel_auto")
        if not page:
            return
        scroll = next((child for child in page.winfo_children() if isinstance(child, ctk.CTkScrollableFrame)), None)
        if scroll is None:
            return

        panel = ctk.CTkFrame(scroll, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x", pady=(0, 14))
        ctk.CTkLabel(panel, text="DUEL PROFILE", text_color=Colors.ACCENT, font=(self.font, 11, "bold")).pack(anchor="w", padx=17, pady=(15, 2))
        ctk.CTkLabel(
            panel,
            text="Use the normal Duel path Monday-Saturday and the finished-week league path on Sunday.",
            text_color=Colors.TEXT,
            font=(self.font, 15, "bold"),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            panel,
            text=(
                "Auto follows the game's UTC day. Sunday uses the successful PCMask → Alliance Duel → Player Head → "
                "CheckBox → My Alliance path. You can force either profile while testing."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 9))
        self.duel_profile_menu = ctk.CTkOptionMenu(
            panel,
            values=[PROFILE_AUTO, PROFILE_WEEKDAY, PROFILE_SUNDAY],
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 10),
        )
        configured = str(self.config.values.get("duelProfileMode") or PROFILE_AUTO)
        if configured not in {PROFILE_AUTO, PROFILE_WEEKDAY, PROFILE_SUNDAY}:
            configured = PROFILE_AUTO
        self.duel_profile_menu.set(configured)
        self.duel_profile_menu.pack(anchor="w", padx=17, pady=(0, 8))
        self.duel_profile_hint = ctk.CTkLabel(
            panel,
            text=self._profile_hint(configured),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.duel_profile_hint.pack(anchor="w", padx=17, pady=(0, 14))
        self.duel_profile_menu.configure(command=self._profile_changed)

    def _profile_hint(self, mode: str) -> str:
        if mode == PROFILE_SUNDAY:
            return "Forced Sunday finished-week capture. Verification requires the authoritative My Alliance weekly roster."
        if mode == PROFILE_WEEKDAY:
            return "Forced Monday-Saturday capture. Verification requires current day, completed days, weekly combined and My Alliance."
        chosen = "Sunday Finished Week" if datetime.now(timezone.utc).weekday() == 6 else "Monday-Saturday Duel"
        return f"Auto currently resolves to: {chosen}."

    def _profile_changed(self, value: str) -> None:
        self.config.values["duelProfileMode"] = value
        self.config.save()
        if hasattr(self, "duel_profile_hint"):
            self.duel_profile_hint.configure(text=self._profile_hint(value))

    def save_game_executable(self) -> None:
        super().save_game_executable()
        if hasattr(self, "duel_profile_menu"):
            self.config.values["duelProfileMode"] = self.duel_profile_menu.get()
            self.config.save()

    def _resolve_profile(self) -> str:
        mode = self.duel_profile_menu.get() if hasattr(self, "duel_profile_menu") else PROFILE_AUTO
        if mode == PROFILE_SUNDAY:
            return "sunday"
        if mode == PROFILE_WEEKDAY:
            return "weekday"
        return "sunday" if datetime.now(timezone.utc).weekday() == 6 else "weekday"

    def _active_sequence(self) -> list[dict[str, Any]]:
        return SUNDAY_SEQUENCE if self.duel_profile_kind == "sunday" else WEEKDAY_SEQUENCE

    def run_duel_sync(self) -> None:
        self.duel_profile_kind = self._resolve_profile()
        self.duel_settle_started = False
        v110.DEFAULT_DUEL_SEQUENCE = [dict(step) for step in self._active_sequence()]
        v110.REQUIRED_RANK_LABELS = set(SUNDAY_REQUIRED_RANKS if self.duel_profile_kind == "sunday" else WEEKDAY_REQUIRED_RANKS)
        self._set_duel_status(
            "Selected Sunday finished-week profile." if self.duel_profile_kind == "sunday" else "Selected Monday-Saturday Duel profile.",
            Colors.ACCENT,
        )
        super().run_duel_sync()

    def _start_duel_capture(self) -> None:
        if not self.duel_running:
            return
        if not self.duel_settle_started:
            self.duel_settle_started = True
            self.duel_stage = "settling_city"
            self._set_duel_progress("capture", "Waiting 10s", Colors.ACCENT)
            self._set_duel_status(
                "Capture hooks are ready. Waiting 10 seconds for the city screen and any startup announcement to finish loading..."
            )
            self.after(10_000, self._start_duel_capture_after_settle)
            return
        super()._start_duel_capture()

    def _start_duel_capture_after_settle(self) -> None:
        if not self.duel_running:
            return
        self._set_duel_status("City settling period complete. Starting capture and clearing any announcement overlay...")
        super()._start_duel_capture()

    def _write_duel_sequence_file(self) -> None:
        if not self.duel_session_id:
            return
        raw = SESSIONS_DIR / self.duel_session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 2,
            "name": "Alliance Duel Auto Sync",
            "profile": self.duel_profile_kind,
            "timingMode": "response-driven",
            "startupSettleSeconds": 10,
            "source": (
                "Sunday duel league finished success" if self.duel_profile_kind == "sunday" else "Full succeded new test"
            ),
            "steps": [dict(step) for step in self._active_sequence()],
        }
        (raw / "control-sequence.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _queue_current_duel_step(self) -> None:
        super()._queue_current_duel_step()
        if self.duel_running and self.duel_current_control:
            total = len(self._active_sequence())
            self._set_duel_status(f"{self.duel_profile_kind.title()} step {self.duel_step_index + 1}/{total}: {self.duel_current_control}")

    def _retry_duel_step(self, reason: str) -> None:
        if (
            self.duel_running
            and self.duel_step_index == 0
            and self.duel_current_control == "PCMask"
            and self.duel_step_attempts >= 3
        ):
            self.duel_step_results.append({
                "index": 1,
                "name": "PCMask",
                "ok": True,
                "skipped": True,
                "reason": "No startup overlay mask was active after three attempts.",
                "completedAt": utc_now(),
            })
            self._set_duel_status("No startup announcement mask was active. Continuing to Alliance Duel.", Colors.MUTED)
            self.duel_step_attempts = 0
            self._advance_duel_step()
            return
        super()._retry_duel_step(reason)

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if self.duel_profile_kind != "sunday":
            super()._handle_duel_replay_result(data)
            return
        if not self.duel_running or self.duel_stage != "sequence" or self.duel_wait_kind != "replay":
            return
        name = str(data.get("name") or "")
        if name != self.duel_current_control:
            return
        if not data.get("ok"):
            self._retry_duel_step(str(data.get("error") or "replay failed"))
            return

        self.duel_step_results.append({
            "index": self.duel_step_index + 1,
            "name": name,
            "ok": True,
            "method": data.get("method"),
            "completedAt": utc_now(),
        })
        self.duel_step_attempts = 0

        if name == "Toggle3":
            self.duel_wait_kind = "data"
            self.duel_step_deadline = time.monotonic() + 18.0
            if self._duel_data_condition_met():
                self.after(100, self._advance_duel_step)
            else:
                self.after(250, self._duel_sequence_tick)
            return

        settle = {
            "PCMask": 0.8,
            "UIMain_icon_AlCompete": 2.5,
            "UIPlayerHead": 3.0,
            "CheckBox": 3.0,
        }.get(name, 0.8)
        self.duel_wait_kind = "settle-back"
        self.duel_step_deadline = time.monotonic() + settle
        self.after(100, self._duel_sequence_tick)

    def _duel_data_condition_met(self) -> bool:
        if self.duel_profile_kind == "sunday" and self.duel_current_control == "Toggle3":
            baseline = self.duel_wait_baseline
            return (
                self._current_rank_count(2) > baseline.get("rank2", 0)
                and int(self.duel_rank_rows.get(2, 0)) > 0
            )
        return super()._duel_data_condition_met()

    def _duel_timeout_message(self) -> str:
        if self.duel_profile_kind == "sunday" and self.duel_current_control == "Toggle3":
            return "Sunday My Alliance view opened, but a fresh weekly own-alliance ranking did not arrive."
        return super()._duel_timeout_message()

    def _advance_duel_step(self) -> None:
        if self.duel_profile_kind == "sunday" and self.duel_running:
            name = self.duel_current_control
            if name == "UIMain_icon_AlCompete":
                self._set_duel_progress("base", "Sunday Duel opened", Colors.SUCCESS)
            elif name == "UIPlayerHead":
                self._set_duel_progress("weekly", "Finished-week view", Colors.ACCENT)
            elif name == "CheckBox":
                self._set_duel_progress("weekly", "League selected", Colors.SUCCESS)
            elif name == "Toggle3":
                rows = int(self.duel_rank_rows.get(2, 0))
                self._set_duel_progress("alliance", f"Captured ({rows})", Colors.SUCCESS)
                self._set_duel_progress("return", "Not required", Colors.MUTED)
        super()._advance_duel_step()

    def _finish_duel_capture(self) -> None:
        if self.duel_profile_kind != "sunday":
            super()._finish_duel_capture()
            return
        if not self.duel_running or not self.duel_session_id:
            return
        session_id = self.duel_session_id
        self.duel_stage = "packaging"
        self._set_duel_progress("verify", "Checking", Colors.ACCENT)
        self._set_duel_progress("package", "Packaging", Colors.ACCENT)
        self._set_duel_status("Sunday sequence complete. Verifying the finished-week My Alliance roster...")
        try:
            self.capture.stop()
            while True:
                try:
                    event = self.capture.events.get_nowait()
                except queue.Empty:
                    break
                self.handle(event.kind, event.payload)
            self.store.stop_session(session_id)
            summary = self.store.summary(session_id)
            package = self.store.package(session_id)
        except Exception as exc:
            self._duel_fail(f"Could not stop/package the Sunday automated capture: {exc}", preserve_capture=False)
            return

        self.session_id = None
        self.duel_package = str(package)
        self.stop_button.configure(state="disabled")
        self.start_button.configure(state="normal")
        self.recording.set("Stopped", "Sunday automated package ready")
        self.refresh_sessions()

        rank_labels = set(summary.get("captureQuality", {}).get("rankTypesCaptured") or [])
        missing = sorted(SUNDAY_REQUIRED_RANKS - rank_labels)
        if missing:
            self._set_duel_progress("verify", "Failed", Colors.DANGER)
            self._set_duel_progress("package", "Saved partial", Colors.DANGER)
            self._duel_fail(
                "Sunday capture packaged, but required finished-week data is missing: " + ", ".join(missing),
                preserve_capture=False,
            )
            return

        self._set_duel_progress("verify", "Verified", Colors.SUCCESS)
        self._set_duel_progress("package", "Saved", Colors.SUCCESS)
        self._write_duel_run_report("packaged", {"captureSummary": summary, "profile": "sunday"})
        if not bool(self.duel_sync_switch.get()):
            self._set_duel_progress("cloud", "Skipped", Colors.MUTED)
            self._duel_success("Sunday finished-week capture verified and packaged locally. Cloud sync was disabled.")
            return
        self._begin_duel_cloud_sync(session_id)

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        merged = {"profile": self.duel_profile_kind, "startupSettleSeconds": 10}
        if extra:
            merged.update(extra)
        super()._write_duel_run_report(status, merged)

    def _render_duel_report(self, final_status: str, message: str) -> None:
        total = len(self._active_sequence())
        lines = [
            f"Status: {final_status}",
            f"Profile: {self.duel_profile_kind}",
            f"Session: {self.duel_session_id or '-'}",
            f"Game launched by tracker: {'yes' if self.duel_launched_game else 'no'}",
            f"Successful replay steps: {len(self.duel_step_results)}/{total}",
            f"Season observed: {'yes' if self.duel_seen_season else 'no'}",
            "Rank responses: " + ", ".join(f"type {k}={v}" for k, v in sorted(self.duel_rank_counts.items())),
            "Rank rows: " + ", ".join(f"type {k}={v}" for k, v in sorted(self.duel_rank_rows.items())),
            f"Package: {self.duel_package or '-'}",
            "",
            message,
        ]
        self.duel_report.configure(state="normal")
        self.duel_report.delete("1.0", "end")
        self.duel_report.insert("1.0", "\n".join(lines) + "\n")
        self.duel_report.configure(state="disabled")
