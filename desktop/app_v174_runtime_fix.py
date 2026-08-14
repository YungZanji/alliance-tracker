from __future__ import annotations

from typing import Any

import customtkinter as ctk

from app_v174_runtime import App as BaseApp


class App(BaseApp):
    """1.7.4 tab-layout guard: move only the intended section panel, never its parent viewport."""

    def _find_top_panel_by_text(self, page: Any, text: str) -> Any | None:
        if page is None:
            return None
        for widget in self._walk(page):
            if not isinstance(widget, ctk.CTkLabel):
                continue
            try:
                if str(widget.cget("text") or "").strip() == text:
                    # All section headings moved by 1.7.4 are direct children of
                    # their section card. Returning the label's immediate master is
                    # therefore precise even when that card itself lives inside the
                    # Sequence Studio scroll surface.
                    return widget.master
            except Exception:
                continue
        return None

    def _rebuild_sidebar(self) -> None:
        super()._rebuild_sidebar()
        # Twelve dedicated categories need to remain visible without adding yet
        # another sidebar scroll surface. Keep the hit targets compact but usable.
        for button in self.nav.values():
            try:
                if button.winfo_manager() == "grid":
                    button.configure(height=29, font=(self.font, 9, "bold"))
            except Exception:
                pass
