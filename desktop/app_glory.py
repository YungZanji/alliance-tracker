from __future__ import annotations

import queue
import time
from typing import Any

import customtkinter as ctk
from tkinter import messagebox

from app import APP_NAME, Colors
from app_svs import App as BaseApp
from app_v140_runtime import CAPTURE_PURPOSES
from app_v170_runtime import BROAD_DISCOVERY_PURPOSES
from glory_war_capture import GLORY_WAR_PURPOSE, build_glory_war_snapshot
from svs_capture import save_snapshot
from utils import SESSIONS_DIR, utc_now


CAPTURE_PURPOSES[GLORY_WAR_PURPOSE] = (
    "Capture the Glory War personal ranking after the battle. The tracker archives WDZ player scores, "
    "the state-vs-state totals, opponent alliance/state identity, and the final win/loss result."
)
BROAD_DISCOVERY_PURPOSES.add(GLORY_WAR_PURPOSE)


class App(BaseApp):
    def __init__(self) -> None:
        self.glory_capture_active = False
        self.glory_capture_session_id = ""
        self.glory_capture_wait_started = 0.0
        self.glory_sync_waiting = False
        super().__init__()
        self._build_glory_war_capture_page()
        self._rebuild_sidebar()

    def _rebuild_sidebar(self) -> None:
        super()._rebuild_sidebar()
        if "glory_war_capture" not in self.pages or not self.nav:
            return
        side = next(iter(self.nav.values())).master
        button = self.nav.get("glory_war_capture")
        if button is None:
            button = self._new_nav_button(side, "glory_war_capture", "Glory War")
        else:
            button.configure(text="Glory War")
        settings = self.nav.get("settings")
        try:
            if settings is not None:
                settings.grid_configure(row=13)
            button.grid(row=12, column=0, sticky="ew", padx=9, pady=1)
            side.grid_rowconfigure(13, weight=0)
            side.grid_rowconfigure(14, weight=1)
        except Exception:
            pass

    def _build_glory_war_capture_page(self) -> None:
        page = self.page(
            "glory_war_capture",
            "Glory War Capture",
            "Archive WDZ Glory War scores and the final state-vs-state matchup without storing opponent player scores.",
        )
        panel = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        panel.pack(fill="x")

        ctk.CTkLabel(panel, text="GLORY WAR ARCHIVE", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(panel, text="One post-war ranking capture", text_color=Colors.TEXT, font=(self.font, 18, "bold")).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Start capture, open Glory War and its Personal Ranking after the battle, then stop. "
                "WDZ player scores are archived individually. Opponent player rows are used only to derive the opposing state/alliance totals and are not stored in the Glory War leaderboard."
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
                "1. Start Glory War Capture\n"
                "2. Open Glory War → Personal Ranking\n"
                "3. Wait for the ranking to load\n"
                "4. Stop, Build & Sync"
            ),
            text_color=Colors.TEXT,
            font=(self.font, 10),
            justify="left",
        ).pack(anchor="w", padx=12, pady=10)

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(0, 7))
        actions.grid_columnconfigure((0, 1), weight=1)
        self.glory_start_button = ctk.CTkButton(
            actions,
            text="START GLORY WAR CAPTURE",
            height=39,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9, "bold"),
            command=self.start_glory_capture,
        )
        self.glory_start_button.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.glory_stop_button = ctk.CTkButton(
            actions,
            text="STOP, BUILD & SYNC",
            height=39,
            fg_color=Colors.SUCCESS,
            hover_color="#24B984",
            text_color="#07111F",
            font=(self.font, 9, "bold"),
            state="disabled",
            command=self.stop_glory_capture,
        )
        self.glory_stop_button.grid(row=0, column=1, sticky="ew", padx=4, pady=4)

        self.glory_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. Capture the post-war Personal Ranking after the final scores are visible.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.glory_capture_status.pack(anchor="w", padx=16, pady=(2, 14))

        inspect = ctk.CTkFrame(page, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        inspect.pack(fill="both", expand=True, pady=(12, 0))
        ctk.CTkLabel(inspect, text="CAPTURE SUMMARY", text_color=Colors.ACCENT, font=(self.font, 10, "bold")).pack(anchor="w", padx=16, pady=(14, 5))
        self.glory_summary = ctk.CTkTextbox(
            inspect,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 10),
        )
        self.glory_summary.pack(fill="both", expand=True, padx=16, pady=(0, 14))
        self._set_glory_summary("No Glory War capture has been completed in this session yet.")

    def _set_glory_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "glory_capture_status"):
            self.glory_capture_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Glory War: " + text)

    def _set_glory_summary(self, text: str) -> None:
        if not hasattr(self, "glory_summary"):
            return
        self.glory_summary.configure(state="normal")
        self.glory_summary.delete("1.0", "end")
        self.glory_summary.insert("1.0", text.rstrip() + "\n")
        self.glory_summary.configure(state="disabled")

    def start_glory_capture(self) -> None:
        if self.session_id or self.glory_capture_active:
            self._set_glory_status("Another capture is already running. Stop it before starting Glory War.", Colors.DANGER)
            return

        self.glory_capture_session_id = ""
        self.glory_start_button.configure(state="disabled", text="ATTACHING…")
        self.glory_stop_button.configure(state="disabled")
        self._set_glory_status("Preparing the capture engine…", Colors.ACCENT)

        if self.capture.state.ready and self.capture.state.attached:
            self._begin_glory_recording()
            return

        self.attach()
        self.glory_capture_wait_started = time.monotonic()
        self.after(250, self._wait_for_glory_attach)

    def _wait_for_glory_attach(self) -> None:
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_glory_recording()
            return
        if time.monotonic() - self.glory_capture_wait_started >= 20.0:
            self.glory_start_button.configure(state="normal", text="START GLORY WAR CAPTURE")
            self._set_glory_status("Capture engine was not ready within 20 seconds. Confirm Last Z is in the city and try again.", Colors.DANGER)
            return
        self.after(250, self._wait_for_glory_attach)

    def _begin_glory_recording(self) -> None:
        try:
            self.capture_purpose_menu.set(GLORY_WAR_PURPOSE)
            self._capture_purpose_changed(GLORY_WAR_PURPOSE)
            self.capture_label_entry.delete(0, "end")
            self.capture_label_entry.insert(0, "Glory War Score Capture")
            self._capture_studio_start()
            self.glory_capture_session_id = str(self.session_id or "")
            self.glory_capture_active = bool(self.glory_capture_session_id)
        except Exception as exc:
            self.glory_capture_active = False
            self.glory_start_button.configure(state="normal", text="START GLORY WAR CAPTURE")
            self._set_glory_status(f"Could not start Glory War capture: {exc}", Colors.DANGER)
            return

        if not self.glory_capture_active:
            self.glory_start_button.configure(state="normal", text="START GLORY WAR CAPTURE")
            self._set_glory_status("Capture did not start. Check the capture log for details.", Colors.DANGER)
            return

        self.glory_start_button.configure(text="CAPTURING…")
        self.glory_stop_button.configure(state="normal")
        self._set_glory_status("Recording. Open Glory War → Personal Ranking and let the final ranking load.", Colors.SUCCESS)

    def stop_glory_capture(self) -> None:
        session_id = str(self.session_id or self.glory_capture_session_id or "")
        if not session_id:
            self._set_glory_status("There is no active Glory War capture to stop.", Colors.DANGER)
            return

        self.glory_stop_button.configure(state="disabled", text="BUILDING…")
        self.glory_start_button.configure(state="disabled")
        try:
            if self.discovery_enabled:
                self._append_discovery_timeline("discovery-stop-requested", {"sessionId": session_id, "observedAt": utc_now()})

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

            snapshot, summary = build_glory_war_snapshot(session_id, SESSIONS_DIR)
            save_snapshot(self.store, session_id, snapshot)
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            try:
                self._build_discovery_package(session_id)
                package = self.store.package(session_id)
            except Exception:
                pass
        except Exception as exc:
            self.glory_capture_active = False
            self.capture.capture_all_responses = False
            self.discovery_enabled = False
            self.discovery_session_id = ""
            self.session_id = None
            self.stop_button.configure(state="disabled")
            self.start_button.configure(state="normal")
            self.glory_start_button.configure(state="normal", text="START GLORY WAR CAPTURE")
            self.glory_stop_button.configure(text="STOP, BUILD & SYNC")
            self.recording.set("Stopped", "Glory War capture needs attention")
            try:
                self.store.stop_session(session_id)
                self.store.package(session_id)
                self.refresh_sessions()
            except Exception:
                pass
            self._set_glory_status(str(exc), Colors.DANGER)
            messagebox.showerror(APP_NAME, f"Glory War capture could not be completed:\n\n{exc}")
            return

        self.glory_capture_active = False
        self.glory_capture_session_id = session_id
        self.glory_start_button.configure(state="normal", text="START GLORY WAR CAPTURE")
        self.glory_stop_button.configure(text="STOP, BUILD & SYNC")
        self.recording.set("Stopped", "Glory War capture ready")
        self.refresh_sessions()

        opponent = str(summary.get("opponentAllianceName") or summary.get("opponentAllianceAbbr") or "Opponent")
        opponent_abbr = str(summary.get("opponentAllianceAbbr") or "")
        result = str(summary.get("result") or "")
        self._set_glory_summary(
            f"Result: {result}\n"
            f"WDZ / State {summary['primaryServerId']}: {int(summary['primaryStateScore']):,}\n"
            f"{opponent} {f'({opponent_abbr})' if opponent_abbr else ''} / State {summary['opponentServerId']}: {int(summary['opponentStateScore']):,}\n\n"
            f"WDZ alliance contribution: {int(summary['primaryAllianceScore']):,}\n"
            f"Opponent alliance contribution: {int(summary['opponentAllianceScore']):,}\n"
            f"WDZ player scores archived: {summary['players']}\n"
            f"Opponent player scores archived: no\n\n"
            f"Package: {package.name}"
        )

        sync_rows = [
            row for row in self.store.snapshots_for_session(session_id)
            if str(row.get("dataset") or "") == "glory_war_rankings"
        ]
        if self.config.values.get("cloudEndpoint") and self.config.values.get("uploadToken"):
            self.glory_sync_waiting = True
            self._set_glory_status(f"Built {summary['players']} WDZ score row(s). Uploading Glory War archive…", Colors.ACCENT)
            self._begin_sync(sync_rows, f"from Glory War capture {session_id}")
        else:
            self._set_glory_status("Capture is saved locally. Configure Cloud Sync to send the Glory War archive.", Colors.ACCENT)

    def _sync_done(self, count: int, accepted: int, duplicates: int) -> None:
        super()._sync_done(count, accepted, duplicates)
        if self.glory_sync_waiting:
            self.glory_sync_waiting = False
            self._set_glory_status(f"Glory War sync complete: {accepted} new snapshot(s), {duplicates} already present.", Colors.SUCCESS)

    def _sync_failed(self, message: str) -> None:
        super()._sync_failed(message)
        if self.glory_sync_waiting:
            self.glory_sync_waiting = False
            self._set_glory_status(f"Glory War capture is saved locally, but cloud sync failed: {message}", Colors.DANGER)
