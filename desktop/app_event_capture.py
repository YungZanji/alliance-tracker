from __future__ import annotations

from typing import Any

import customtkinter as ctk
from tkinter import messagebox

from app import APP_NAME, Colors
from app_glory import App as BaseApp
from glory_war_capture import build_glory_war_snapshot, find_glory_war_sessions
from svs_capture import save_snapshot
from utils import SESSIONS_DIR


class App(BaseApp):
    """Current event-capture UI: live Glory War capture plus saved discovery import."""

    def __init__(self) -> None:
        self.glory_import_sessions: dict[str, str] = {}
        self.glory_import_sync_waiting = False
        super().__init__()
        self._build_glory_history_import()
        self._rebuild_sidebar()

    def _rebuild_sidebar(self) -> None:
        super()._rebuild_sidebar()
        button = self.nav.get("glory_war_capture")
        if button is not None:
            button.configure(text="Glory War Capture")

    def _build_glory_history_import(self) -> None:
        page = self.pages.get("glory_war_capture")
        if page is None:
            return

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x", pady=(12, 0))

        ctk.CTkLabel(
            panel,
            text="SAVED DISCOVERY IMPORT",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="Recover a Glory War from an earlier Full Data Discovery",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "The tracker scans saved sessions for alliance.declare.war.personal.rank. "
                "Select an older discovery, preview it through the normal Glory War decoder, then sync the derived archive without replaying the event."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        self.glory_import_menu = ctk.CTkComboBox(
            panel,
            values=["No Glory War discovery sessions found"],
            height=36,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
        )
        self.glory_import_menu.pack(fill="x", padx=16)

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=12, pady=(7, 7))
        actions.grid_columnconfigure((0, 1), weight=1)
        ctk.CTkButton(
            actions,
            text="REFRESH SAVED SESSIONS",
            height=36,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self._refresh_glory_import_sessions,
        ).grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.glory_import_button = ctk.CTkButton(
            actions,
            text="IMPORT & SYNC SELECTED",
            height=36,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9, "bold"),
            state="disabled",
            command=self._import_selected_glory_session,
        )
        self.glory_import_button.grid(row=0, column=1, sticky="ew", padx=4, pady=4)

        self.glory_import_status = ctk.CTkLabel(
            panel,
            text="Scanning saved sessions…",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=820,
            justify="left",
        )
        self.glory_import_status.pack(anchor="w", padx=16, pady=(0, 14))
        self._refresh_glory_import_sessions()

    def _set_glory_import_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "glory_import_status"):
            self.glory_import_status.configure(text=text, text_color=color or Colors.MUTED)

    def _refresh_glory_import_sessions(self) -> None:
        if not hasattr(self, "glory_import_menu"):
            return
        sessions = find_glory_war_sessions(SESSIONS_DIR, self.store.list_sessions(limit=250))
        mapping: dict[str, str] = {}
        labels: list[str] = []
        for row in sessions:
            session_id = str(row.get("id") or "")
            label = str(row.get("label") or "Saved session")
            started = str(row.get("started_at") or "")
            display = f"{started[:19]} · {label} · {session_id}"
            mapping[display] = session_id
            labels.append(display)

        self.glory_import_sessions = mapping
        if labels:
            self.glory_import_menu.configure(values=labels)
            self.glory_import_menu.set(labels[0])
            self.glory_import_button.configure(state="normal")
            self._set_glory_import_status(
                f"Found {len(labels)} saved session(s) containing the Glory War personal ranking."
            )
        else:
            placeholder = "No Glory War discovery sessions found"
            self.glory_import_menu.configure(values=[placeholder])
            self.glory_import_menu.set(placeholder)
            self.glory_import_button.configure(state="disabled")
            self._set_glory_import_status(
                "No saved session currently contains alliance.declare.war.personal.rank. Run Full Data Discovery or the normal Glory War Capture during/after the next event."
            )

    @staticmethod
    def _summary_text(summary: dict[str, Any], package_name: str, prefix: str = "") -> str:
        opponent = str(summary.get("opponentAllianceName") or summary.get("opponentAllianceAbbr") or "Opponent")
        opponent_abbr = str(summary.get("opponentAllianceAbbr") or "")
        lead = f"{prefix}\n\n" if prefix else ""
        return (
            f"{lead}Result: {summary.get('result') or '—'}\n"
            f"WDZ / State {summary.get('primaryServerId')}: {int(summary.get('primaryStateScore') or 0):,}\n"
            f"{opponent} {f'({opponent_abbr})' if opponent_abbr else ''} / State {summary.get('opponentServerId')}: {int(summary.get('opponentStateScore') or 0):,}\n\n"
            f"WDZ alliance contribution: {int(summary.get('primaryAllianceScore') or 0):,}\n"
            f"Opponent alliance contribution: {int(summary.get('opponentAllianceScore') or 0):,}\n"
            f"WDZ player scores archived: {int(summary.get('players') or 0)}\n"
            f"Opponent player scores archived: no\n\n"
            f"Package: {package_name}"
        )

    def _import_selected_glory_session(self) -> None:
        display = str(self.glory_import_menu.get() or "")
        session_id = self.glory_import_sessions.get(display, "")
        if not session_id:
            self._set_glory_import_status("Choose a saved Glory War discovery session first.", Colors.DANGER)
            return
        if self.session_id:
            self._set_glory_import_status("Stop the active capture before importing a saved session.", Colors.DANGER)
            return

        self.glory_import_button.configure(state="disabled", text="IMPORTING…")
        self._set_glory_import_status(f"Reading saved session {session_id}…", Colors.ACCENT)
        try:
            snapshot, summary = build_glory_war_snapshot(session_id, SESSIONS_DIR)
            save_snapshot(self.store, session_id, snapshot)
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            self.refresh_sessions()
        except Exception as exc:
            self.glory_import_button.configure(state="normal", text="IMPORT & SYNC SELECTED")
            self._set_glory_import_status(str(exc), Colors.DANGER)
            messagebox.showerror(APP_NAME, f"Saved Glory War session could not be imported:\n\n{exc}")
            return

        self.glory_import_button.configure(state="normal", text="IMPORT & SYNC SELECTED")
        self._set_glory_summary(
            self._summary_text(summary, package.name, prefix=f"Imported saved session: {session_id}")
        )

        sync_rows = [
            row
            for row in self.store.snapshots_for_session(session_id)
            if str(row.get("dataset") or "") == "glory_war_rankings"
        ]
        if self.config.values.get("cloudEndpoint") and self.config.values.get("uploadToken"):
            self.glory_sync_waiting = True
            self.glory_import_sync_waiting = True
            self._set_glory_import_status(
                f"Decoded {summary['players']} WDZ score row(s). Uploading the saved Glory War archive…",
                Colors.ACCENT,
            )
            self._begin_sync(sync_rows, f"from saved Glory War session {session_id}")
        else:
            self._set_glory_import_status(
                "Historical Glory War archive built locally. Configure Cloud Sync to upload it.",
                Colors.ACCENT,
            )

    def _sync_done(self, count: int, accepted: int, duplicates: int) -> None:
        imported = self.glory_import_sync_waiting
        super()._sync_done(count, accepted, duplicates)
        if imported:
            self.glory_import_sync_waiting = False
            self._set_glory_import_status(
                f"Historical Glory War sync complete: {accepted} new snapshot(s), {duplicates} already present.",
                Colors.SUCCESS,
            )

    def _sync_failed(self, message: str) -> None:
        imported = self.glory_import_sync_waiting
        super()._sync_failed(message)
        if imported:
            self.glory_import_sync_waiting = False
            self._set_glory_import_status(
                f"Historical Glory War archive is saved locally, but cloud sync failed: {message}",
                Colors.DANGER,
            )
