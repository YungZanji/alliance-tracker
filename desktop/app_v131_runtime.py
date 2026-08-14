from __future__ import annotations

from typing import Any

import customtkinter as ctk

from app import Colors
from app_v124_runtime import STARTUP_NONE, TIMING_RECORDED
from app_v130_runtime import App as BaseApp, DAY_EVENTS, DEFAULT_WEEKDAY_SEQUENCE


class App(BaseApp):
    """1.3.1 review: proven weekday JSON + non-blocking optional startup + top quick-run action."""

    PROFILE_SCHEMA_VERSION = 2

    def __init__(self) -> None:
        super().__init__()
        self._migrate_default_weekday_profiles()
        self._refresh_day_profile_editor()
        self._refresh_quick_run_card()

    def _migrate_default_weekday_profiles(self) -> None:
        """Move generated default weekday profiles to the configuration that passed live.

        The successful Aug 10 run used the same typed resolver and weekday controls with
        Startup Action = None. Do not overwrite operator-assigned replacement sequences;
        only migrate profiles still pointing at the bundled weekday default.
        """
        current_version = int(self.config.values.get("duelDayProfileSchemaVersion") or 0)
        if current_version >= self.PROFILE_SCHEMA_VERSION:
            return
        profiles = self._day_profiles()
        for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"):
            profile = profiles.get(day) or self._default_day_profile(day)
            if str(profile.get("sequence") or "") == DEFAULT_WEEKDAY_SEQUENCE:
                profile["startupWait"] = "10 seconds"
                profile["startupAction"] = STARTUP_NONE
                profile["timing"] = TIMING_RECORDED
                profile["retries"] = "4"
                profiles[day] = profile
        self.config.values["duelDayProfiles"] = profiles
        self.config.values["duelDayProfileSchemaVersion"] = self.PROFILE_SCHEMA_VERSION
        self.config.save()

    def _duel_auto_page(self) -> None:
        super()._duel_auto_page()
        page = self.pages.get("duel_auto")
        if not page:
            return
        scroll = next((child for child in page.winfo_children() if isinstance(child, ctk.CTkScrollableFrame)), None)
        if scroll is None:
            return

        children = list(scroll.winfo_children())
        quick = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        pack_kwargs: dict[str, Any] = {"fill": "x", "pady": (0, 14)}
        if children:
            pack_kwargs["before"] = children[0]
        quick.pack(**pack_kwargs)
        self.today_quick_panel = quick

        ctk.CTkLabel(
            quick,
            text="TODAY'S ALLIANCE DUEL",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=17, pady=(15, 2))
        self.today_quick_title = ctk.CTkLabel(
            quick,
            text="Loading today's profile...",
            text_color=Colors.TEXT,
            font=(self.font, 19, "bold"),
        )
        self.today_quick_title.pack(anchor="w", padx=17)
        self.today_quick_summary = ctk.CTkLabel(
            quick,
            text="",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.today_quick_summary.pack(anchor="w", padx=17, pady=(2, 10))
        self.today_quick_button = ctk.CTkButton(
            quick,
            text="RUN TODAY'S ALLIANCE DUEL",
            height=50,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 13, "bold"),
            command=self.run_today_duel,
        )
        self.today_quick_button.pack(fill="x", padx=17, pady=(0, 15))
        self._refresh_quick_run_card()

    def _refresh_day_profile_editor(self) -> None:
        super()._refresh_day_profile_editor()
        self._refresh_quick_run_card()

    def _refresh_quick_run_card(self) -> None:
        if not hasattr(self, "today_quick_title"):
            return
        day = self._utc_day()
        event = DAY_EVENTS.get(day, "Alliance Duel")
        profile = self._day_profiles().get(day, self._default_day_profile(day))
        sequence = str(profile.get("sequence") or "Not configured")
        self.today_quick_title.configure(text=f"{day} · {event}")
        self.today_quick_summary.configure(
            text=(
                f"{sequence} · wait {profile.get('startupWait', '10 seconds')} · "
                f"startup {profile.get('startupAction', STARTUP_NONE)} · "
                f"{profile.get('timing', TIMING_RECORDED)} · {profile.get('retries', '4')} retries"
            )
        )

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if (
            self.automation_sequence_mode
            and self.duel_running
            and self.duel_stage == "sequence"
            and self.duel_wait_kind == "replay"
            and not bool(data.get("ok"))
            and bool(data.get("availabilityFailure"))
            and str(data.get("name") or "") == self.duel_current_control
        ):
            sequence = self._active_sequence()
            step = sequence[self.duel_step_index] if 0 <= self.duel_step_index < len(sequence) else {}
            if bool(step.get("optional")):
                name = str(step.get("name") or self.duel_current_control)
                self._reset_control_availability_wait()
                self.duel_step_results.append({
                    "index": self.duel_step_index + 1,
                    "name": name,
                    "ok": True,
                    "optional": True,
                    "skipped": True,
                    "method": "optional control unavailable; skipped",
                    "source": "sequence-json",
                })
                self.duel_step_attempts = 0
                self.duel_wait_kind = ""
                self._set_duel_status(
                    f"Optional control {name} is not active on this screen. Skipping it and continuing the saved sequence."
                )
                self.after(100, self._advance_duel_step)
                return
        super()._handle_duel_replay_result(data)

    def run_today_duel(self) -> None:
        super().run_today_duel()
        self._sync_quick_button_state()

    def run_selected_json_manually(self) -> None:
        super().run_selected_json_manually()
        self._sync_quick_button_state()

    def _sync_quick_button_state(self) -> None:
        if hasattr(self, "today_quick_button"):
            if self.duel_running:
                self.today_quick_button.configure(state="disabled", text="TODAY'S ALLIANCE DUEL RUNNING")
            else:
                self.today_quick_button.configure(state="normal", text="RUN TODAY'S ALLIANCE DUEL", command=self.run_today_duel)

    def _restore_primary_button(self) -> None:
        super()._restore_primary_button()
        self._sync_quick_button_state()

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        super()._duel_fail(message, preserve_capture)
        self._sync_quick_button_state()

    def _duel_success(self, message: str) -> None:
        super()._duel_success(message)
        self._sync_quick_button_state()
