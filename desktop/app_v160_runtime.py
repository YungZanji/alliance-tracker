from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from app_v150_runtime import App as BaseApp
from utils import APP_DATA_DIR, utc_now


BACKGROUND_DIR = APP_DATA_DIR / "background-runs"
LATEST_BACKGROUND_RUN = BACKGROUND_DIR / "latest.json"


class App(BaseApp):
    """1.6.0 review: run the proven one-touch plan unattended in the same desktop engine."""

    def __init__(self) -> None:
        self.background_mode = False
        self.background_close_game = False
        self.background_exit_after = False
        self.background_exit_code = 0
        self.background_started_at = ""
        self.background_timeout_minutes = 12
        self._background_finished = False
        self._background_timeout_job: str | None = None
        super().__init__()

    def start_background_today(
        self,
        *,
        close_game: bool = False,
        exit_after: bool = True,
        timeout_minutes: int = 12,
    ) -> None:
        """Launch Today's saved plan without changing the proven replay/capture implementation."""
        if self.background_mode or self.duel_running or self.sync_plan_running:
            return
        self.background_mode = True
        self.background_close_game = bool(close_game)
        self.background_exit_after = bool(exit_after)
        self.background_exit_code = 0
        self.background_started_at = utc_now()
        self.background_timeout_minutes = max(3, min(60, int(timeout_minutes or 12)))
        self._background_finished = False
        BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
        self.write(
            f"Background runner: starting Today's Sync Plan; timeout {self.background_timeout_minutes} minute(s)."
        )
        self._write_background_status("starting", "Background run requested.")
        self._background_timeout_job = self.after(
            self.background_timeout_minutes * 60 * 1000,
            self._background_timeout,
        )
        self.run_today_sync_plan()
        if not self.sync_plan_running and not self.duel_running:
            self._finish_background(False, "Today's Sync Plan did not start. Check the saved day profile and Settings.")

    def _start_next_sync_job(self) -> None:
        was_running = bool(self.sync_plan_running)
        super()._start_next_sync_job()
        if (
            self.background_mode
            and was_running
            and not self.sync_plan_running
            and not self.duel_running
            and not self.sync_plan_queue
            and not self._background_finished
        ):
            self._finish_background(True, f"{self.sync_plan_day} plan completed successfully.")

    def _sync_plan_abort(self, message: str) -> None:
        background_active = self.background_mode and not self._background_finished
        super()._sync_plan_abort(message)
        if background_active:
            self._finish_background(False, message)

    def _background_timeout(self) -> None:
        self._background_timeout_job = None
        if self.background_mode and not self._background_finished:
            try:
                self.stop_duel_automation()
            except Exception:
                pass
            self._finish_background(False, f"Background run exceeded {self.background_timeout_minutes} minutes and was stopped.")

    def _finish_background(self, success: bool, message: str) -> None:
        if self._background_finished:
            return
        self._background_finished = True
        if self._background_timeout_job:
            try:
                self.after_cancel(self._background_timeout_job)
            except Exception:
                pass
            self._background_timeout_job = None

        self.background_exit_code = 0 if success else 2
        self._write_background_status("success" if success else "failed", message)
        self.write(f"Background runner: {message}")

        if self.background_close_game:
            self._close_last_z_processes()

        if self.background_exit_after:
            self.after(800, self.destroy)

    def _write_background_status(self, status: str, message: str) -> None:
        BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "schemaVersion": 1,
            "release": "1.6.0-review",
            "status": status,
            "message": message,
            "startedAt": self.background_started_at,
            "updatedAt": utc_now(),
            "day": str(getattr(self, "sync_plan_day", "") or self._utc_day()),
            "sessionId": str(getattr(self, "duel_session_id", "") or ""),
            "results": list(getattr(self, "sync_plan_results", []) or []),
            "closeGameRequested": bool(self.background_close_game),
            "exitCode": int(self.background_exit_code),
        }
        timestamp = payload["updatedAt"].replace(":", "-").replace("+", "_")
        history = BACKGROUND_DIR / f"run-{timestamp}.json"
        text = json.dumps(payload, indent=2, ensure_ascii=False)
        LATEST_BACKGROUND_RUN.write_text(text, encoding="utf-8")
        history.write_text(text, encoding="utf-8")

    def _close_last_z_processes(self) -> None:
        """Optional post-run cleanup for unattended runners. Never used by normal GUI runs."""
        for image in ("Survival.exe", "Last Z.exe", "Launcher.exe"):
            try:
                subprocess.run(
                    ["taskkill", "/IM", image, "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    timeout=10,
                    check=False,
                )
            except Exception:
                pass
