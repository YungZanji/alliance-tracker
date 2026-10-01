from __future__ import annotations

from collections import Counter
from typing import Any

import customtkinter as ctk

from app import Colors
from app_direct_duel_v182 import App as DirectDuelApp
from capture import decode_response
from direct_duel import probe_complete, validate_sync_summary
from glory_war_capture import build_glory_war_snapshot
from roster_export import build_roster_export
from svs_capture import build_svs_snapshots, save_snapshot
from utils import SESSIONS_DIR


EVENT_MODES = {"glory", "ruler", "all-events"}
EVENT_COMMANDS = {"alliance.declare.war.personal.rank", "server.battle.user.score.rank", "al.rank"}


class App(DirectDuelApp):
    """Direct event score validation using the established Duel transport."""

    def __init__(self) -> None:
        super().__init__()
        panel = ctk.CTkFrame(self.pages["overview"], fg_color=Colors.PANEL)
        panel.pack(fill="x", pady=(0, 14), before=self.overview_log)
        ctk.CTkLabel(
            panel, text="DIRECT EVENT SCORE TESTS · READ ONLY",
            text_color=Colors.ACCENT, font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(12, 3))
        ctk.CTkLabel(
            panel,
            text="Pull scores directly from the game without opening their ranking screens. "
                 "Each run saves a diagnostic ZIP. Event scores are built locally only when the existing decoder validates them.",
            wraplength=900, justify="left", text_color=Colors.MUTED,
        ).pack(anchor="w", padx=16, pady=(0, 8))
        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=12, pady=(0, 12))
        self.direct_event_buttons = []
        for column, (label, mode) in enumerate((
            ("TEST GLORY WAR", "glory"),
            ("TEST STATE RULER", "ruler"),
            ("TEST ALL THREE", "all-events"),
        )):
            row.grid_columnconfigure(column, weight=1)
            button = ctk.CTkButton(
                row, text=label, command=lambda selected=mode: self._start_direct_duel(selected),
                fg_color=Colors.PANEL2, text_color=Colors.TEXT,
            )
            button.grid(row=0, column=column, padx=4, sticky="ew")
            self.direct_event_buttons.append(button)

    def _set_direct_buttons(self, enabled: bool) -> None:
        super()._set_direct_buttons(enabled)
        for button in getattr(self, "direct_event_buttons", []):
            button.configure(state="normal" if enabled else "disabled")

    def handle(self, kind: str, payload: Any) -> None:
        # The base capture flow counts Duel responses. Count event responses in the
        # same session, before it checks completion and packages the capture.
        if kind == "response" and self.direct_duel_active and self.direct_duel_mode in EVENT_MODES:
            try:
                command, _, _, _ = decode_response(payload)
                if command in EVENT_COMMANDS:
                    self.direct_duel_observed[command] += 1
            except Exception:
                pass
        super().handle(kind, payload)

    def _finish_direct_duel(self, reason: str, success: bool) -> None:
        mode = self.direct_duel_mode
        session_id = str(self.session_id or self.direct_duel_session_id or "")
        complete = probe_complete(mode, Counter(self.direct_duel_observed)) if mode in EVENT_MODES else success
        super()._finish_direct_duel(reason, success and complete)
        if mode not in EVENT_MODES or not session_id:
            return

        reports: list[str] = []
        if mode in {"glory", "all-events"}:
            try:
                snapshot, summary = build_glory_war_snapshot(session_id, SESSIONS_DIR)
                save_snapshot(self.store, session_id, snapshot)
                reports.append(
                    f"Glory War: VERIFIED {summary['players']} WDZ scores; "
                    f"State {summary['primaryServerId']} vs State {summary['opponentServerId']}."
                )
            except (ValueError, FileNotFoundError) as exc:
                reports.append(f"Glory War: UNVERIFIED — {exc}")
        if mode in {"ruler", "all-events"}:
            try:
                roster = build_roster_export(session_id, SESSIONS_DIR, require_arena=False)
                snapshots, summary = build_svs_snapshots(session_id, SESSIONS_DIR, roster)
                if not any(row.dataset == "state_ruler_rankings" for row in snapshots):
                    raise ValueError("No WDZ leaderboard scores matched the same-session roster.")
                for snapshot in snapshots:
                    save_snapshot(self.store, session_id, snapshot)
                reports.append(
                    f"State Ruler: VERIFIED {summary['leaderboardPlayers']} WDZ scores, "
                    f"{summary['rosterMembers']} roster members."
                )
            except (ValueError, FileNotFoundError) as exc:
                reports.append(f"State Ruler: UNVERIFIED — {exc}")
        if mode == "all-events":
            valid, missing = validate_sync_summary(self.store.summary(session_id))
            reports.append("Alliance Duel: " + ("VERIFIED" if valid else "UNVERIFIED — " + ", ".join(missing)))
        try:
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            reports.append(f"Diagnostic package: {package}")
        except Exception as exc:
            reports.append(f"Packaging failed: {exc}")
        reports.append("Event test runs stay local until the direct requests and score decoders are confirmed on live data.")
        self._append_direct_summary(reports)
        verified = all("UNVERIFIED" not in line and "failed" not in line for line in reports)
        self._set_direct_status(
            "Direct score test verified locally." if verified else "Direct score test needs review; see the saved package.",
            Colors.SUCCESS if verified else Colors.DANGER,
        )
        self.refresh_sessions()
