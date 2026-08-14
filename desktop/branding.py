from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from typing import Any

APP_USER_MODEL_ID = "State305.WDZ.AllianceTracker"
FONT_FILE = "GoogleSansFlex-Regular.ttf"
ICON_FILE = "alliance-tracker.ico"
FR_PRIVATE = 0x10


def resource_root() -> Path:
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) if bundled else Path(__file__).resolve().parent


def asset_path(name: str) -> Path:
    return resource_root() / "assets" / name


def register_bundled_font() -> bool:
    """Register Google Sans Flex privately for this process only."""
    font = asset_path(FONT_FILE)
    if not font.exists() or sys.platform != "win32":
        return False
    try:
        result = ctypes.windll.gdi32.AddFontResourceExW(str(font), FR_PRIVATE, 0)
        return bool(result)
    except Exception:
        return False


def set_windows_app_identity() -> None:
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)
    except Exception:
        pass


def apply_window_icon(app: Any) -> bool:
    icon = asset_path(ICON_FILE)
    if not icon.exists():
        return False
    try:
        app.iconbitmap(default=str(icon))
        return True
    except Exception:
        return False
