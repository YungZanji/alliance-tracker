from __future__ import annotations

from typing import Any

import customtkinter as ctk

from app import App as BaseApp, Colors
from capture import ALLIANCE_DUEL_COMMANDS, CONFIRMED_EVENT_COMMANDS, is_discovery_command


class App(BaseApp):
    """Alliance Tracker 0.6 desktop shell with event-response discovery enabled."""

    def _overview(self) -> None:
        super()._overview()
        page = self.pages["overview"]
        discovery = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=14,
            border_width=1,
            border_color=Colors.BORDER,
        )
        discovery.pack(fill="x", pady=(0, 14), before=self.overview_log)
        ctk.CTkLabel(
            discovery,
            text="Event Discovery",
            text_color=Colors.ACCENT,
            font=(self.font, 12, "bold"),
        ).pack(anchor="w", padx=15, pady=(12, 2))
        ctk.CTkLabel(
            discovery,
            text=(
                "While a capture is running, the decoder also preserves confirmed State Ruler/SVS responses "
                "and likely Glory War / ruler event responses. You still navigate the game manually."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=850,
            justify="left",
        ).pack(anchor="w", padx=15, pady=(0, 12))

    def _capture(self) -> None:
        super()._capture()
        page = self.pages["capture"]
        discovery = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=14,
            border_width=1,
            border_color=Colors.BORDER,
        )
        discovery.pack(fill="x", pady=(0, 4))
        ctk.CTkLabel(
            discovery,
            text="Event Discovery is active",
            text_color=Colors.SUCCESS,
            font=(self.font, 11, "bold"),
        ).pack(anchor="w", padx=15, pady=(11, 2))
        ctk.CTkLabel(
            discovery,
            text=(
                "Confirmed discovery commands: server.battle.score.person.rank, server.battle.score.ali.rank, "
                "server.battle.score.info and get.person.arms.group.rank. Likely Glory War / ruler / SVS command "
                "names are also decoded into the raw session package for analysis."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=15, pady=(0, 11))

    def handle(self, kind: str, payload: Any) -> None:
        if kind == "dispatch-response" and self.session_id:
            command = str(payload.get("command") or "")
            if is_discovery_command(command) and command not in ALLIANCE_DUEL_COMMANDS:
                label = "Confirmed event" if command in CONFIRMED_EVENT_COMMANDS else "Discovery candidate"
                self.write(f"{label}: {command}")
        super().handle(kind, payload)
