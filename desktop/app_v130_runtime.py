from __future__ import annotations

import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import customtkinter as ctk

import app_v110 as v110
from app import Colors
from app_v100 import SEQUENCE_DIR
from app_v124_runtime import STARTUP_PCMASK, TIMING_RECORDED
from app_v126_runtime import App as BaseApp


DEFAULT_WEEKDAY_SEQUENCE = "Alliance Duel - Weekday Default"
DAY_EVENTS = {
    "Monday": "Tank Day",
    "Tuesday": "Build Day",
    "Wednesday": "Science Day",
    "Thursday": "Hero Day",
    "Friday": "Training Day",
    "Saturday": "Enemy Buster",
    "Sunday": "Finalization",
}
DAY_CHOICES = [f"{day} - {label}" for day, label in DAY_EVENTS.items()]
BASE_WEEKDAY_REQUIRED_RANK_LABELS = {
    "current_day_combined",
    "weekly_combined",
    "weekly_own_alliance",
}


def _resource_path(relative: str) -> Path:
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return root / relative


class App(BaseApp):
    """1.3.0 review: saved day profiles + one-button weekday Alliance Duel automation."""

    def __init__(self) -> None:
        self.production_day_run = False
        self.production_day_name = ""
        self.production_day_event = ""
        self.production_profile_name = ""
        self.production_required_rank_labels: set[str] = set()
        self._install_builtin_sequences()
        super().__init__()
        self._ensure_day_profiles()
        self._refresh_day_profile_editor()
        self.after(180, lambda: self.show("duel_auto"))

    def _install_builtin_sequences(self) -> None:
        try:
            SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
            source = _resource_path("default-sequences/Alliance Duel - Weekday Default.json")
            target = SEQUENCE_DIR / "Alliance Duel - Weekday Default.json"
            if source.is_file() and not target.exists():
                shutil.copyfile(source, target)
        except Exception:
            pass

    def _default_day_profile(self, day: str) -> dict[str, Any]:
        return {
            "sequence": DEFAULT_WEEKDAY_SEQUENCE if day != "Sunday" else "",
            "startupWait": "10 seconds",
            "startupAction": STARTUP_PCMASK,
            "timing": TIMING_RECORDED,
            "retries": "4",
        }

    def _required_rank_labels_for_day(self, day: str) -> set[str]:
        labels = set(BASE_WEEKDAY_REQUIRED_RANK_LABELS)
        if day != "Monday":
            labels.add("completed_days")
        return labels

    def _day_profiles(self) -> dict[str, dict[str, Any]]:
        raw = self.config.values.get("duelDayProfiles")
        raw = raw if isinstance(raw, dict) else {}
        result: dict[str, dict[str, Any]] = {}
        for day in DAY_EVENTS:
            base = self._default_day_profile(day)
            stored = raw.get(day)
            if isinstance(stored, dict):
                base.update({
                    "sequence": str(stored.get("sequence") or base["sequence"]),
                    "startupWait": str(stored.get("startupWait") or base["startupWait"]),
                    "startupAction": str(stored.get("startupAction") or base["startupAction"]),
                    "timing": str(stored.get("timing") or base["timing"]),
                    "retries": str(stored.get("retries") or base["retries"]),
                })
            result[day] = base
        return result

    def _ensure_day_profiles(self) -> None:
        self.config.values["duelDayProfiles"] = self._day_profiles()
        self.config.save()

    def _utc_day(self) -> str:
        return datetime.now(timezone.utc).strftime("%A")

    def _duel_auto_page(self) -> None:
        super()._duel_auto_page()
        if not hasattr(self, "duel_run_button"):
            return

        run_panel = self.duel_run_button.master
        before_widget = getattr(self, "automation_inline_panel", self.duel_run_button)
        profile_panel = ctk.CTkFrame(
            run_panel,
            fg_color=Colors.PANEL2,
            corner_radius=12,
            border_width=1,
            border_color=Colors.BORDER,
        )
        profile_panel.pack(fill="x", padx=17, pady=(0, 13), before=before_widget)
        self.day_profile_panel = profile_panel

        today = self._utc_day()
        today_label = DAY_EVENTS.get(today, "Alliance Duel")
        ctk.CTkLabel(
            profile_panel,
            text="TODAY'S ALLIANCE DUEL",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=13, pady=(12, 2))
        self.today_profile_title = ctk.CTkLabel(
            profile_panel,
            text=f"{today} · {today_label}",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        )
        self.today_profile_title.pack(anchor="w", padx=13)
        self.today_profile_summary = ctk.CTkLabel(
            profile_panel,
            text="Loading today's saved automation profile...",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=860,
            justify="left",
        )
        self.today_profile_summary.pack(anchor="w", padx=13, pady=(2, 10))

        edit_row = ctk.CTkFrame(profile_panel, fg_color="transparent")
        edit_row.pack(fill="x", padx=13, pady=(0, 8))
        ctk.CTkLabel(edit_row, text="Configure day", text_color=Colors.MUTED, font=(self.font, 9)).pack(side="left", padx=(0, 6))
        self.day_profile_day_menu = ctk.CTkOptionMenu(
            edit_row,
            values=DAY_CHOICES,
            width=185,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
            command=self._profile_day_changed,
        )
        self.day_profile_day_menu.set(f"{today} - {today_label}")
        self.day_profile_day_menu.pack(side="left")

        ctk.CTkLabel(edit_row, text="Sequence", text_color=Colors.MUTED, font=(self.font, 9)).pack(side="left", padx=(14, 6))
        self.day_profile_sequence_menu = ctk.CTkComboBox(
            edit_row,
            values=list(self._automation_profiles.keys()) or [DEFAULT_WEEKDAY_SEQUENCE],
            height=36,
            fg_color=Colors.PANEL,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
        )
        self.day_profile_sequence_menu.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            edit_row,
            text="Save Day Profile",
            width=125,
            height=36,
            fg_color=Colors.PANEL,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.save_day_profile,
        ).pack(side="left", padx=(8, 0))

        ctk.CTkLabel(
            profile_panel,
            text=(
                "Day profiles point to normal Sequence Studio JSONs. Change the JSON below, adjust startup/timing/retries in "
                "the Sequence section, then Save Day Profile. The primary button always runs today's saved profile."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 8),
            wraplength=860,
            justify="left",
        ).pack(anchor="w", padx=13, pady=(0, 11))

        self.duel_run_button.configure(text="RUN TODAY'S ALLIANCE DUEL", command=self.run_today_duel)
        if hasattr(self, "automation_inline_panel"):
            self.manual_sequence_button = ctk.CTkButton(
                self.automation_inline_panel,
                text="Run selected JSON manually",
                height=34,
                fg_color="transparent",
                border_width=1,
                border_color=Colors.BORDER,
                hover_color=Colors.BORDER,
                text_color=Colors.MUTED,
                font=(self.font, 9, "bold"),
                command=self.run_selected_json_manually,
            )
            self.manual_sequence_button.pack(anchor="w", padx=13, pady=(0, 11))

        self._refresh_day_profile_editor()

    def refresh_automation_sequences(self) -> None:
        super().refresh_automation_sequences()
        if hasattr(self, "day_profile_sequence_menu"):
            values = list(self._automation_profiles.keys()) or [DEFAULT_WEEKDAY_SEQUENCE]
            self.day_profile_sequence_menu.configure(values=values)
            self._refresh_day_profile_editor()

    def _selected_profile_day(self) -> str:
        value = self.day_profile_day_menu.get() if hasattr(self, "day_profile_day_menu") else self._utc_day()
        return str(value).split(" - ", 1)[0].strip()

    def _profile_day_changed(self, _value: str | None = None) -> None:
        self._refresh_day_profile_editor()

    def _refresh_day_profile_editor(self) -> None:
        if not hasattr(self, "day_profile_sequence_menu"):
            return
        profiles = self._day_profiles()
        day = self._selected_profile_day()
        profile = profiles.get(day, self._default_day_profile(day))
        sequence = str(profile.get("sequence") or "")
        if sequence:
            self.day_profile_sequence_menu.set(sequence)

        today = self._utc_day()
        today_profile = profiles.get(today, self._default_day_profile(today))
        today_sequence = str(today_profile.get("sequence") or "Not configured")
        requirements = ", ".join(sorted(self._required_rank_labels_for_day(today))) if today != "Sunday" else "Sunday profile not configured"
        if hasattr(self, "today_profile_summary"):
            self.today_profile_summary.configure(
                text=(
                    f"Saved profile: {today_sequence} · startup {today_profile.get('startupWait', '10 seconds')} · "
                    f"{today_profile.get('startupAction', STARTUP_PCMASK)} · {today_profile.get('timing', TIMING_RECORDED)} · "
                    f"{today_profile.get('retries', '4')} retries. Required data: {requirements}. Cloud Sync is required."
                ),
                text_color=Colors.SUCCESS if today_sequence in self._automation_profiles else Colors.MUTED,
            )

    def save_day_profile(self) -> None:
        day = self._selected_profile_day()
        sequence = self.day_profile_sequence_menu.get().strip()
        if sequence not in self._automation_profiles:
            self._set_duel_status(
                f"Cannot save {day}: choose a Sequence Studio JSON that exists in the sequence list.",
                Colors.DANGER,
            )
            return
        profiles = self._day_profiles()
        profiles[day] = {
            "sequence": sequence,
            "startupWait": self.automation_settle_menu.get(),
            "startupAction": self.automation_startup_menu.get(),
            "timing": self.automation_timing_menu.get(),
            "retries": self.automation_retry_menu.get(),
        }
        self.config.values["duelDayProfiles"] = profiles
        self.config.save()
        self._refresh_day_profile_editor()
        self._set_duel_status(
            f"Saved {day} profile: {sequence}. Future one-button {day} runs will use this JSON.",
            Colors.SUCCESS,
        )

    def _apply_day_profile(self, day: str) -> str:
        self.refresh_automation_sequences()
        profile = self._day_profiles().get(day, self._default_day_profile(day))
        sequence = str(profile.get("sequence") or "").strip()
        if not sequence:
            raise ValueError(f"No Alliance Duel sequence is assigned to {day} yet.")
        if sequence not in self._automation_profiles:
            raise ValueError(
                f"{day} is assigned to '{sequence}', but that Sequence Studio JSON is not available on this PC. "
                "Choose another sequence and Save Day Profile."
            )

        self.automation_sequence_menu.set(sequence)
        self._automation_sequence_changed(sequence)
        self.automation_settle_menu.set(str(profile.get("startupWait") or "10 seconds"))
        self.automation_startup_menu.set(str(profile.get("startupAction") or STARTUP_PCMASK))
        self.automation_timing_menu.set(str(profile.get("timing") or TIMING_RECORDED))
        self.automation_retry_menu.set(str(profile.get("retries") or "4"))
        self.duel_sync_switch.select()
        return sequence

    def run_today_duel(self) -> None:
        if self.duel_running:
            return
        day = self._utc_day()
        if day == "Sunday":
            self._set_duel_status(
                "Sunday does not have a default production profile yet. Assign a tested Sunday JSON in the Day Profile editor first.",
                Colors.DANGER,
            )
            return
        try:
            sequence = self._apply_day_profile(day)
        except Exception as exc:
            self._set_duel_status(str(exc), Colors.DANGER)
            return

        self.production_day_run = True
        self.production_day_name = day
        self.production_day_event = DAY_EVENTS.get(day, "Alliance Duel")
        self.production_profile_name = sequence
        self.production_required_rank_labels = self._required_rank_labels_for_day(day)

        super().run_duel_sync()
        if not self.duel_running:
            self.production_day_run = False
            self.production_required_rank_labels = set()
            self._restore_primary_button()
            return

        v110.REQUIRED_RANK_LABELS = set(self.production_required_rank_labels)
        self.duel_run_button.configure(state="disabled", text="TODAY'S ALLIANCE DUEL RUNNING")
        if hasattr(self, "manual_sequence_button"):
            self.manual_sequence_button.configure(state="disabled")
        self._set_duel_status(
            f"{day} · {self.production_day_event}: running saved profile '{sequence}' with the proven 1.2.7 typed component resolver. "
            "The run will only pass after today's required Duel datasets are packaged and Cloudflare acknowledges the sync."
        )

    def run_selected_json_manually(self) -> None:
        if self.duel_running:
            return
        self.production_day_run = False
        self.production_day_name = ""
        self.production_day_event = ""
        self.production_profile_name = ""
        self.production_required_rank_labels = set()
        super().run_duel_sync()
        if self.duel_running and hasattr(self, "manual_sequence_button"):
            self.manual_sequence_button.configure(state="disabled")

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        merged = dict(extra or {})
        if self.production_day_run:
            merged.update({
                "productionDayRun": True,
                "gameDay": self.production_day_name,
                "gameDayEvent": self.production_day_event,
                "dayProfile": self.production_profile_name,
                "requiredRankTypes": sorted(self.production_required_rank_labels),
                "oneButtonContract": "day-aware verified package + Cloudflare acknowledgement",
            })
        super()._write_duel_run_report(status, merged)

    def _restore_primary_button(self) -> None:
        if hasattr(self, "duel_run_button"):
            self.duel_run_button.configure(state="normal", text="RUN TODAY'S ALLIANCE DUEL", command=self.run_today_duel)
        if hasattr(self, "manual_sequence_button"):
            self.manual_sequence_button.configure(state="normal")

    def _duel_success(self, message: str) -> None:
        was_production = self.production_day_run
        day = self.production_day_name
        profile = self.production_profile_name
        super()._duel_success(message)
        self._restore_primary_button()
        if was_production:
            self._set_duel_status(
                f"{day} Alliance Duel complete using '{profile}'. Required datasets were verified and Cloudflare acknowledged the upload.",
                Colors.SUCCESS,
            )
        self.production_day_run = False

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        super()._duel_fail(message, preserve_capture=preserve_capture)
        self._restore_primary_button()
        self.production_day_run = False
