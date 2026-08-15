from __future__ import annotations

import queue
import time
from typing import Any

import customtkinter as ctk
from tkinter import messagebox

from app import APP_NAME, Colors
from app_current import App as BaseApp
from app_v140_runtime import CAPTURE_PURPOSES
from app_v170_runtime import BROAD_DISCOVERY_PURPOSES
from roster_export import build_roster_export
from svs_capture import SVS_PURPOSE, build_svs_snapshots, save_snapshot
from utils import SESSIONS_DIR, utc_now


CAPTURE_PURPOSES[SVS_PURPOSE] = (
    "Capture the SVS personal score leaderboard and Alliance Members in one session. "
    "Real leaderboard scores stay authoritative; members seen online since 7:00 a.m. Pacific receive participation evidence."
)
BROAD_DISCOVERY_PURPOSES.add(SVS_PURPOSE)


class App(BaseApp):
    def __init__(self) -> None:
        self.svs_capture_active = False
        self.svs_capture_session_id = ""
        self.svs_capture_wait_started = 0.0
        self.svs_sync_waiting = False
        super().__init__()

    def _build_svs_inspector_page(self) -> None:
        page = self.page(
            "svs_inspector",
            "SVS Capture",
            "Capture SVS scores and same-session roster activity, then send both to the State Ruler leaderboard.",
        )
        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x")

        ctk.CTkLabel(
            panel,
            text="SVS PARTICIPATION + SCORE",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="One manual capture for scores and participation",
            text_color=Colors.TEXT,
            font=(self.font, 18, "bold"),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Start capture, open the SVS Personal/High Score leaderboard, then open Alliance Members. "
                "When you stop, real leaderboard scores are kept as-is. Members without a score are counted for "
                "participation only when Last Seen falls between 7:00 a.m. Pacific and the roster capture time."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        steps = ctk.CTkFrame(panel, fg_color=Colors.PANEL2, corner_radius=12)
        steps.pack(fill="x", padx=16, pady=(0, 10))
        ctk.CTkLabel(
            steps,
            text=(
                "1. Start SVS Capture\n"
                "2. Open SVS → Personal/High Score ranking\n"
                "3. Open Alliance → Alliance Members\n"
                "4. Stop, Build & Sync"
            ),
            text_color=Colors.TEXT,
            font=(self.font, 10),
            justify="left",
        ).pack(anchor="w", padx=12, pady=10)

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(0, 7))
        actions.grid_columnconfigure((0, 1), weight=1)
        self.svs_start_button = ctk.CTkButton(
            actions,
            text="START SVS CAPTURE",
            height=39,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9, "bold"),
            command=self.start_svs_capture,
        )
        self.svs_start_button.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.svs_stop_button = ctk.CTkButton(
            actions,
            text="STOP, BUILD & SYNC",
            height=39,
            fg_color=Colors.SUCCESS,
            hover_color="#24B984",
            text_color="#07111F",
            font=(self.font, 9, "bold"),
            state="disabled",
            command=self.stop_svs_capture,
        )
        self.svs_stop_button.grid(row=0, column=1, sticky="ew", padx=4, pady=4)

        self.svs_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. The cutoff is 7:00 a.m. Pacific on the day of the roster scan.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.svs_capture_status.pack(anchor="w", padx=16, pady=(2, 14))

        inspect = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        inspect.pack(fill="both", expand=True, pady=(12, 0))
        ctk.CTkLabel(
            inspect,
            text="CAPTURE SUMMARY",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 5))
        self.sequence_event_summary = ctk.CTkTextbox(
            inspect,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 10),
        )
        self.sequence_event_summary.pack(fill="both", expand=True, padx=16, pady=(0, 14))
        self._set_svs_summary(
            "No SVS capture has been completed in this session yet.\n"
            "The game navigation is manual; this page only records and combines the responses."
        )

    def _rebuild_sidebar(self) -> None:
        super()._rebuild_sidebar()
        button = self.nav.get("svs_inspector")
        if button is not None:
            button.configure(text="SVS Capture")

    def _set_svs_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "svs_capture_status"):
            self.svs_capture_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("SVS Capture: " + text)

    def _set_svs_summary(self, text: str) -> None:
        if not hasattr(self, "sequence_event_summary"):
            return
        self.sequence_event_summary.configure(state="normal")
        self.sequence_event_summary.delete("1.0", "end")
        self.sequence_event_summary.insert("1.0", text.rstrip() + "\n")
        self.sequence_event_summary.configure(state="disabled")

    def start_svs_capture(self) -> None:
        if self.session_id or self.svs_capture_active:
            self._set_svs_status("Another capture is already running. Stop it before starting SVS.", Colors.DANGER)
            return

        self.svs_capture_session_id = ""
        self.svs_start_button.configure(state="disabled", text="ATTACHING…")
        self.svs_stop_button.configure(state="disabled")
        self._set_svs_status("Preparing the capture engine…", Colors.ACCENT)

        if self.capture.state.ready and self.capture.state.attached:
            self._begin_svs_recording()
            return

        self.attach()
        self.svs_capture_wait_started = time.monotonic()
        self.after(250, self._wait_for_svs_attach)

    def _wait_for_svs_attach(self) -> None:
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_svs_recording()
            return
        if time.monotonic() - self.svs_capture_wait_started >= 20.0:
            self.svs_start_button.configure(state="normal", text="START SVS CAPTURE")
            self._set_svs_status(
                "Capture engine was not ready within 20 seconds. Confirm Last Z is in the city and try again.",
                Colors.DANGER,
            )
            return
        self.after(250, self._wait_for_svs_attach)

    def _begin_svs_recording(self) -> None:
        try:
            self.capture_purpose_menu.set(SVS_PURPOSE)
            self._capture_purpose_changed(SVS_PURPOSE)
            self.capture_label_entry.delete(0, "end")
            self.capture_label_entry.insert(0, "SVS Participation Score Capture")
            self._capture_studio_start()
            self.svs_capture_session_id = str(self.session_id or "")
            self.svs_capture_active = bool(self.svs_capture_session_id)
        except Exception as exc:
            self.svs_capture_active = False
            self.svs_start_button.configure(state="normal", text="START SVS CAPTURE")
            self._set_svs_status(f"Could not start SVS capture: {exc}", Colors.DANGER)
            return

        if not self.svs_capture_active:
            self.svs_start_button.configure(state="normal", text="START SVS CAPTURE")
            self._set_svs_status("Capture did not start. Check the capture log for details.", Colors.DANGER)
            return

        self.svs_start_button.configure(text="CAPTURING…")
        self.svs_stop_button.configure(state="normal")
        self._set_svs_status(
            "Recording. Open the SVS Personal/High Score leaderboard, then Alliance Members.",
            Colors.SUCCESS,
        )

    def stop_svs_capture(self) -> None:
        session_id = str(self.session_id or self.svs_capture_session_id or "")
        if not session_id:
            self._set_svs_status("There is no active SVS capture to stop.", Colors.DANGER)
            return

        self.svs_stop_button.configure(state="disabled", text="BUILDING…")
        self.svs_start_button.configure(state="disabled")
        try:
            if self.discovery_enabled:
                self._append_discovery_timeline(
                    "discovery-stop-requested",
                    {"sessionId": session_id, "observedAt": utc_now()},
                )

            self.capture.stop()
            while True:
                try:
                    event = self.capture.events.get_nowait()
                except queue.Empty:
                    break
                self.handle(event.kind, event.payload)

            self.store.stop_session(session_id)
            self.session_id = None
            self.stop_button.configure(state="disabled")
            self.start_button.configure(state="normal")
            self.capture.capture_all_responses = False
            self.discovery_enabled = False
            self.discovery_session_id = ""

            roster = build_roster_export(session_id, SESSIONS_DIR, require_arena=False)
            snapshots, summary = build_svs_snapshots(session_id, SESSIONS_DIR, roster)

            for snapshot in snapshots:
                save_snapshot(self.store, session_id, snapshot)

            # Refresh counts and rebuild the ZIP so the derived SVS snapshots are
            # included alongside the original responses.
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            try:
                self._build_discovery_package(session_id)
                package = self.store.package(session_id)
            except Exception:
                pass

        except Exception as exc:
            self.svs_capture_active = False
            self.capture.capture_all_responses = False
            self.discovery_enabled = False
            self.discovery_session_id = ""
            self.session_id = None
            self.stop_button.configure(state="disabled")
            self.start_button.configure(state="normal")
            self.svs_start_button.configure(state="normal", text="START SVS CAPTURE")
            self.svs_stop_button.configure(text="STOP, BUILD & SYNC")
            self.recording.set("Stopped", "SVS capture needs attention")
            try:
                self.store.stop_session(session_id)
                self.store.package(session_id)
                self.refresh_sessions()
            except Exception:
                pass
            self._set_svs_status(str(exc), Colors.DANGER)
            messagebox.showerror(APP_NAME, f"SVS capture could not be completed:\n\n{exc}")
            return

        self.svs_capture_active = False
        self.svs_capture_session_id = session_id
        self.svs_start_button.configure(state="normal", text="START SVS CAPTURE")
        self.svs_stop_button.configure(text="STOP, BUILD & SYNC")
        self.recording.set("Stopped", "SVS capture ready")
        self.refresh_sessions()

        self._set_svs_summary(
            f"Participation window\n"
            f"  Start: {summary['windowStart']}  (7:00 a.m. Pacific)\n"
            f"  End:   {summary['windowEnd']}\n\n"
            f"Roster members:      {summary['rosterMembers']}\n"
            f"Leaderboard scores:  {summary['leaderboardPlayers']}\n"
            f"Activity-only credit: {summary['activityOnlyPlayers']}\n"
            f"Total participants:   {summary['participants']}\n\n"
            f"SVS score feed(s): {', '.join(summary['sourceCommands'])}\n"
            f"Package: {package.name}"
        )

        datasets = {"state_ruler_rankings", "state_ruler_attendance"}
        sync_rows = [
            row
            for row in self.store.snapshots_for_session(session_id)
            if str(row.get("dataset") or "") in datasets
        ]
        if self.config.values.get("cloudEndpoint") and self.config.values.get("uploadToken"):
            self.svs_sync_waiting = True
            self._set_svs_status(
                f"Built {summary['leaderboardPlayers']} score row(s) and {summary['activityOnlyPlayers']} attendance-only row(s). Uploading…",
                Colors.ACCENT,
            )
            self._begin_sync(sync_rows, f"from SVS capture {session_id}")
        else:
            self._set_svs_status(
                "Capture is saved locally. Configure Cloud Sync to send the SVS score and participation snapshots.",
                Colors.ACCENT,
            )

    def _sync_done(self, count: int, accepted: int, duplicates: int) -> None:
        super()._sync_done(count, accepted, duplicates)
        if self.svs_sync_waiting:
            self.svs_sync_waiting = False
            self._set_svs_status(
                f"SVS sync complete: {accepted} new snapshot(s), {duplicates} already present.",
                Colors.SUCCESS,
            )

    def _sync_failed(self, message: str) -> None:
        super()._sync_failed(message)
        if self.svs_sync_waiting:
            self.svs_sync_waiting = False
            self._set_svs_status(
                f"SVS capture is saved locally, but cloud sync failed: {message}",
                Colors.DANGER,
            )
