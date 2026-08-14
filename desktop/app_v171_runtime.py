from __future__ import annotations

from typing import Any

import customtkinter as ctk

from app import Colors
from app_v170_runtime import App as BaseApp


class App(BaseApp):
    """1.7.1 discovery review: make the complete Capture Studio a single scrollable surface."""

    def page(self, key: str, title: str, subtitle: str) -> Any:
        # Capture Studio has grown into a long workflow (status, Poll Capture,
        # Capture Workspace, Full Data Discovery and the live log).  The older
        # fixed CTkFrame clipped everything below the visible window.  Make only
        # this page scrollable; every other page keeps its existing layout.
        if key != "overview":
            return super().page(key, title, subtitle)

        frame = ctk.CTkScrollableFrame(
            self.content,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=Colors.BORDER,
            scrollbar_button_hover_color=Colors.ACCENT_HOVER,
        )
        frame.grid(row=0, column=0, sticky="nsew", padx=25, pady=21)
        frame.grid_remove()
        self.pages[key] = frame

        ctk.CTkLabel(
            frame,
            text=title,
            text_color=Colors.TEXT,
            font=(self.font, 28, "bold"),
        ).pack(anchor="w")
        ctk.CTkLabel(
            frame,
            text=subtitle,
            text_color=Colors.MUTED,
            font=(self.font, 12),
            wraplength=850,
            justify="left",
        ).pack(anchor="w", pady=(2, 17))
        return frame
