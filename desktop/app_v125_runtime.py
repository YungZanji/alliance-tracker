from __future__ import annotations

import json
from pathlib import Path
from tkinter import filedialog

import customtkinter as ctk

from app import Colors
from app_v100 import SEQUENCE_DIR
from app_v124_runtime import (
    LEGACY_OPTION,
    NO_SEQUENCES,
    STARTUP_NONE,
    STARTUP_PCMASK,
    TIMING_FIXED,
    TIMING_RECORDED,
)
from app_v124_runtime_fix import App as BaseApp


class App(BaseApp):
    """1.2.5 review: put the JSON selector directly inside the Automated Run card."""

    def _duel_auto_page(self) -> None:
        super()._duel_auto_page()
        if not hasattr(self, "duel_run_button"):
            return

        run_panel = self.duel_run_button.master

        # 1.2.4 inserted its selector as a separate scroll-frame card. On some
        # CustomTkinter layouts that card did not surface where expected even though
        # the 1.2.4 runtime itself was active. Remove that card and rebuild the same
        # controls inside the Automated Run card, immediately above the blue Run button.
        old_panel = None
        try:
            old_panel = self.automation_sequence_menu.master.master
        except Exception:
            old_panel = None
        if old_panel is not None and old_panel is not run_panel:
            try:
                old_panel.destroy()
            except Exception:
                pass

        selector = ctk.CTkFrame(
            run_panel,
            fg_color=Colors.PANEL2,
            corner_radius=12,
            border_width=1,
            border_color=Colors.BORDER,
        )
        selector.pack(fill="x", padx=17, pady=(0, 13), before=self.duel_run_button)
        self.automation_inline_panel = selector

        ctk.CTkLabel(
            selector,
            text="SEQUENCE TO RUN",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=13, pady=(12, 2))
        ctk.CTkLabel(
            selector,
            text="Choose a Sequence Studio JSON",
            text_color=Colors.TEXT,
            font=(self.font, 14, "bold"),
        ).pack(anchor="w", padx=13)
        ctk.CTkLabel(
            selector,
            text=(
                "Pick a saved Sequence Studio workflow below, or import any compatible JSON. "
                "The selected file supplies the event-specific controls after common game startup/attach."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=860,
            justify="left",
        ).pack(anchor="w", padx=13, pady=(2, 8))

        choose_row = ctk.CTkFrame(selector, fg_color="transparent")
        choose_row.pack(fill="x", padx=13, pady=(0, 8))
        self.automation_sequence_menu = ctk.CTkComboBox(
            choose_row,
            values=[LEGACY_OPTION],
            height=39,
            fg_color=Colors.PANEL,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 10),
            command=self._automation_sequence_changed,
        )
        self.automation_sequence_menu.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            choose_row,
            text="Browse / Import JSON...",
            width=155,
            height=39,
            fg_color=Colors.PANEL,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.browse_automation_json,
        ).pack(side="left", padx=(8, 0))
        ctk.CTkButton(
            choose_row,
            text="Refresh",
            width=78,
            height=39,
            fg_color="transparent",
            border_width=1,
            border_color=Colors.BORDER,
            hover_color=Colors.BORDER,
            text_color=Colors.MUTED,
            font=(self.font, 9, "bold"),
            command=self.refresh_automation_sequences,
        ).pack(side="left", padx=(8, 0))

        options = ctk.CTkFrame(selector, fg_color="transparent")
        options.pack(fill="x", padx=13, pady=(0, 8))
        options.grid_columnconfigure(1, weight=1)
        options.grid_columnconfigure(3, weight=1)

        ctk.CTkLabel(options, text="Startup wait", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=0, column=0, sticky="w", padx=(0, 5))
        self.automation_settle_menu = ctk.CTkOptionMenu(
            options,
            values=["5 seconds", "10 seconds", "15 seconds"],
            width=130,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        settle = str(self.config.values.get("automationStartupWait") or "10 seconds")
        if settle not in {"5 seconds", "10 seconds", "15 seconds"}:
            settle = "10 seconds"
        self.automation_settle_menu.set(settle)
        self.automation_settle_menu.grid(row=0, column=1, sticky="w", padx=(0, 14))

        ctk.CTkLabel(options, text="Startup action", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=0, column=2, sticky="w", padx=(0, 5))
        self.automation_startup_menu = ctk.CTkOptionMenu(
            options,
            values=[STARTUP_NONE, STARTUP_PCMASK],
            width=190,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        startup = str(self.config.values.get("automationStartupAction") or STARTUP_PCMASK)
        if startup not in {STARTUP_NONE, STARTUP_PCMASK}:
            startup = STARTUP_PCMASK
        self.automation_startup_menu.set(startup)
        self.automation_startup_menu.grid(row=0, column=3, sticky="w")

        ctk.CTkLabel(options, text="Timing", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=1, column=0, sticky="w", padx=(0, 5), pady=(8, 0))
        self.automation_timing_menu = ctk.CTkOptionMenu(
            options,
            values=[TIMING_RECORDED, TIMING_FIXED],
            width=175,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        timing = str(self.config.values.get("automationSequenceTiming") or TIMING_RECORDED)
        if timing not in {TIMING_RECORDED, TIMING_FIXED}:
            timing = TIMING_RECORDED
        self.automation_timing_menu.set(timing)
        self.automation_timing_menu.grid(row=1, column=1, sticky="w", padx=(0, 14), pady=(8, 0))

        ctk.CTkLabel(options, text="Retries / step", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=1, column=2, sticky="w", padx=(0, 5), pady=(8, 0))
        self.automation_retry_menu = ctk.CTkOptionMenu(
            options,
            values=["3", "4", "5", "8"],
            width=80,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        retries = str(self.config.values.get("automationSequenceRetries") or "4")
        if retries not in {"3", "4", "5", "8"}:
            retries = "4"
        self.automation_retry_menu.set(retries)
        self.automation_retry_menu.grid(row=1, column=3, sticky="w", pady=(8, 0))

        self.automation_sequence_status = ctk.CTkLabel(
            selector,
            text="Loading Sequence Studio JSONs...",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=860,
            justify="left",
        )
        self.automation_sequence_status.pack(anchor="w", padx=13, pady=(1, 11))

        self.refresh_automation_sequences()
        self.duel_run_button.configure(text="RUN SELECTED AUTOMATION SEQUENCE")

    def browse_automation_json(self) -> None:
        SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
        path = filedialog.askopenfilename(
            title="Choose Sequence Studio JSON",
            initialdir=str(SEQUENCE_DIR),
            filetypes=[("JSON workflow", "*.json"), ("All files", "*.*")],
        )
        if not path:
            return

        source = Path(path)
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
            raw_steps = data.get("steps") or []
            if not isinstance(raw_steps, list):
                raise ValueError("JSON does not contain a steps list.")
            valid_steps = [
                row for row in raw_steps
                if isinstance(row, dict) and str(row.get("name") or "").strip()
            ]
            if not valid_steps:
                raise ValueError("JSON contains no replayable named controls.")
        except Exception as exc:
            self.automation_sequence_status.configure(
                text=f"Could not import {source.name}: {exc}",
                text_color=Colors.DANGER,
            )
            return

        desired = self._safe_profile_name(str(data.get("name") or source.stem))
        target = SEQUENCE_DIR / f"{desired}.json"
        counter = 2
        while target.exists() and target.resolve() != source.resolve():
            try:
                existing = json.loads(target.read_text(encoding="utf-8"))
            except Exception:
                existing = None
            if existing == data:
                break
            target = SEQUENCE_DIR / f"{desired} {counter}.json"
            counter += 1

        try:
            if target.resolve() != source.resolve():
                target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            self.automation_sequence_status.configure(
                text=f"Could not save imported JSON into Sequence Studio storage: {exc}",
                text_color=Colors.DANGER,
            )
            return

        self.refresh_automation_sequences()
        selected = target.stem
        if selected in self._automation_profiles:
            self.automation_sequence_menu.set(selected)
            self._automation_sequence_changed(selected)
        self.automation_sequence_status.configure(
            text=f"Imported and selected {target.name}: {len(valid_steps)} replayable step(s).",
            text_color=Colors.SUCCESS,
        )
