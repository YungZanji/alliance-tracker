from __future__ import annotations

import json
import os
from pathlib import Path
from tkinter import filedialog
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v100 import SEQUENCE_DIR
from app_v124_runtime import STARTUP_NONE, STARTUP_PCMASK, TIMING_FIXED, TIMING_RECORDED
from app_v130_runtime import DAY_EVENTS, DEFAULT_WEEKDAY_SEQUENCE
from app_v131_runtime import App as BaseApp
from utils import APP_DATA_DIR, SESSIONS_DIR, utc_now


DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
EVENTS = {
    "alliance_duel": "Alliance Duel",
    "state_ruler": "State Ruler",
    "glory_war": "Glory War",
}
EVENT_ORDER = ["alliance_duel", "state_ruler", "glory_war"]
CAPTURE_PURPOSES = {
    "Alliance Duel Discovery": "Train or inspect Alliance Duel responses and ranking controls.",
    "State Ruler Discovery": "Discover State Ruler/SVS score, participation and attendance-related responses.",
    "Glory War Discovery": "Discover Glory War scoring and participation responses.",
    "Arena Power + Last Online": "Capture alliance-member Arena Power together with Last Online evidence.",
    "Total Power + Last Online": "Capture total player power and Last Online evidence for participation context.",
    "Alliance Vote / Poll": "Discover alliance notice/poll payloads and who selected each response.",
    "Custom / General": "General decoded-response capture for a workflow that is still being discovered.",
}


