from __future__ import annotations

from app import Colors
from app_v160_runtime import App as BaseApp


class App(BaseApp):
    """1.6.1 review: guard unattended Frida attachment without changing the proven Duel replay path."""

    COLD_LAUNCH_ATTACH_SETTLE_MS = 20_000
    WARM_PROCESS_ATTACH_SETTLE_MS = 5_000
    PRE_SCRIPT_LOAD_SETTLE_SECONDS = 3.0

    def __init__(self) -> None:
        self._background_attach_guard_pending = False
        self._background_attach_guard_job: str | None = None
        super().__init__()

    def _begin_duel_attach(self) -> None:
        """Delay only unattended attachment so Unity/Mono is not injected during process bootstrap."""
        if not self.background_mode:
            super()._begin_duel_attach()
            return
        if not self.duel_running:
            return
        if self.capture.state.attached:
            super()._begin_duel_attach()
            return
        if self._background_attach_guard_pending:
            return

        delay_ms = (
            self.COLD_LAUNCH_ATTACH_SETTLE_MS
            if bool(getattr(self, "duel_launched_game", False))
            else self.WARM_PROCESS_ATTACH_SETTLE_MS
        )
        self._background_attach_guard_pending = True
        seconds = max(1, delay_ms // 1000)
        self._set_duel_progress("attach", f"Settling {seconds}s", Colors.ACCENT)
        self._set_duel_status(
            f"Background safety guard: Survival.exe is present. Waiting {seconds} seconds before Frida attachment "
            "so the Unity/Mono runtime can finish startup activity."
        )
        self._background_attach_guard_job = self.after(delay_ms, self._background_attach_after_settle)

    def _background_attach_after_settle(self) -> None:
        self._background_attach_guard_pending = False
        self._background_attach_guard_job = None
        if not self.duel_running:
            return
        if not self._survival_running():
            self._set_duel_status(
                "Background safety guard: Survival.exe changed or exited during the attach wait. Rechecking game state."
            )
            self.after(1000, self._ensure_game_running)
            return
        # Visible/manual runs leave this at zero. Only unattended mode separates the
        # native Frida session attach from loading the full Unity/SmartFox agent.
        self.capture.pre_script_load_delay_seconds = self.PRE_SCRIPT_LOAD_SETTLE_SECONDS
        self._set_duel_status(
            "Background safety guard passed. Attaching Frida, then allowing a 3-second recovery window before the full capture agent loads."
        )
        super()._begin_duel_attach()

    def _finish_background(self, success: bool, message: str) -> None:
        # A failed unattended attempt should never terminate Last Z as cleanup. That can
        # hide the original failure and makes a capture/injection problem look like a game crash.
        if not success and self.background_close_game:
            self.background_close_game = False
            message = f"{message} Last Z was intentionally left running because automatic game close is success-only in 1.6.1."
        super()._finish_background(success, message)

    def destroy(self) -> None:
        if self._background_attach_guard_job:
            try:
                self.after_cancel(self._background_attach_guard_job)
            except Exception:
                pass
            self._background_attach_guard_job = None
        super().destroy()
