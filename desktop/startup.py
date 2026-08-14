from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from branding import apply_window_icon, register_bundled_font, set_windows_app_identity

APP_NAME = "Alliance Tracker"
APP_VERSION = "1.7.0"
APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AllianceTracker"
STARTUP_LOG = APP_DATA_DIR / "startup-error.log"
BACKGROUND_DIR = APP_DATA_DIR / "background-runs"
LATEST_BACKGROUND_RUN = BACKGROUND_DIR / "latest.json"
DISPLAY_SCALE_VERSION = 2
DEFAULT_DISPLAY_SCALE = 1.32
INSTANCE_MUTEX_NAME = r"Local\WDZAllianceTrackerCaptureHost"
ERROR_ALREADY_EXISTS = 183


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Alliance Tracker")
    parser.add_argument("--run-today", action="store_true", help="Run Today's saved Auto Sync plan after startup.")
    parser.add_argument("--headless", action="store_true", help="Keep the Alliance Tracker window hidden while the run executes.")
    parser.add_argument("--close-game", action="store_true", help="Close Last Z only after a successful unattended run.")
    parser.add_argument("--exit-after", action="store_true", help="Exit Alliance Tracker after Today's plan finishes.")
    parser.add_argument("--timeout-minutes", type=int, default=12, help="Maximum unattended run time before the runner stops itself.")
    return parser.parse_args()


def acquire_instance_mutex() -> tuple[int | None, bool]:
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, INSTANCE_MUTEX_NAME)
        if not handle:
            return None, True
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return None, False
        return int(handle), True
    except Exception:
        return None, True


def release_instance_mutex(handle: int | None) -> None:
    if not handle:
        return
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        kernel32.CloseHandle(ctypes.c_void_p(handle))
    except Exception:
        pass


def write_background_preflight_failure(message: str, exit_code: int = 3) -> None:
    try:
        BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
        now = utc_now()
        payload = {
            "schemaVersion": 1,
            "release": APP_VERSION,
            "status": "failed",
            "stage": "preflight",
            "message": message,
            "startedAt": now,
            "updatedAt": now,
            "day": "",
            "sessionId": "",
            "results": [],
            "closeGameRequested": False,
            "exitCode": exit_code,
        }
        text = json.dumps(payload, indent=2, ensure_ascii=False)
        LATEST_BACKGROUND_RUN.write_text(text, encoding="utf-8")
        stamp = now.replace(":", "-").replace("+", "_")
        (BACKGROUND_DIR / f"run-{stamp}.json").write_text(text, encoding="utf-8")
    except Exception:
        pass


def write_failure(error: BaseException) -> str:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    details = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    report = (
        f"{utc_now()} {APP_NAME} failed during startup\n"
        f"Version: {APP_VERSION}\n"
        f"Python: {sys.version}\n"
        f"Executable: {sys.executable}\n"
        f"Working directory: {Path.cwd()}\n\n"
        f"{details}"
    )
    STARTUP_LOG.write_text(report, encoding="utf-8")
    return report


def show_native_error(message: str) -> None:
    summary = message
    if len(summary) > 3500:
        summary = summary[:3500] + "\n\n[The complete traceback is in startup-error.log.]"
    try:
        ctypes.windll.user32.MessageBoxW(
            0,
            f"Alliance Tracker could not start.\n\n{summary}\n\nFull log:\n{STARTUP_LOG}",
            f"{APP_NAME} - Startup Error",
            0x10,
        )
    except Exception:
        pass


def bring_to_front(app: object) -> None:
    try:
        app.deiconify()
        app.lift()
        app.attributes("-topmost", True)
        app.after(350, lambda: app.attributes("-topmost", False))
        app.focus_force()
    except Exception:
        pass


def configure_display() -> float:
    import customtkinter as ctk
    from cloud import Config

    config = Config()
    values = config.values
    try:
        scale_version = int(values.get("uiScaleVersion", 0))
    except (TypeError, ValueError):
        scale_version = 0
    if scale_version < DISPLAY_SCALE_VERSION:
        scale = DEFAULT_DISPLAY_SCALE
        values["uiScale"] = scale
        values["uiScaleVersion"] = DISPLAY_SCALE_VERSION
        config.save()
    else:
        try:
            scale = float(values.get("uiScale", DEFAULT_DISPLAY_SCALE))
        except (TypeError, ValueError):
            scale = DEFAULT_DISPLAY_SCALE
    scale = max(1.00, min(1.60, scale))
    ctk.set_widget_scaling(scale)
    return scale


def improve_native_table(app: object, scale: float) -> None:
    try:
        from tkinter import ttk
        body_size = max(15, round(12 * scale))
        header_size = max(13, round(11 * scale))
        row_height = max(44, round(35 * scale))
        style = ttk.Style(app)
        style.configure("Tracker.Treeview", font=(app.font, body_size), rowheight=row_height)
        style.configure("Tracker.Treeview.Heading", font=(app.font, header_size, "bold"))
    except Exception:
        pass


def main() -> int:
    args = parse_args()
    headless_requested = bool(args.headless)
    mutex_handle: int | None = None
    try:
        if args.headless and not args.run_today:
            raise ValueError("--headless requires --run-today so the hidden process has a finite job to execute.")

        mutex_handle, mutex_acquired = acquire_instance_mutex()
        if not mutex_acquired:
            message = (
                "Another Alliance Tracker instance is already running. Close the visible Tracker before "
                "starting an unattended run so two Frida capture hosts never attach to the same Survival.exe process."
            )
            if headless_requested:
                write_background_preflight_failure(message, 3)
                print(message, file=sys.stderr, flush=True)
            else:
                show_native_error(message)
            return 3

        set_windows_app_identity()
        font_registered = register_bundled_font()
        scale = configure_display()
        print(f"Alliance Tracker {APP_VERSION}")
        print(f"Display scale: {scale:.0%}")
        print(f"Google Sans Flex bundled font: {'loaded' if font_registered else 'fallback'}")

        from app_v170_runtime import App

        app = App()
        app.title(f"{APP_NAME} {APP_VERSION}")
        apply_window_icon(app)
        improve_native_table(app, scale)

        if args.headless:
            app.withdraw()
        else:
            app.after(150, lambda: bring_to_front(app))

        if args.run_today:
            app.after(
                1500,
                lambda: app.start_background_today(
                    close_game=bool(args.close_game),
                    exit_after=bool(args.exit_after or args.headless),
                    timeout_minutes=max(3, min(60, int(args.timeout_minutes or 12))),
                ),
            )

        app.mainloop()
        return int(getattr(app, "background_exit_code", 0) or 0)
    except BaseException as error:
        report = write_failure(error)
        print(report, file=sys.stderr, flush=True)
        if headless_requested:
            write_background_preflight_failure(str(error), 1)
        else:
            show_native_error(str(error))
        return 1
    finally:
        release_instance_mutex(mutex_handle)


if __name__ == "__main__":
    raise SystemExit(main())
