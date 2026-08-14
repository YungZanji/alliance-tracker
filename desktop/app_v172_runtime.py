from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Iterable

import customtkinter as ctk

from app import Colors
from app_v140_runtime import CAPTURE_PURPOSES
from app_v170_runtime import BROAD_DISCOVERY_PURPOSES
from app_v171_runtime import App as BaseApp
from roster_export import (
    ROSTER_EXPORT_NAME,
    STATE_RULER_CONTEXT_NAME,
    build_roster_export,
    state_ruler_activity_context,
    write_json_export,
)
from utils import APP_DATA_DIR, SESSIONS_DIR

ROSTER_PURPOSE = "Alliance Roster Power + Activity"
STATE_RULER_PURPOSE = "State Ruler Discovery"

CAPTURE_PURPOSES[ROSTER_PURPOSE] = (
    "Export the complete alliance roster with Total Power, Arena Power, online state and exact Last Online time. "
    "While recording, open Alliance Members and the Arena Power/ranking screen once, then Stop & Export JSON."
)
CAPTURE_PURPOSES[STATE_RULER_PURPOSE] = (
    "Discover State Ruler/SVS scores plus participation context. Open Alliance Members once during the same capture so "
    "al.rank records online state and exact Last Online evidence beside the SVS score capture."
)
BROAD_DISCOVERY_PURPOSES.add(ROSTER_PURPOSE)
BROAD_DISCOVERY_PURPOSES.add(STATE_RULER_PURPOSE)


