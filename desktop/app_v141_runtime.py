from __future__ import annotations

import customtkinter as ctk

from app import Colors
from app_v130_runtime import DEFAULT_WEEKDAY_SEQUENCE
from app_v140_runtime import EVENT_ORDER, EVENTS
from app_v140_runtime_fix import App as BaseApp


class App(BaseApp):
    """1.4.1 review: one continuous Auto Sync scroll surface + vote discovery capture."""

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

        # Remove the legacy long Duel surface before building the 1.4.1 workspace.
        for child in list(page.winfo_children())[2:]:
            try:
                child.pack_forget()
                child.grid_forget()
            except Exception:
                pass

        # 1.4.1 intentionally uses one scroll container for the whole workspace.
        # Today's plan remains first, but nothing below it is trapped in a second
        # independently scrolling/fixed region.
        root = ctk.CTkScrollableFrame(
            page,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=Colors.BORDER,
            scrollbar_button_hover_color=Colors.ACCENT,
        )
        root.pack(fill="both", expand=True, pady=(6, 0))
        self.auto_sync_scroll = root

        today = ctk.CTkFrame(
            root,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        today.pack(fill="x", padx=(0, 6), pady=(0, 12))
        top = ctk.CTkFrame(today, fg_color="transparent")
        top.pack(fill="x", padx=15, pady=(13, 5))
        ctk.CTkLabel(
            top,
            text="TODAY'S SYNC PLAN",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(side="left")
        self.today_plan_title = ctk.CTkLabel(
            top,
            text="Loading…",
            text_color=Colors.TEXT,
            font=(self.font, 16, "bold"),
        )
        self.today_plan_title.pack(side="right")
        self.today_plan_summary = ctk.CTkLabel(
            today,
            text="",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.today_plan_summary.pack(anchor="w", padx=15, pady=(0, 8))
        self.auto_run_button = ctk.CTkButton(
            today,
            text="RUN TODAY'S SYNC PLAN",
            height=48,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 12, "bold"),
            command=self.run_today_sync_plan,
        )
        self.auto_run_button.pack(fill="x", padx=15, pady=(0, 7))
        self.auto_progress_bar = ctk.CTkProgressBar(
            today,
            height=8,
            progress_color=Colors.ACCENT,
            fg_color=Colors.PANEL2,
        )
        self.auto_progress_bar.pack(fill="x", padx=15, pady=(0, 5))
        self.auto_progress_bar.set(0)
        self.auto_progress_text = ctk.CTkLabel(
            today,
            text="Ready.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.auto_progress_text.pack(anchor="w", padx=15, pady=(0, 12))

        tabs = ctk.CTkTabview(
            root,
            height=520,
            fg_color=Colors.PANEL,
            segmented_button_fg_color=Colors.PANEL2,
            segmented_button_selected_color=Colors.ACCENT,
            segmented_button_selected_hover_color=Colors.ACCENT_HOVER,
            corner_radius=14,
        )
        tabs.pack(fill="x", padx=(0, 6), pady=(0, 12))
        self.auto_sync_tabs = tabs
        for event_type in EVENT_ORDER:
            label = EVENTS[event_type]
            tab = tabs.add(f"{label} Sync")
            self._build_event_profile_tab(tab, event_type)

        manual = ctk.CTkFrame(
            root,
            fg_color=Colors.PANEL,
            corner_radius=12,
            border_width=1,
            border_color=Colors.BORDER,
        )
        manual.pack(fill="x", padx=(0, 6), pady=(0, 18))
        ctk.CTkLabel(
            manual,
            text="Manual sequence",
            text_color=Colors.MUTED,
            font=(self.font, 9, "bold"),
        ).pack(anchor="w", padx=13, pady=(11, 5))
        manual_row = ctk.CTkFrame(manual, fg_color="transparent")
        manual_row.pack(fill="x", padx=13, pady=(0, 12))
        self.auto_manual_sequence_menu = ctk.CTkComboBox(
            manual_row,
            values=list(self._automation_profiles) or [DEFAULT_WEEKDAY_SEQUENCE],
            height=34,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
        )
        self.auto_manual_sequence_menu.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            manual_row,
            text="Run selected JSON",
            height=34,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.run_auto_manual_sequence,
        ).pack(side="left", padx=(9, 0))