class App(BaseApp):
    """1.4.0 review: consolidated Capture Studio + Sequence Studio + multi-event Auto Sync."""

    PLAN_SCHEMA_VERSION = 1

    def __init__(self) -> None:
        self.sync_plan_running = False
        self.sync_plan_day = ""
        self.sync_plan_queue: list[dict[str, Any]] = []
        self.sync_plan_current: dict[str, Any] | None = None
        self.sync_plan_results: list[dict[str, Any]] = []
        self.event_profile_controls: dict[str, dict[str, Any]] = {}
        self._auto_progress_value = 0.0
        super().__init__()
        self._ensure_sync_plans()
        self._refresh_all_event_profile_controls()
        self._refresh_today_plan_card()
        self.after(220, lambda: self.show("duel_auto"))

    # ---------- layout consolidation ----------

    def _layout(self) -> None:
        super()._layout()
        self._consolidate_sidebar()
        self._upgrade_overview_to_capture_studio()
        self._polish_sequence_studio_page()
        self._replace_auto_sync_surface()
        self._extend_settings_for_automation()
        self._stabilize_scroll_surfaces()

    def _consolidate_sidebar(self) -> None:
        if not self.nav:
            return
        side = next(iter(self.nav.values())).master
        try:
            side.configure(width=178)
            side.grid_rowconfigure(8, weight=0)
            side.grid_rowconfigure(5, weight=1)
        except Exception:
            pass

        for key in ("capture", "cloud", "replay"):
            button = self.nav.get(key)
            if button:
                button.grid_remove()

        desired = [
            ("overview", "Capture", 1),
            ("sessions", "Sessions", 2),
            ("sequence_studio", "Sequence Studio", 3),
            ("duel_auto", "Auto Sync", 4),
        ]
        for key, label, row in desired:
            button = self.nav.get(key)
            if not button:
                continue
            button.configure(text=label)
            button.grid(row=row, column=0, sticky="ew", padx=9, pady=3)

        settings = self.nav.get("settings")
        if settings:
            settings.configure(text="Settings")
            settings.grid(row=99, column=0, sticky="sew", padx=9, pady=(3, 12))

        # Remove the old static "Manual navigation" note.
        for child in side.winfo_children():
            try:
                info = child.grid_info()
                if int(info.get("row", -1)) == 9 and child not in self.nav.values():
                    child.grid_remove()
            except Exception:
                pass

    def _upgrade_overview_to_capture_studio(self) -> None:
        page = self.pages.get("overview")
        if not page:
            return
        children = page.winfo_children()
        if len(children) >= 2:
            try:
                children[0].configure(text="Capture Studio")
                children[1].configure(
                    text="Discover and package structured game data before promoting a workflow into Auto Sync."
                )
            except Exception:
                pass

        # Hide the old Alliance-Duel-only workflow card; the status cards and log remain useful.
        try:
            old_panel = self.attach_overview.master.master
            old_panel.pack_forget()
        except Exception:
            pass

        studio = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        studio.pack(fill="x", pady=(14, 14), before=self.overview_log)
        ctk.CTkLabel(studio, text="CAPTURE WORKSPACE", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(studio, text="Choose what you are trying to learn", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)

        row = ctk.CTkFrame(studio, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=(10, 8))
        self.capture_purpose_menu = ctk.CTkOptionMenu(
            row,
            values=list(CAPTURE_PURPOSES),
            width=260,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
            command=self._capture_purpose_changed,
        )
        saved_purpose = str(self.config.values.get("capturePurpose") or "Alliance Duel Discovery")
        if saved_purpose not in CAPTURE_PURPOSES:
            saved_purpose = "Alliance Duel Discovery"
        self.capture_purpose_menu.set(saved_purpose)
        self.capture_purpose_menu.pack(side="left")
        self.capture_label_entry = ctk.CTkEntry(
            row,
            height=38,
            placeholder_text="Session label",
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 9),
        )
        self.capture_label_entry.pack(side="left", fill="x", expand=True, padx=(8, 0))

        self.capture_purpose_help = ctk.CTkLabel(
            studio,
            text=CAPTURE_PURPOSES[saved_purpose],
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.capture_purpose_help.pack(anchor="w", padx=16, pady=(0, 8))

        actions = ctk.CTkFrame(studio, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(0, 14))
        ctk.CTkButton(actions, text="Attach", height=38, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 10, "bold"), command=self._capture_studio_attach).pack(side="left")
        ctk.CTkButton(actions, text="Start Capture", height=38, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 10, "bold"), command=self._capture_studio_start).pack(side="left", padx=7)
        ctk.CTkButton(actions, text="Stop & Package", height=38, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 10, "bold"), command=self._capture_studio_stop).pack(side="left")
        ctk.CTkButton(actions, text="Open Data Folder", height=38, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, text_color=Colors.MUTED, font=(self.font, 9, "bold"), command=lambda: os.startfile(APP_DATA_DIR)).pack(side="right")

    def _capture_purpose_changed(self, value: str) -> None:
        value = str(value or "Custom / General")
        self.config.values["capturePurpose"] = value
        self.config.save()
        if hasattr(self, "capture_purpose_help"):
            self.capture_purpose_help.configure(text=CAPTURE_PURPOSES.get(value, CAPTURE_PURPOSES["Custom / General"]))
        if hasattr(self, "capture_label_entry") and not self.capture_label_entry.get().strip():
            self.capture_label_entry.insert(0, value)

    def _capture_studio_attach(self) -> None:
        self.attach()
        self.write("Capture Studio: attach requested.")

    def _capture_studio_start(self) -> None:
        purpose = self.capture_purpose_menu.get() if hasattr(self, "capture_purpose_menu") else "Custom / General"
        label = self.capture_label_entry.get().strip() if hasattr(self, "capture_label_entry") else ""
        label = label or purpose
        try:
            self.label.delete(0, "end")
            self.label.insert(0, label)
        except Exception:
            pass
        self.start()
        if self.session_id:
            self.config.values["capturePurpose"] = purpose
            self.config.save()
            raw = SESSIONS_DIR / self.session_id / "raw"
            raw.mkdir(parents=True, exist_ok=True)
            (raw / "capture-purpose.json").write_text(json.dumps({
                "schemaVersion": 1,
                "purpose": purpose,
                "description": CAPTURE_PURPOSES.get(purpose, ""),
                "startedAt": utc_now(),
            }, indent=2), encoding="utf-8")
            self.write(f"Capture Studio: {purpose} session started.")

    def _capture_studio_stop(self) -> None:
        self.stop()
        self.write("Capture Studio: capture stopped and package requested.")

    def _polish_sequence_studio_page(self) -> None:
        page = self.pages.get("sequence_studio")
        if not page:
            return
        children = page.winfo_children()
        if len(children) >= 2:
            try:
                children[0].configure(text="Sequence Studio")
                children[1].configure(text="Discover controls, record paths, replay them, and save portable JSON sequences for Auto Sync.")
            except Exception:
                pass

    # ---------- daily multi-event plans ----------

    def _default_sync_plans(self) -> dict[str, list[dict[str, Any]]]:
        plans: dict[str, list[dict[str, Any]]] = {day: [] for day in DAY_ORDER}
        duel_profiles = self._day_profiles()
        for day in DAY_ORDER:
            duel = duel_profiles.get(day, self._default_day_profile(day))
            sequence = str(duel.get("sequence") or "").strip()
            if day != "Sunday" and sequence:
                plans[day].append({
                    "eventType": "alliance_duel",
                    "sequence": sequence,
                    "order": 1,
                    "startupWait": str(duel.get("startupWait") or "10 seconds"),
                    "startupAction": str(duel.get("startupAction") or STARTUP_NONE),
                    "timing": str(duel.get("timing") or TIMING_RECORDED),
                    "retries": str(duel.get("retries") or "4"),
                    "enabled": True,
                })
        return plans

    def _sync_plans(self) -> dict[str, list[dict[str, Any]]]:
        raw = self.config.values.get("autoSyncDayPlans")
        if not isinstance(raw, dict):
            return self._default_sync_plans()
        result: dict[str, list[dict[str, Any]]] = {day: [] for day in DAY_ORDER}
        for day in DAY_ORDER:
            rows = raw.get(day)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                event_type = str(row.get("eventType") or "")
                if event_type not in EVENTS:
                    continue
                result[day].append({
                    "eventType": event_type,
                    "sequence": str(row.get("sequence") or ""),
                    "order": max(1, min(9, int(row.get("order") or 1))),
                    "startupWait": str(row.get("startupWait") or "10 seconds"),
                    "startupAction": str(row.get("startupAction") or STARTUP_NONE),
                    "timing": str(row.get("timing") or TIMING_RECORDED),
                    "retries": str(row.get("retries") or "4"),
                    "enabled": bool(row.get("enabled", True)),
                })
        return result

    def _ensure_sync_plans(self) -> None:
        try:
            version = int(self.config.values.get("autoSyncPlanSchemaVersion") or 0)
        except Exception:
            version = 0
        if version >= self.PLAN_SCHEMA_VERSION and isinstance(self.config.values.get("autoSyncDayPlans"), dict):
            return
        self.config.values["autoSyncDayPlans"] = self._default_sync_plans()
        self.config.values["autoSyncPlanSchemaVersion"] = self.PLAN_SCHEMA_VERSION
        self.config.save()

    def _replace_auto_sync_surface(self) -> None:
        page = self.pages.get("duel_auto")
        if not page:
            return
        children = page.winfo_children()
        if len(children) >= 2:
            try:
                children[0].configure(text="Auto Sync")
                children[1].configure(text="Run one or more saved event sequences for today, in the order you choose.")
            except Exception:
                pass
        for child in page.winfo_children():
            if isinstance(child, ctk.CTkScrollableFrame):
                child.pack_forget()

        root = ctk.CTkFrame(page, fg_color="transparent")
        root.pack(fill="both", expand=True)
        root.grid_columnconfigure(0, weight=1)
        root.grid_rowconfigure(1, weight=1)

        today = ctk.CTkFrame(root, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        today.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        top = ctk.CTkFrame(today, fg_color="transparent")
        top.pack(fill="x", padx=15, pady=(13, 5))
        ctk.CTkLabel(top, text="TODAY'S SYNC PLAN", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(side="left")
        self.today_plan_title = ctk.CTkLabel(top, text="Loading…", text_color=Colors.TEXT, font=(self.font, 16, "bold"))
        self.today_plan_title.pack(side="right")
        self.today_plan_summary = ctk.CTkLabel(today, text="", text_color=Colors.MUTED, font=(self.font, 9), wraplength=900, justify="left")
        self.today_plan_summary.pack(anchor="w", padx=15, pady=(0, 8))
        self.auto_run_button = ctk.CTkButton(today, text="RUN TODAY'S SYNC PLAN", height=48, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 12, "bold"), command=self.run_today_sync_plan)
        self.auto_run_button.pack(fill="x", padx=15, pady=(0, 7))
        self.auto_progress_bar = ctk.CTkProgressBar(today, height=8, progress_color=Colors.ACCENT, fg_color=Colors.PANEL2)
        self.auto_progress_bar.pack(fill="x", padx=15, pady=(0, 5))
        self.auto_progress_bar.set(0)
        self.auto_progress_text = ctk.CTkLabel(today, text="Ready.", text_color=Colors.MUTED, font=(self.font, 9), wraplength=900, justify="left")
        self.auto_progress_text.pack(anchor="w", padx=15, pady=(0, 12))

        tabs = ctk.CTkTabview(root, fg_color=Colors.PANEL, segmented_button_fg_color=Colors.PANEL2, segmented_button_selected_color=Colors.ACCENT, segmented_button_selected_hover_color=Colors.ACCENT_HOVER, corner_radius=14)
        tabs.grid(row=1, column=0, sticky="nsew")
        self.auto_sync_tabs = tabs
        for event_type in EVENT_ORDER:
            label = EVENTS[event_type]
            tab = tabs.add(f"{label} Sync")
            self._build_event_profile_tab(tab, event_type)

        manual = ctk.CTkFrame(root, fg_color=Colors.PANEL, corner_radius=12, border_width=1, border_color=Colors.BORDER)
        manual.grid(row=2, column=0, sticky="ew", pady=(10, 0))
        ctk.CTkLabel(manual, text="Manual sequence", text_color=Colors.MUTED, font=(self.font, 9, "bold")).pack(side="left", padx=(13, 8), pady=10)
        self.auto_manual_sequence_menu = ctk.CTkComboBox(manual, values=list(self._automation_profiles) or [DEFAULT_WEEKDAY_SEQUENCE], height=34, fg_color=Colors.PANEL2, border_color=Colors.BORDER, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, text_color=Colors.TEXT, font=(self.font, 9))
        self.auto_manual_sequence_menu.pack(side="left", fill="x", expand=True, pady=10)
        ctk.CTkButton(manual, text="Run selected JSON", height=34, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self.run_auto_manual_sequence).pack(side="left", padx=9, pady=10)

    def _build_event_profile_tab(self, tab: ctk.CTkFrame, event_type: str) -> None:
        tab.grid_columnconfigure(1, weight=1)
        title = EVENTS[event_type]
        ctk.CTkLabel(tab, text=f"{title} profile", text_color=Colors.TEXT, font=(self.font, 15, "bold")).grid(row=0, column=0, columnspan=3, sticky="w", padx=12, pady=(10, 2))
        note = "Verified day-aware Duel contract." if event_type == "alliance_duel" else "Sequence-driven capture; event-specific verification will be promoted after training."
        ctk.CTkLabel(tab, text=note, text_color=Colors.MUTED, font=(self.font, 8), wraplength=820, justify="left").grid(row=1, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 8))

        ctk.CTkLabel(tab, text="Sequence", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=2, column=0, sticky="w", padx=12)
        sequence = ctk.CTkComboBox(tab, values=list(self._automation_profiles) or ["No saved sequences"], height=34, fg_color=Colors.PANEL2, border_color=Colors.BORDER, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, text_color=Colors.TEXT, font=(self.font, 9))
        sequence.grid(row=2, column=1, columnspan=2, sticky="ew", padx=(6, 12))

        ctk.CTkLabel(tab, text="Run order", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=3, column=0, sticky="w", padx=12, pady=(7, 0))
        order = ctk.CTkOptionMenu(tab, values=["1", "2", "3"], width=74, height=32, fg_color=Colors.PANEL2, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, font=(self.font, 9))
        order.set(str(EVENT_ORDER.index(event_type) + 1))
        order.grid(row=3, column=1, sticky="w", padx=6, pady=(7, 0))

        options = ctk.CTkFrame(tab, fg_color="transparent")
        options.grid(row=4, column=0, columnspan=3, sticky="ew", padx=12, pady=(8, 0))
        startup_wait = ctk.CTkOptionMenu(options, values=["5 seconds", "10 seconds", "15 seconds"], width=120, height=31, fg_color=Colors.PANEL2, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, font=(self.font, 8))
        startup_wait.set("10 seconds"); startup_wait.pack(side="left")
        startup_action = ctk.CTkOptionMenu(options, values=[STARTUP_NONE, STARTUP_PCMASK], width=175, height=31, fg_color=Colors.PANEL2, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, font=(self.font, 8))
        startup_action.set(STARTUP_NONE); startup_action.pack(side="left", padx=6)
        timing = ctk.CTkOptionMenu(options, values=[TIMING_RECORDED, TIMING_FIXED], width=170, height=31, fg_color=Colors.PANEL2, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, font=(self.font, 8))
        timing.set(TIMING_RECORDED); timing.pack(side="left")
        retries = ctk.CTkOptionMenu(options, values=["3", "4", "5", "8"], width=65, height=31, fg_color=Colors.PANEL2, button_color=Colors.ACCENT, button_hover_color=Colors.ACCENT_HOVER, font=(self.font, 8))
        retries.set("4"); retries.pack(side="left", padx=6)

        days_frame = ctk.CTkFrame(tab, fg_color=Colors.PANEL2, corner_radius=10)
        days_frame.grid(row=5, column=0, columnspan=3, sticky="ew", padx=12, pady=(9, 0))
        ctk.CTkLabel(days_frame, text="Apply to days", text_color=Colors.MUTED, font=(self.font, 8, "bold")).pack(side="left", padx=(9, 5), pady=7)
        day_vars: dict[str, ctk.BooleanVar] = {}
        for day in DAY_ORDER:
            var = ctk.BooleanVar(master=self, value=day == self._utc_day())
            day_vars[day] = var
            ctk.CTkCheckBox(days_frame, text=day[:3], variable=var, width=66, checkbox_width=18, checkbox_height=18, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, border_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 8)).pack(side="left", padx=2, pady=7)

        buttons = ctk.CTkFrame(tab, fg_color="transparent")
        buttons.grid(row=6, column=0, columnspan=3, sticky="ew", padx=12, pady=(8, 8))
        ctk.CTkButton(buttons, text="Weekdays", width=80, height=32, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 8, "bold"), command=lambda ev=event_type: self._select_profile_days(ev, weekdays=True)).pack(side="left")
        ctk.CTkButton(buttons, text="Today", width=70, height=32, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 8, "bold"), command=lambda ev=event_type: self._select_profile_days(ev, today_only=True)).pack(side="left", padx=5)
        ctk.CTkButton(buttons, text="Apply profile to selected days", height=32, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 8, "bold"), command=lambda ev=event_type: self.save_event_profile_to_days(ev)).pack(side="left")
        ctk.CTkButton(buttons, text="Run this event now", height=32, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, text_color=Colors.TEXT, font=(self.font, 8, "bold"), command=lambda ev=event_type: self.run_event_now(ev)).pack(side="right")

        summary = ctk.CTkLabel(tab, text="", text_color=Colors.MUTED, font=(self.font, 8), wraplength=850, justify="left")
        summary.grid(row=7, column=0, columnspan=3, sticky="w", padx=12, pady=(0, 8))
        self.event_profile_controls[event_type] = {
            "sequence": sequence,
            "order": order,
            "startupWait": startup_wait,
            "startupAction": startup_action,
            "timing": timing,
            "retries": retries,
            "days": day_vars,
            "summary": summary,
        }

    def _select_profile_days(self, event_type: str, weekdays: bool = False, today_only: bool = False) -> None:
        controls = self.event_profile_controls.get(event_type, {})
        vars_ = controls.get("days", {})
        today = self._utc_day()
        for day, var in vars_.items():
            value = (day != "Sunday") if weekdays else (day == today if today_only else False)
            var.set(value)

    def _job_from_controls(self, event_type: str) -> dict[str, Any] | None:
        controls = self.event_profile_controls.get(event_type)
        if not controls:
            return None
        sequence = str(controls["sequence"].get() or "").strip()
        if sequence not in self._automation_profiles:
            return None
        return {
            "eventType": event_type,
            "sequence": sequence,
            "order": int(controls["order"].get() or 1),
            "startupWait": controls["startupWait"].get(),
            "startupAction": controls["startupAction"].get(),
            "timing": controls["timing"].get(),
            "retries": controls["retries"].get(),
            "enabled": True,
        }

    def save_event_profile_to_days(self, event_type: str) -> None:
        job = self._job_from_controls(event_type)
        if not job:
            self._set_duel_status(f"Choose a saved Sequence Studio JSON for {EVENTS[event_type]} first.", Colors.DANGER)
            return
        controls = self.event_profile_controls[event_type]
        selected = [day for day, var in controls["days"].items() if bool(var.get())]
        if not selected:
            self._set_duel_status("Select at least one day to apply this profile to.", Colors.DANGER)
            return
        plans = self._sync_plans()
        for day in selected:
            rows = [row for row in plans.get(day, []) if row.get("eventType") != event_type]
            rows.append(dict(job))
            rows.sort(key=lambda row: (int(row.get("order") or 1), EVENT_ORDER.index(row.get("eventType")) if row.get("eventType") in EVENT_ORDER else 99))
            plans[day] = rows
            if event_type == "alliance_duel":
                duel_profiles = self._day_profiles()
                duel_profiles[day] = {
                    "sequence": job["sequence"],
                    "startupWait": job["startupWait"],
                    "startupAction": job["startupAction"],
                    "timing": job["timing"],
                    "retries": job["retries"],
                }
                self.config.values["duelDayProfiles"] = duel_profiles
        self.config.values["autoSyncDayPlans"] = plans
        self.config.save()
        self._refresh_all_event_profile_controls()
        self._refresh_today_plan_card()
        self._set_duel_status(f"Saved {EVENTS[event_type]} profile to: {', '.join(selected)}.", Colors.SUCCESS)

    def _refresh_all_event_profile_controls(self) -> None:
        if not self.event_profile_controls:
            return
        self.refresh_automation_sequences()
        values = list(self._automation_profiles) or ["No saved sequences"]
        plans = self._sync_plans()
        today = self._utc_day()
        for event_type, controls in self.event_profile_controls.items():
            controls["sequence"].configure(values=values)
            job = next((row for row in plans.get(today, []) if row.get("eventType") == event_type), None)
            if job:
                controls["sequence"].set(str(job.get("sequence") or values[0]))
                controls["order"].set(str(job.get("order") or 1))
                controls["startupWait"].set(str(job.get("startupWait") or "10 seconds"))
                controls["startupAction"].set(str(job.get("startupAction") or STARTUP_NONE))
                controls["timing"].set(str(job.get("timing") or TIMING_RECORDED))
                controls["retries"].set(str(job.get("retries") or "4"))
            elif values:
                controls["sequence"].set(values[0])
            assigned = []
            for day in DAY_ORDER:
                row = next((item for item in plans.get(day, []) if item.get("eventType") == event_type and item.get("enabled", True)), None)
                if row:
                    assigned.append(f"{day[:3]}: {row.get('sequence')} (#{row.get('order', 1)})")
            controls["summary"].configure(text="Assigned · " + (" · ".join(assigned) if assigned else "No saved day assignments yet."))
        if hasattr(self, "auto_manual_sequence_menu"):
            self.auto_manual_sequence_menu.configure(values=values)
            if values:
                self.auto_manual_sequence_menu.set(values[0])

    def _refresh_today_plan_card(self) -> None:
        if not hasattr(self, "today_plan_title"):
            return
        day = self._utc_day()
        jobs = sorted([row for row in self._sync_plans().get(day, []) if row.get("enabled", True) and row.get("sequence")], key=lambda row: int(row.get("order") or 1))
        self.today_plan_title.configure(text=f"{day} · {DAY_EVENTS.get(day, 'Event day')}")
        if jobs:
            summary = " → ".join(f"{int(row.get('order') or 1)}. {EVENTS.get(row.get('eventType'), row.get('eventType'))}: {row.get('sequence')}" for row in jobs)
            self.today_plan_summary.configure(text=summary, text_color=Colors.SUCCESS)
        else:
            self.today_plan_summary.configure(text="No Auto Sync jobs are assigned to today yet. Use the tabs below to assign one or more event sequences.", text_color=Colors.MUTED)

    def _apply_job(self, job: dict[str, Any]) -> None:
        self.refresh_automation_sequences()
        sequence = str(job.get("sequence") or "")
        if sequence not in self._automation_profiles:
            raise ValueError(f"Sequence '{sequence}' is not available on this PC.")
        self.automation_sequence_menu.set(sequence)
        self._automation_sequence_changed(sequence)
        self.automation_settle_menu.set(str(job.get("startupWait") or "10 seconds"))
        self.automation_startup_menu.set(str(job.get("startupAction") or STARTUP_NONE))
        self.automation_timing_menu.set(str(job.get("timing") or TIMING_RECORDED))
        self.automation_retry_menu.set(str(job.get("retries") or "4"))
        self.duel_sync_switch.select()

    def run_today_sync_plan(self) -> None:
        if self.duel_running or self.sync_plan_running:
            return
        day = self._utc_day()
        jobs = sorted([dict(row) for row in self._sync_plans().get(day, []) if row.get("enabled", True) and row.get("sequence")], key=lambda row: int(row.get("order") or 1))
        if not jobs:
            self._set_duel_status(f"No Auto Sync jobs are assigned to {day} yet.", Colors.DANGER)
            return
        self.sync_plan_running = True
        self.sync_plan_day = day
        self.sync_plan_queue = jobs
        self.sync_plan_results = []
        self.sync_plan_current = None
        self._auto_progress_value = 0.0
        self.auto_progress_bar.set(0)
        self.auto_run_button.configure(state="disabled", text="TODAY'S SYNC PLAN RUNNING")
        self._set_duel_status(f"Starting {day} plan with {len(jobs)} job(s): " + " → ".join(EVENTS[row['eventType']] for row in jobs))
        self.after(100, self._start_next_sync_job)

    def _start_next_sync_job(self) -> None:
        if not self.sync_plan_running:
            return
        if not self.sync_plan_queue:
            self.sync_plan_running = False
            self.sync_plan_current = None
            self.auto_progress_bar.set(1)
            self.auto_progress_text.configure(text=f"{self.sync_plan_day} plan complete · {len(self.sync_plan_results)} event sync(s) succeeded.", text_color=Colors.SUCCESS)
            self.auto_run_button.configure(state="normal", text="RUN TODAY'S SYNC PLAN")
            self._refresh_today_plan_card()
            return
        job = self.sync_plan_queue.pop(0)
        self.sync_plan_current = job
        try:
            self._apply_job(job)
        except Exception as exc:
            self._sync_plan_abort(str(exc))
            return
        event_type = str(job.get("eventType"))
        self.auto_progress_text.configure(text=f"Running {EVENTS[event_type]} · {job.get('sequence')}", text_color=Colors.ACCENT)
        if event_type == "alliance_duel":
            super().run_today_duel()
        else:
            super().run_selected_json_manually()
        if not self.duel_running:
            self._sync_plan_abort(f"{EVENTS[event_type]} did not start. Check the status message above.")

    def run_event_now(self, event_type: str) -> None:
        if self.duel_running or self.sync_plan_running:
            return
        job = self._job_from_controls(event_type)
        if not job:
            self._set_duel_status(f"Choose a saved Sequence Studio JSON for {EVENTS[event_type]} first.", Colors.DANGER)
            return
        self.sync_plan_running = True
        self.sync_plan_day = self._utc_day()
        self.sync_plan_queue = [job]
        self.sync_plan_results = []
        self.auto_run_button.configure(state="disabled")
        self._start_next_sync_job()

    def run_auto_manual_sequence(self) -> None:
        if self.duel_running or self.sync_plan_running:
            return
        selected = self.auto_manual_sequence_menu.get().strip()
        if selected not in self._automation_profiles:
            self._set_duel_status("Choose a saved Sequence Studio JSON first.", Colors.DANGER)
            return
        self.automation_sequence_menu.set(selected)
        self._automation_sequence_changed(selected)
        super().run_selected_json_manually()

    def _sync_plan_abort(self, message: str) -> None:
        self.sync_plan_running = False
        self.sync_plan_queue = []
        self.sync_plan_current = None
        if hasattr(self, "auto_run_button"):
            self.auto_run_button.configure(state="normal", text="RUN TODAY'S SYNC PLAN")
        if hasattr(self, "auto_progress_text"):
            self.auto_progress_text.configure(text=f"Plan stopped: {message}", text_color=Colors.DANGER)

    def _duel_success(self, message: str) -> None:
        plan_active = self.sync_plan_running
        current = dict(self.sync_plan_current or {})
        super()._duel_success(message)
        if plan_active and self.sync_plan_running:
            self.sync_plan_results.append({
                "eventType": current.get("eventType"),
                "sequence": current.get("sequence"),
                "completedAt": utc_now(),
            })
            done = len(self.sync_plan_results)
            total = done + len(self.sync_plan_queue)
            self.auto_progress_bar.set(done / max(1, total))
            self.auto_progress_text.configure(text=f"{EVENTS.get(current.get('eventType'), 'Event')} complete. Preparing next job…", text_color=Colors.SUCCESS)
            self.after(900, self._start_next_sync_job)

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        plan_active = self.sync_plan_running
        current = dict(self.sync_plan_current or {})
        super()._duel_fail(message, preserve_capture)
        if plan_active:
            event = EVENTS.get(current.get("eventType"), "Current event")
            self._sync_plan_abort(f"{event} failed: {message}")

    def _set_duel_status(self, text: str, color: Any = None) -> None:
        super()._set_duel_status(text, color)
        if hasattr(self, "auto_progress_text"):
            self.auto_progress_text.configure(text=text, text_color=color or Colors.MUTED)

    def _set_duel_progress(self, key: str, text: str, color: Any = None) -> None:
        super()._set_duel_progress(key, text, color)
        if not hasattr(self, "auto_progress_bar"):
            return
        positions = {"game": .10, "attach": .20, "capture": .30, "base": .45, "weekly": .55, "alliance": .65, "return": .72, "verify": .82, "package": .91, "cloud": 1.0}
        if key in positions and str(text).lower() not in {"waiting", "checking"}:
            self._auto_progress_value = max(self._auto_progress_value, positions[key])
            self.auto_progress_bar.set(self._auto_progress_value)

    # ---------- settings / rendering ----------

    def _extend_settings_for_automation(self) -> None:
        page = self.pages.get("settings")
        if not page:
            return
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=14, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(panel, text="Automation launch", text_color=Colors.TEXT, font=(self.font, 14, "bold")).pack(anchor="w", padx=15, pady=(13, 4))
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=15, pady=(0, 12))
        self.settings_game_path = ctk.CTkEntry(row, height=36, fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 9))
        self.settings_game_path.pack(side="left", fill="x", expand=True)
        self.settings_game_path.insert(0, str(self.config.values.get("gameExecutable") or ""))
        ctk.CTkButton(row, text="Browse", width=76, height=36, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self._browse_settings_game).pack(side="left", padx=6)
        ctk.CTkButton(row, text="Save", width=70, height=36, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 9, "bold"), command=self._save_settings_game).pack(side="left")

    def _browse_settings_game(self) -> None:
        path = filedialog.askopenfilename(title="Choose Last Z launch executable", filetypes=[("Windows executable", "*.exe"), ("All files", "*.*")])
        if path:
            self.settings_game_path.delete(0, "end")
            self.settings_game_path.insert(0, path)
            self._save_settings_game()

    def _save_settings_game(self) -> None:
        path = self.settings_game_path.get().strip()
        self.config.values["gameExecutable"] = path
        self.config.save()
        try:
            self.duel_game_path.delete(0, "end")
            self.duel_game_path.insert(0, path)
        except Exception:
            pass
        self.write("Automation launch executable saved.")

    def _stabilize_scroll_surfaces(self) -> None:
        def walk(widget: Any) -> list[Any]:
            out = []
            for child in widget.winfo_children():
                out.append(child)
                out.extend(walk(child))
            return out
        for widget in walk(self):
            if isinstance(widget, ctk.CTkScrollableFrame):
                try:
                    widget.configure(fg_color=Colors.BG)
                    canvas = getattr(widget, "_parent_canvas", None)
                    if canvas is not None:
                        canvas.configure(highlightthickness=0, background="#08111F")
                        canvas.bind("<MouseWheel>", lambda _e, w=widget: w.after_idle(w.update_idletasks), add="+")
                except Exception:
                    pass
