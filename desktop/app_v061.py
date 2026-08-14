from __future__ import annotations

from tkinter import font as tkfont

from app_v060 import App as BaseApp


class App(BaseApp):
    """Alliance Tracker 0.6.1 review shell with unified State 305 typography."""

    def _font(self) -> str:
        families = {name.lower(): name for name in tkfont.families(self)}
        for candidate in (
            "Google Sans Flex",
            "Google Sans",
            "Google Sans Text",
            "Segoe UI Variable",
            "Segoe UI",
        ):
            if candidate.lower() in families:
                return families[candidate.lower()]
        return "Arial"
