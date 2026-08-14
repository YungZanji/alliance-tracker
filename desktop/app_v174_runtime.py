from __future__ import annotations

import os
from typing import Any, Iterable

import customtkinter as ctk

from app import App as RootApp, Colors
from app_v100 import SEQUENCE_DIR
from app_v140_runtime import CAPTURE_PURPOSES
from app_v170_runtime import FULL_DISCOVERY_PURPOSE
from app_v172_runtime import App as BaseApp
from utils import APP_DATA_DIR


class App(BaseApp):
    """1.7.4 review: replace the oversized Capture Studio with dedicated functional tabs."""

    def page(self, key: str, title: str, subtitle: str) -> Any:
        # Deliberately bypass the 1.7.1 Capture-Studio-only CTkScrollableFrame.
        # Every top-level page is a normal fixed viewport again. Pages that truly
        # need dynamic scrolling (Sequence Studio's growing step list, Sessions,
        # etc.) retain their own proven local scroll surfaces.
        return RootApp.page(self, key, title, subtitle)

    # The 1.7.2 resize pass re-gridded widgets inside one giant page. Dedicated
    # pages make those mutations unnecessary and avoid another canvas/scrollregion
    # dependency entirely.
    def _prepare_responsive_widgets(self) -> None:
        self._responsive_frames = {}

    def _apply_responsive_layout(self) -> None:
        return

    def _layout(self) -> None:
        super()._layout()
        self._split_capture_workspace()
        self._split_sequence_workspace()
        self._rebuild_sidebar()

    # ------------------------------------------------------------------
    # Generic helpers
    # ------------------------------------------------------------------

    def _walk(self, root: Any) -> Iterable[Any]:
        stack = list(root.winfo_children()) if root is not None else []
        while stack:
            widget = stack.pop()
            yield widget
            try:
                stack.extend(widget.winfo_children())
            except Exception:
                pass

    def _find_top_panel_by_text(self, page: Any, text: str) -> Any | None:
        if page is None:
            return None
        for child in page.winfo_children():
            candidates = [child, *list(self._walk(child))]
            for widget in candidates:
                if not isinstance(widget, ctk.CTkLabel):
                    continue
                try:
                    if str(widget.cget("text") or "").strip() == text:
                        return child
                except Exception:
                    continue
        return None

    def _hide_panel(self, page: Any, text: str) -> None:
        panel = self._find_top_panel_by_text(page, text)
        if panel is None:
            return
        try:
            panel.pack_forget()
        except Exception:
            try:
                panel.grid_remove()
            except Exception:
                pass

    def _page_heading(self, page: Any, title: str, subtitle: str) -> None:
        direct_labels = [child for child in page.winfo_children() if isinstance(child, ctk.CTkLabel)]
        if direct_labels:
            direct_labels[0].configure(text=title)
        if len(direct_labels) > 1:
            direct_labels[1].configure(text=subtitle, wraplength=850, justify="left")

    @staticmethod
    def _grid_action_buttons(frame: Any, buttons: list[Any], columns: int = 2) -> None:
        for column in range(columns):
            frame.grid_columnconfigure(column, weight=1)
        for index, button in enumerate(buttons):
            row, column = divmod(index, columns)
            button.grid(row=row, column=column, sticky="ew", padx=4, pady=4)

    def _new_nav_button(self, side: Any, key: str, label: str) -> Any:
        button = ctk.CTkButton(
            side,
            text=label,
            anchor="w",
            height=32,
            corner_radius=9,
            fg_color="transparent",
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 10, "bold"),
            command=lambda k=key: self.show(k),
        )
        self.nav[key] = button
        return button

    # ------------------------------------------------------------------
    # Capture family: one purpose per page
    # ------------------------------------------------------------------

    def _split_capture_workspace(self) -> None:
        overview = self.pages.get("overview")
        if overview is None:
            return

        self._page_heading(
            overview,
            "Capture",
            "Attach to Last Z and run a general structured-data capture. Polls, roster extraction and discovery now have dedicated tabs.",
        )

        # Remove every specialist section from the old all-in-one page. The
        # underlying methods remain inherited; only their UI surface is replaced.
        for heading in (
            "Event Discovery",
            "ALLIANCE POLL CAPTURE",
            "ALLIANCE ROSTER EXPORT",
            "FULL DATA DISCOVERY",
            "CAPTURE WORKSPACE",
        ):
            self._hide_panel(overview, heading)

        self._build_compact_capture_panel(overview)
        self._build_polls_page()
        self._build_roster_page()
        self._build_discovery_page()

    def _build_compact_capture_panel(self, page: Any) -> None:
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        kwargs: dict[str, Any] = {"fill": "x", "pady": (13, 13)}
        if hasattr(self, "overview_log"):
            kwargs["before"] = self.overview_log
        panel.pack(**kwargs)

        ctk.CTkLabel(panel, text="CAPTURE SESSION", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="General capture workspace",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Choose a capture purpose and session label. Specialist workflows can also be started from their own tabs on the left.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 9))

        self.capture_purpose_menu = ctk.CTkOptionMenu(
            panel,
            values=list(CAPTURE_PURPOSES),
            height=36,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
            command=self._capture_purpose_changed,
        )
        saved = str(self.config.values.get("capturePurpose") or "Alliance Duel Discovery")
        if saved not in CAPTURE_PURPOSES:
            saved = "Alliance Duel Discovery"
        self.capture_purpose_menu.set(saved)
        self.capture_purpose_menu.pack(fill="x", padx=16, pady=(0, 7))

        self.capture_label_entry = ctk.CTkEntry(
            panel,
            height=36,
            placeholder_text="Session label",
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 9),
        )
        self.capture_label_entry.pack(fill="x", padx=16)

        self.capture_purpose_help = ctk.CTkLabel(
            panel,
            text=CAPTURE_PURPOSES.get(saved, ""),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.capture_purpose_help.pack(anchor="w", padx=16, pady=(6, 6))

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(0, 12))
        buttons = [
            ctk.CTkButton(actions, text="ATTACH", height=36, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self._capture_studio_attach),
            ctk.CTkButton(actions, text="START CAPTURE", height=36, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 9, "bold"), command=self._capture_studio_start),
            ctk.CTkButton(actions, text="STOP & PACKAGE", height=36, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 9, "bold"), command=self._capture_studio_stop),
            ctk.CTkButton(actions, text="OPEN DATA FOLDER", height=36, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, text_color=Colors.MUTED, font=(self.font, 9, "bold"), command=lambda: os.startfile(APP_DATA_DIR)),
        ]
        self._grid_action_buttons(actions, buttons, 2)

    def _build_polls_page(self) -> None:
        page = self.page(
            "polls",
            "Alliance Polls",
            "Capture, review, import and explicitly archive Alliance poll data without mixing it into other capture workflows.",
        )
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="both", expand=True)
        self.poll_capture_panel = panel

        ctk.CTkLabel(panel, text="POLL CAPTURE", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="Capture and review one Alliance poll", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Start capture, open Alliance chat > notices and the desired poll in Last Z, then Stop & Review. Nothing is uploaded until Sync Selected Poll is pressed.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(0, 7))
        self.poll_start_button = ctk.CTkButton(actions, text="START POLL CAPTURE", height=38, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 9, "bold"), command=self.start_poll_capture)
        self.poll_stop_button = ctk.CTkButton(actions, text="STOP & REVIEW", height=38, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 9, "bold"), state="disabled", command=self.stop_poll_capture)
        self.poll_import_button = ctk.CTkButton(actions, text="IMPORT POLL ZIP", height=38, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self.import_poll_zip)
        self.poll_sync_button = ctk.CTkButton(actions, text="SYNC SELECTED POLL", height=38, fg_color=Colors.SUCCESS, hover_color="#24B984", text_color="#07111F", font=(self.font, 9, "bold"), state="disabled", command=self.sync_selected_poll)
        self._grid_action_buttons(actions, [self.poll_start_button, self.poll_stop_button, self.poll_import_button, self.poll_sync_button], 2)

        self.poll_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. Last Z may already be open or you can open it before starting.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.poll_capture_status.pack(anchor="w", padx=16, pady=(3, 8))

        review = ctk.CTkFrame(panel, fg_color=Colors.PANEL2, corner_radius=12)
        review.pack(fill="x", padx=16, pady=(0, 14))
        ctk.CTkLabel(review, text="Decoded poll", text_color=Colors.MUTED, font=(self.font, 9, "bold")).pack(anchor="w", padx=12, pady=(11, 5))
        self.poll_select_menu = ctk.CTkComboBox(
            review,
            values=["No poll decoded yet"],
            height=34,
            fg_color=Colors.PANEL,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
            state="disabled",
            command=self._poll_selection_changed,
        )
        self.poll_select_menu.pack(fill="x", padx=12)
        self.poll_review_text = ctk.CTkLabel(
            review,
            text="Open a poll during capture. The review will show the question, options and decoded voter count before anything is uploaded.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=790,
            justify="left",
        )
        self.poll_review_text.pack(anchor="w", padx=12, pady=(7, 12))

    def _build_roster_page(self) -> None:
        page = self.page(
            "roster_export",
            "Alliance Roster Export",
            "Create a reusable JSON containing Arena Power, Total Power and Last Online for the full alliance roster.",
        )
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        self.roster_export_panel = panel

        ctk.CTkLabel(panel, text="POWER + ACTIVITY", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="Export the complete alliance roster", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Start Roster Capture, open Alliance Members once, then open the Arena Power/ranking screen once. Stop & Export joins al.rank and al.arena.power by UID.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(0, 8))
        self.roster_start_button = ctk.CTkButton(actions, text="START ROSTER CAPTURE", height=39, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 9, "bold"), command=self.start_roster_capture)
        self.roster_stop_button = ctk.CTkButton(actions, text="STOP & EXPORT JSON", height=39, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 9, "bold"), state="disabled", command=self.stop_roster_capture)
        self.roster_open_button = ctk.CTkButton(actions, text="OPEN LATEST JSON", height=39, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), state="normal" if self.latest_roster_export_path.exists() else "disabled", command=self.open_latest_roster_json)
        self._grid_action_buttons(actions, [self.roster_start_button, self.roster_stop_button, self.roster_open_button], 2)

        self.roster_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. Output includes UID, Total Power, Arena Power, power ranks, online state and exact Last Online time.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.roster_capture_status.pack(anchor="w", padx=16, pady=(3, 14))

        fields = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        fields.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(fields, text="Portable JSON contract", text_color=Colors.TEXT, font=(self.font, 14, "bold")).pack(anchor="w", padx=16, pady=(13, 4))
        ctk.CTkLabel(
            fields,
            text="uid · name · totalPower · arenaPower · totalPowerRank · arenaPowerRank · online · lastOnlineAtUtc · offlineForSecondsAtCapture · cityLevel · allianceRank · armyKills",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(0, 13))

    def _build_discovery_page(self) -> None:
        page = self.page(
            "discovery",
            "Discovery",
            "Use broad decoded-response capture for unknown screens, State Ruler/SVS training and future event datasets.",
        )

        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        ctk.CTkLabel(panel, text="FULL DATA DISCOVERY", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="Teach the tracker an unknown screen", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Choose a discovery purpose, start recording, navigate manually in Last Z and add markers immediately before the important screen opens.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 9))

        discovery_values = [
            value for value in (
                FULL_DISCOVERY_PURPOSE,
                "Arena Power + Last Online",
                "Total Power + Last Online",
                "State Ruler Discovery",
                "Glory War Discovery",
            ) if value in CAPTURE_PURPOSES
        ]
        self.discovery_tab_purpose = ctk.CTkOptionMenu(
            panel,
            values=discovery_values,
            height=36,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        self.discovery_tab_purpose.set(discovery_values[0] if discovery_values else FULL_DISCOVERY_PURPOSE)
        self.discovery_tab_purpose.pack(fill="x", padx=16, pady=(0, 7))
        self.discovery_tab_label = ctk.CTkEntry(panel, height=36, placeholder_text="Discovery session label", fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 9))
        self.discovery_tab_label.pack(fill="x", padx=16)

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(7, 7))
        buttons = [
            ctk.CTkButton(actions, text="ATTACH", height=36, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self._capture_studio_attach),
            ctk.CTkButton(actions, text="START DISCOVERY", height=36, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 9, "bold"), command=self._start_discovery_tab_capture),
            ctk.CTkButton(actions, text="STOP & PACKAGE", height=36, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 9, "bold"), command=self._capture_studio_stop),
            ctk.CTkButton(actions, text="OPEN DATA FOLDER", height=36, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, text_color=Colors.MUTED, font=(self.font, 9, "bold"), command=lambda: os.startfile(APP_DATA_DIR)),
        ]
        self._grid_action_buttons(actions, buttons, 2)

        marker = ctk.CTkFrame(panel, fg_color=Colors.PANEL2, corner_radius=12)
        marker.pack(fill="x", padx=16, pady=(0, 14))
        ctk.CTkLabel(marker, text="Timeline marker", text_color=Colors.MUTED, font=(self.font, 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        self.discovery_marker_entry = ctk.CTkEntry(marker, height=34, placeholder_text="Example: Opened Alliance Members", fg_color=Colors.PANEL, border_color=Colors.BORDER, font=(self.font, 9))
        self.discovery_marker_entry.pack(fill="x", padx=12)
        self.discovery_marker_button = ctk.CTkButton(marker, text="ADD MARKER", height=32, fg_color=Colors.PANEL, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), command=self.add_discovery_marker)
        self.discovery_marker_button.pack(fill="x", padx=12, pady=(6, 8))

        quick = ctk.CTkFrame(marker, fg_color="transparent")
        quick.pack(fill="x", padx=9, pady=(0, 8))
        for column in range(3):
            quick.grid_columnconfigure(column, weight=1)
        for index, text in enumerate(("Arena ranking", "Alliance members", "Player profile", "Total power", "Last online")):
            row, column = divmod(index, 3)
            ctk.CTkButton(
                quick,
                text=text,
                height=28,
                fg_color="transparent",
                border_width=1,
                border_color=Colors.BORDER,
                hover_color=Colors.PANEL,
                text_color=Colors.MUTED,
                font=(self.font, 8, "bold"),
                command=lambda value=text: self.add_discovery_marker(value),
            ).grid(row=row, column=column, sticky="ew", padx=3, pady=3)

        self.discovery_status = ctk.CTkLabel(
            page,
            text="Broad discovery is off. State Ruler captures should also open Alliance Members once so Last Online evidence is preserved.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.discovery_status.pack(anchor="w", pady=(10, 0))

    def _start_discovery_tab_capture(self) -> None:
        purpose = str(self.discovery_tab_purpose.get() or FULL_DISCOVERY_PURPOSE)
        label = self.discovery_tab_label.get().strip() or purpose
        self.capture_purpose_menu.set(purpose)
        self._capture_purpose_changed(purpose)
        self.capture_label_entry.delete(0, "end")
        self.capture_label_entry.insert(0, label)
        self._capture_studio_start()

    # ------------------------------------------------------------------
    # Sequence family: recorder, profiles and SVS inspector separated
    # ------------------------------------------------------------------

    def _split_sequence_workspace(self) -> None:
        sequence_page = self.pages.get("sequence_studio")
        if sequence_page is None:
            return
        self._page_heading(
            sequence_page,
            "Sequence Studio",
            "Record, edit and replay Last Z control paths. Saved sequence management and the SVS diagnostic inspector now have their own tabs.",
        )
        self._hide_panel(sequence_page, "Saved sequences")
        self._hide_panel(sequence_page, "State Ruler / SVS capture inspector")
        self._build_sequence_profiles_page()
        self._build_svs_inspector_page()

    def _build_sequence_profiles_page(self) -> None:
        page = self.page(
            "sequence_profiles",
            "Saved Sequences",
            "Save the current Sequence Studio path locally or load an existing control-sequence JSON for editing and replay.",
        )
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")
        ctk.CTkLabel(panel, text="SEQUENCE LIBRARY", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="Save or load a recorded path", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Loaded sequences immediately appear back in Sequence Studio, where you can reorder steps, replay them or save a revised version.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        self.sequence_name_entry = ctk.CTkEntry(panel, placeholder_text="Example: State Ruler participation path", height=38, fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 10))
        self.sequence_name_entry.pack(fill="x", padx=16)
        ctk.CTkButton(panel, text="SAVE CURRENT SEQUENCE", height=38, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 10, "bold"), command=self.save_sequence_profile).pack(fill="x", padx=16, pady=(7, 12))

        self.sequence_profile_menu = ctk.CTkComboBox(
            panel,
            values=["No saved sequences"],
            height=36,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
        )
        self.sequence_profile_menu.pack(fill="x", padx=16)
        ctk.CTkButton(panel, text="LOAD SELECTED SEQUENCE", height=36, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 10, "bold"), command=self.load_sequence_profile).pack(fill="x", padx=16, pady=(7, 8))
        ctk.CTkButton(panel, text="OPEN SEQUENCE FOLDER", height=34, fg_color="transparent", border_width=1, border_color=Colors.BORDER, hover_color=Colors.PANEL2, text_color=Colors.MUTED, font=(self.font, 9, "bold"), command=lambda: os.startfile(SEQUENCE_DIR)).pack(fill="x", padx=16, pady=(0, 8))

        self.sequence_profile_status = ctk.CTkLabel(
            panel,
            text="Sequences are stored locally; the active sequence is also written into the current capture ZIP.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.sequence_profile_status.pack(anchor="w", padx=16, pady=(0, 14))
        self._refresh_sequence_profiles()

    def _build_svs_inspector_page(self) -> None:
        page = self.page(
            "svs_inspector",
            "SVS Inspector",
            "Inspect the State Ruler / SVS responses decoded in the current session before promoting a sequence into Auto Sync.",
        )
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="both", expand=True)
        ctk.CTkLabel(panel, text="STATE RULER / SVS", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="Capture inspector", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text="Diagnostic only. A returned top-100 ranking is never treated as the complete participation roster. For future SVS automation, capture Alliance Members in the same session so Last Online is available as participation context.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))
        self.sequence_event_summary = ctk.CTkTextbox(
            panel,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 10),
        )
        self.sequence_event_summary.pack(fill="both", expand=True, padx=16, pady=(0, 14))
        self.sequence_event_summary.insert("1.0", "No State Ruler/SVS score payload has been decoded in this session yet.\n")
        self.sequence_event_summary.configure(state="disabled")

    # ------------------------------------------------------------------
    # Sidebar organization
    # ------------------------------------------------------------------

    def _rebuild_sidebar(self) -> None:
        if not self.nav:
            return
        side = next(iter(self.nav.values())).master
        try:
            side.configure(width=188)
            side.grid_propagate(False)
        except Exception:
            pass

        # Remove every inherited button from its previous row. Hidden internal
        # pages (legacy Capture workspace) remain available to the code but are not
        # presented as duplicate user-facing destinations.
        for button in self.nav.values():
            try:
                button.grid_remove()
            except Exception:
                pass

        labels = {
            "overview": "Capture",
            "polls": "Polls",
            "roster_export": "Roster Export",
            "discovery": "Discovery",
            "sessions": "Sessions",
            "sequence_studio": "Sequence Studio",
            "sequence_profiles": "Saved Sequences",
            "svs_inspector": "SVS Inspector",
            "replay": "Replay Test",
            "duel_auto": "Auto Sync",
            "cloud": "Cloud Sync",
            "settings": "Settings",
        }
        order = list(labels)
        for key in order:
            if key not in self.pages:
                continue
            button = self.nav.get(key)
            if button is None:
                button = self._new_nav_button(side, key, labels[key])
            else:
                button.configure(
                    text=labels[key],
                    anchor="w",
                    height=32,
                    corner_radius=9,
                    font=(self.font, 10, "bold"),
                    command=lambda k=key: self.show(k),
                )

        # The old brand block used large vertical spacing intended for five tabs.
        # Tighten it enough that all dedicated categories remain visible even in a
        # moderately short window without making the sidebar itself scroll.
        for child in side.winfo_children():
            try:
                info = child.grid_info()
                if int(info.get("row", -1)) == 0:
                    child.grid_configure(padx=15, pady=(14, 10))
            except Exception:
                pass

        for row in range(1, 30):
            try:
                side.grid_rowconfigure(row, weight=0)
            except Exception:
                pass

        visible_row = 1
        for key in order:
            button = self.nav.get(key)
            if key not in self.pages or button is None:
                continue
            button.grid(row=visible_row, column=0, sticky="ew", padx=9, pady=1)
            visible_row += 1

        try:
            side.grid_rowconfigure(visible_row, weight=1)
        except Exception:
            pass
