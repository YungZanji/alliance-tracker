from __future__ import annotations

import threading
import time

from app import Colors
from app_v110 import App as BaseApp


class App(BaseApp):
    """Runtime hardening for the 1.1 automated Duel review."""

    def __init__(self) -> None:
        self.duel_city_deadline = 0.0
        super().__init__()

    def _begin_duel_attach(self) -> None:
        if not self.duel_running:
            return
        first_attempt = self.duel_stage != "attaching"
        self.duel_stage = "attaching"
        self._set_duel_progress("attach", "Attaching", Colors.ACCENT)
        self._set_duel_status("Survival.exe is running. Attaching Alliance Tracker...")
        if first_attempt or self.duel_attach_deadline <= 0:
            self.duel_attach_deadline = time.monotonic() + 35.0

        if self.capture.state.attached:
            self.after(100, self._poll_duel_hook_ready)
            return

        def work() -> None:
            try:
                self.capture.attach()
            except Exception as exc:
                self.after(0, lambda msg=str(exc): self._duel_attach_failed(msg))

        threading.Thread(target=work, daemon=True).start()
        self.after(150, self._poll_duel_hook_ready)

    def _start_duel_capture(self) -> None:
        # Survival.exe can be running while Last Z is still loading. Give the first
        # city control a generous readiness window; later controls use short retries.
        self.duel_city_deadline = time.monotonic() + 120.0
        super()._start_duel_capture()

    def _retry_duel_step(self, reason: str) -> None:
        if (
            self.duel_running
            and self.duel_current_control == "UIMain_icon_AlCompete"
            and time.monotonic() < self.duel_city_deadline
        ):
            remaining = max(1, int(self.duel_city_deadline - time.monotonic()))
            self._set_duel_status(
                f"Waiting for the Last Z city UI. Alliance Duel control is not active yet ({remaining}s remaining)..."
            )
            self.duel_wait_kind = "retry"
            self.after(1000, self._queue_current_duel_step)
            return
        super()._retry_duel_step(reason)

    def _refresh_final_package(self) -> None:
        # Cloud success/failure happens after the first ZIP is created. Repackage once
        # more so automated-duel-run.json inside the ZIP contains the final outcome.
        if not self.duel_session_id or not self.duel_package:
            return
        try:
            self.duel_package = str(self.store.package(self.duel_session_id))
        except Exception as exc:
            self.write(f"Duel Auto: could not refresh final package report: {exc}")

    def _duel_success(self, message: str) -> None:
        super()._duel_success(message)
        self._refresh_final_package()

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        super()._duel_fail(message, preserve_capture=preserve_capture)
        self._refresh_final_package()