class App(BaseApp):
    """1.7.2 review: responsive Capture Studio + roster power/activity JSON export."""

    def __init__(self) -> None:
        self.roster_capture_active = False
        self.roster_capture_wait_started = 0.0
        self.roster_capture_session_id = ""
        self.latest_roster_export_path = APP_DATA_DIR / "exports" / "alliance-roster-latest.json"
        self.latest_state_ruler_context_path = APP_DATA_DIR / "exports" / "state-ruler-activity-context-latest.json"
        self._responsive_frames: dict[str, Any] = {}
        self._responsive_job: str | None = None
        super().__init__()
        self.minsize(800, 560)
        self.bind("<Configure>", self._window_resized, add="+")
        self.after(120, self._apply_responsive_layout)

    def _layout(self) -> None:
        super()._layout()
        self._add_roster_panel()
        self._prepare_responsive_widgets()

    # ---------- roster export ----------

    def _add_roster_panel(self) -> None:
        page = self.pages.get("overview")
        if not page or not hasattr(self, "poll_capture_panel"):
            return
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x", pady=(0, 14), after=self.poll_capture_panel)
        self.roster_export_panel = panel

        ctk.CTkLabel(panel, text="ALLIANCE ROSTER EXPORT", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="Export Arena Power, Total Power and Last Online for every alliance member.",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Start the roster capture, then in Last Z open Alliance Members and the Arena Power/ranking screen. "
                "Stop & Export joins al.rank and al.arena.power by UID and writes a portable JSON for future team builders. "
                "al.rank also supplies online + offLineTime for State Ruler/SVS participation context."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(0, 9))
        self.roster_start_button = ctk.CTkButton(actions, text="START ROSTER CAPTURE", height=40, fg_color=Colors.ACCENT, hover_color=Colors.ACCENT_HOVER, font=(self.font, 10, "bold"), command=self.start_roster_capture)
        self.roster_start_button.pack(side="left")
        self.roster_stop_button = ctk.CTkButton(actions, text="STOP & EXPORT JSON", height=40, fg_color=Colors.DANGER, hover_color="#D94A5B", font=(self.font, 10, "bold"), state="disabled", command=self.stop_roster_capture)
        self.roster_stop_button.pack(side="left", padx=8)
        self.roster_open_button = ctk.CTkButton(actions, text="OPEN LATEST JSON", height=40, fg_color=Colors.PANEL2, hover_color=Colors.BORDER, text_color=Colors.TEXT, font=(self.font, 9, "bold"), state="normal" if self.latest_roster_export_path.exists() else "disabled", command=self.open_latest_roster_json)
        self.roster_open_button.pack(side="right")
        self._responsive_frames["roster_actions"] = actions

        self.roster_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. JSON fields include UID, name, Total Power, Arena Power, online state and exact Last Online time.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.roster_capture_status.pack(anchor="w", padx=16, pady=(0, 13))

    def _set_roster_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "roster_capture_status"):
            self.roster_capture_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Roster Export: " + text)

    def start_roster_capture(self) -> None:
        if self.session_id or self.roster_capture_active:
            self._set_roster_status("A capture is already running. Stop it before starting the roster export.", Colors.DANGER)
            return
        self.roster_capture_session_id = ""
        self.roster_start_button.configure(state="disabled", text="ATTACHING…")
        self.roster_stop_button.configure(state="disabled")
        self._set_roster_status("Attaching to Survival.exe and preparing the roster capture…", Colors.ACCENT)
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_roster_recording()
            return
        self.attach()
        self.roster_capture_wait_started = datetime.now(timezone.utc).timestamp()
        self.after(250, self._wait_for_roster_attach)

    def _wait_for_roster_attach(self) -> None:
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_roster_recording()
            return
        if datetime.now(timezone.utc).timestamp() - self.roster_capture_wait_started >= 20:
            self.roster_start_button.configure(state="normal", text="START ROSTER CAPTURE")
            self._set_roster_status("Capture engine was not ready within 20 seconds. Confirm Last Z is in the city and try again.", Colors.DANGER)
            return
        self.after(250, self._wait_for_roster_attach)

    def _begin_roster_recording(self) -> None:
        try:
            self.capture_purpose_menu.set(ROSTER_PURPOSE)
            self._capture_purpose_changed(ROSTER_PURPOSE)
            self.capture_label_entry.delete(0, "end")
            self.capture_label_entry.insert(0, "Alliance Roster Power Activity")
            self._capture_studio_start()
            self.roster_capture_session_id = str(self.session_id or "")
            self.roster_capture_active = bool(self.roster_capture_session_id)
        except Exception as exc:
            self.roster_capture_active = False
            self.roster_start_button.configure(state="normal", text="START ROSTER CAPTURE")
            self._set_roster_status(f"Could not start roster capture: {exc}", Colors.DANGER)
            return
        if not self.roster_capture_active:
            self.roster_start_button.configure(state="normal", text="START ROSTER CAPTURE")
            self._set_roster_status("Capture did not start. Check the main capture log for details.", Colors.DANGER)
            return
        self.roster_start_button.configure(text="CAPTURING…")
        self.roster_stop_button.configure(state="normal")
        self._set_roster_status("Recording. Open Alliance Members, then the Arena Power/ranking screen, then press Stop & Export JSON.", Colors.SUCCESS)

    def stop_roster_capture(self) -> None:
        session_id = str(self.session_id or self.roster_capture_session_id or "")
        if not session_id:
            self._set_roster_status("There is no active roster capture to stop.", Colors.DANGER)
            return
        self.roster_stop_button.configure(state="disabled", text="EXPORTING…")
        try:
            self._capture_studio_stop()
            export = build_roster_export(session_id, SESSIONS_DIR, require_arena=True)
            write_json_export(export, session_id, SESSIONS_DIR, ROSTER_EXPORT_NAME, self.latest_roster_export_path)
        except Exception as exc:
            self.roster_capture_active = False
            self.roster_start_button.configure(state="normal", text="START ROSTER CAPTURE")
            self.roster_stop_button.configure(text="STOP & EXPORT JSON")
            self._set_roster_status(f"Capture stopped, but roster JSON could not be completed: {exc}", Colors.DANGER)
            return
        self.roster_capture_active = False
        self.roster_capture_session_id = session_id
        self.roster_start_button.configure(state="normal", text="START ROSTER CAPTURE")
        self.roster_stop_button.configure(text="STOP & EXPORT JSON")
        self.roster_open_button.configure(state="normal")
        member_count = int(export.get("memberCount") or 0)
        arena_count = int(export.get("arenaPowerCount") or 0)
        self._set_roster_status(
            f"JSON ready: {member_count} members, Arena Power {arena_count}/{member_count}, with Total Power + Last Online. Saved as alliance-roster-latest.json.",
            Colors.SUCCESS if arena_count == member_count else Colors.ACCENT,
        )

    def open_latest_roster_json(self) -> None:
        if not self.latest_roster_export_path.exists():
            self._set_roster_status("No roster JSON has been exported yet.", Colors.DANGER)
            return
        try:
            os.startfile(self.latest_roster_export_path)
        except Exception as exc:
            self._set_roster_status(f"Could not open the latest roster JSON: {exc}", Colors.DANGER)

    def _capture_studio_stop(self) -> None:
        session_id = str(self.session_id or self.discovery_session_id or "")
        purpose = self.capture_purpose_menu.get() if hasattr(self, "capture_purpose_menu") else ""
        super()._capture_studio_stop()
        if session_id and str(purpose) == STATE_RULER_PURPOSE:
            try:
                roster = build_roster_export(session_id, SESSIONS_DIR, require_arena=False)
                context = state_ruler_activity_context(session_id, roster)
                write_json_export(context, session_id, SESSIONS_DIR, STATE_RULER_CONTEXT_NAME, self.latest_state_ruler_context_path)
                self.write(f"State Ruler activity context: Last Online evidence captured for {context.get('memberCount', 0)} member(s).")
            except Exception as exc:
                context = state_ruler_activity_context(session_id, None, reason=str(exc))
                write_json_export(context, session_id, SESSIONS_DIR, STATE_RULER_CONTEXT_NAME, self.latest_state_ruler_context_path)
                self.write(
                    "State Ruler activity context is armed, but al.rank was not captured. Add an Alliance Members navigation step "
                    "to the future State Ruler automation so exact Last Online is recorded with the SVS session."
                )

    # ---------- responsive Capture Studio ----------

    def _prepare_responsive_widgets(self) -> None:
        if hasattr(self, "poll_start_button"):
            self._responsive_frames["poll_actions"] = self.poll_start_button.master
        if hasattr(self, "poll_select_menu"):
            self._responsive_frames["poll_review"] = self.poll_select_menu.master
        if hasattr(self, "capture_purpose_menu"):
            self._responsive_frames["capture_inputs"] = self.capture_purpose_menu.master
            actions = self._find_frame_with_button(self.capture_purpose_menu.master.master, "Start Capture")
            if actions:
                self._responsive_frames["capture_actions"] = actions
        if hasattr(self, "discovery_marker_entry"):
            self._responsive_frames["marker_row"] = self.discovery_marker_entry.master
        if hasattr(self, "discovery_marker_button"):
            presets = self._find_frame_with_button(self.discovery_marker_button.master.master, "Arena ranking")
            if presets:
                self._responsive_frames["marker_presets"] = presets
        try:
            self._responsive_frames["sidebar"] = next(iter(self.nav.values())).master
        except Exception:
            pass

        for key in ("poll_actions", "poll_review", "capture_inputs", "capture_actions", "marker_row", "marker_presets", "roster_actions"):
            frame = self._responsive_frames.get(key)
            if frame is not None:
                for child in frame.winfo_children():
                    try:
                        child.pack_forget()
                    except Exception:
                        pass
        self._apply_responsive_layout()

    def _window_resized(self, event: Any) -> None:
        if event.widget is not self:
            return
        if self._responsive_job:
            try:
                self.after_cancel(self._responsive_job)
            except Exception:
                pass
        self._responsive_job = self.after(45, self._apply_responsive_layout)

    def _apply_responsive_layout(self) -> None:
        self._responsive_job = None
        width = max(800, int(self.winfo_width() or 800))
        compact = width < 1120
        narrow = width < 900
        sidebar_width = 178 if not compact else (158 if not narrow else 150)
        page_pad = 25 if not compact else (16 if not narrow else 10)

        for page in self.pages.values():
            try:
                page.grid_configure(padx=page_pad, pady=16 if compact else 21)
            except Exception:
                pass
        sidebar = self._responsive_frames.get("sidebar")
        if sidebar is not None:
            try:
                sidebar.configure(width=sidebar_width)
            except Exception:
                pass

        content_width = max(420, width - sidebar_width - (page_pad * 2) - 30)
        wrap = min(820, max(250, content_width - 55))
        for page in self.pages.values():
            self._set_wraplengths(page, wrap)
        self._set_wraplengths(sidebar, max(100, sidebar_width - 24), only_existing=True)

        self._layout_status_cards(2 if compact else 4)
        self._grid_buttons(self._responsive_frames.get("poll_actions"), [getattr(self, "poll_start_button", None), getattr(self, "poll_stop_button", None), getattr(self, "poll_import_button", None), getattr(self, "poll_sync_button", None)], 2 if compact else 4)
        self._grid_buttons(self._responsive_frames.get("roster_actions"), [getattr(self, "roster_start_button", None), getattr(self, "roster_stop_button", None), getattr(self, "roster_open_button", None)], 2 if compact else 3)
        self._layout_poll_review(narrow)
        self._layout_capture_inputs(narrow)
        self._layout_capture_actions(2 if compact else 4)
        self._layout_marker_row(narrow)
        self._layout_marker_presets(3 if compact else 6)

    def _layout_status_cards(self, columns: int) -> None:
        cards = [getattr(self, name, None) for name in ("game", "recording", "count", "cloud_card")]
        cards = [card for card in cards if card is not None]
        if not cards:
            return
        parent = cards[0].master
        for column in range(4):
            parent.grid_columnconfigure(column, weight=1 if column < columns else 0)
        for index, card in enumerate(cards):
            card.grid_forget()
            row, column = divmod(index, columns)
            card.grid(row=row, column=column, sticky="ew", padx=5, pady=5)

    def _layout_poll_review(self, narrow: bool) -> None:
        frame = self._responsive_frames.get("poll_review")
        if frame is None or not hasattr(self, "poll_select_menu"):
            return
        label = next((child for child in frame.winfo_children() if isinstance(child, ctk.CTkLabel)), None)
        if label:
            label.grid_forget()
        self.poll_select_menu.grid_forget()
        frame.grid_columnconfigure(0, weight=1 if narrow else 0)
        frame.grid_columnconfigure(1, weight=0 if narrow else 1)
        if narrow:
            if label:
                label.grid(row=0, column=0, sticky="w", pady=(0, 5))
            self.poll_select_menu.grid(row=1, column=0, sticky="ew")
        else:
            if label:
                label.grid(row=0, column=0, sticky="w")
            self.poll_select_menu.grid(row=0, column=1, sticky="ew", padx=(12, 0))

    def _layout_capture_inputs(self, narrow: bool) -> None:
        frame = self._responsive_frames.get("capture_inputs")
        if frame is None or not hasattr(self, "capture_purpose_menu"):
            return
        self.capture_purpose_menu.grid_forget()
        self.capture_label_entry.grid_forget()
        frame.grid_columnconfigure(0, weight=1 if narrow else 0)
        frame.grid_columnconfigure(1, weight=0 if narrow else 1)
        if narrow:
            self.capture_purpose_menu.grid(row=0, column=0, sticky="ew")
            self.capture_label_entry.grid(row=1, column=0, sticky="ew", pady=(7, 0))
        else:
            self.capture_purpose_menu.grid(row=0, column=0, sticky="ew")
            self.capture_label_entry.grid(row=0, column=1, sticky="ew", padx=(8, 0))

    def _layout_capture_actions(self, columns: int) -> None:
        frame = self._responsive_frames.get("capture_actions")
        if frame is None:
            return
        order = {"Attach": 0, "Start Capture": 1, "Stop & Package": 2, "Open Data Folder": 3}
        buttons = [child for child in frame.winfo_children() if isinstance(child, ctk.CTkButton)]
        buttons.sort(key=lambda button: order.get(str(button.cget("text")), 99))
        self._grid_buttons(frame, buttons, columns)

    def _layout_marker_row(self, narrow: bool) -> None:
        frame = self._responsive_frames.get("marker_row")
        if frame is None or not hasattr(self, "discovery_marker_entry"):
            return
        self.discovery_marker_entry.grid_forget()
        self.discovery_marker_button.grid_forget()
        frame.grid_columnconfigure(0, weight=1)
        frame.grid_columnconfigure(1, weight=0)
        self.discovery_marker_entry.grid(row=0, column=0, sticky="ew")
        if narrow:
            self.discovery_marker_button.grid(row=1, column=0, sticky="ew", pady=(7, 0))
        else:
            self.discovery_marker_button.grid(row=0, column=1, padx=(8, 0))

    def _layout_marker_presets(self, columns: int) -> None:
        frame = self._responsive_frames.get("marker_presets")
        if frame is None:
            return
        label = next((child for child in frame.winfo_children() if isinstance(child, ctk.CTkLabel)), None)
        buttons = [child for child in frame.winfo_children() if isinstance(child, ctk.CTkButton)]
        for child in frame.winfo_children():
            child.grid_forget()
        for column in range(6):
            frame.grid_columnconfigure(column, weight=1 if column < columns else 0)
        start_row = 0
        if label:
            label.grid(row=0, column=0, columnspan=columns, sticky="w", pady=(0, 4))
            start_row = 1
        for index, button in enumerate(buttons):
            row, column = divmod(index, columns)
            button.configure(width=80)
            button.grid(row=start_row + row, column=column, sticky="ew", padx=3, pady=3)

    @staticmethod
    def _grid_buttons(frame: Any, buttons: Iterable[Any], columns: int) -> None:
        if frame is None:
            return
        active = [button for button in buttons if button is not None]
        for button in active:
            button.grid_forget()
        for column in range(6):
            frame.grid_columnconfigure(column, weight=1 if column < columns else 0)
        for index, button in enumerate(active):
            row, column = divmod(index, columns)
            button.configure(width=90)
            button.grid(row=row, column=column, sticky="ew", padx=4, pady=4)

    @staticmethod
    def _find_frame_with_button(parent: Any, text: str) -> Any | None:
        for child in parent.winfo_children():
            if not isinstance(child, ctk.CTkFrame):
                continue
            for grandchild in child.winfo_children():
                if isinstance(grandchild, ctk.CTkButton) and str(grandchild.cget("text")) == text:
                    return child
        return None

    def _set_wraplengths(self, root: Any, wrap: int, only_existing: bool = False) -> None:
        if root is None:
            return
        stack = list(root.winfo_children())
        while stack:
            child = stack.pop()
            try:
                stack.extend(child.winfo_children())
            except Exception:
                pass
            if not isinstance(child, ctk.CTkLabel):
                continue
            try:
                current = int(float(child.cget("wraplength") or 0))
                text = str(child.cget("text") or "")
                if current > 0 or (not only_existing and len(text) >= 34):
                    child.configure(wraplength=wrap, justify="left")
            except Exception:
                pass
