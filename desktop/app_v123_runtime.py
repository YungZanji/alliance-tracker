from __future__ import annotations

import time
from typing import Any

from app_v120_runtime import App as CoreApp
from app_v122_runtime import App as AdaptiveApp


class App(AdaptiveApp):
    """1.2.3 Sunday Auto: deterministic Early-first attempt with Late fallback."""

    EARLY_FAILURE_LIMIT = 4
    LATE_FAILURE_LIMIT = 4

    def __init__(self) -> None:
        self.duel_sunday_fallback_used = False
        super().__init__()

    def _profile_hint(self, mode: str) -> str:
        if mode == "Sunday Auto (Early → Late)":
            return (
                "Sunday Auto always tries Early / First View first. If an Early control fails 4 times "
                "or its My Alliance roster never arrives, the tracker restarts using Late / Already Viewed."
            )
        return super()._profile_hint(mode)

    def _resolve_profile(self) -> str:
        profile = super()._resolve_profile()
        self.duel_sunday_fallback_used = False
        if profile == "sunday" and self.duel_sunday_mode == "auto":
            self.duel_sunday_branch = "early"
            self.duel_sunday_branch_reason = "Sunday Auto always tries Early first."
        return profile

    def run_duel_sync(self) -> None:
        super().run_duel_sync()
        if not self.duel_running:
            return
        if self.duel_profile_kind == "sunday" and self.duel_sunday_mode == "auto":
            self._set_duel_status(
                "Sunday Auto: trying Early / First View first. If an Early-only step fails 4 times, the tracker will restart with Late / Already Viewed."
            )

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        """Use the hardened core replay handler without the 1.2.2 UI probe."""
        name = str(data.get("name") or "")
        ok = bool(data.get("ok"))
        CoreApp._handle_duel_replay_result(self, data)
        if not self.duel_running or not ok:
            return

        # Preserve the deliberately slower pacing for the Late Sunday recording.
        if self._is_late_sunday():
            if name == "rankBtn" and self.duel_wait_kind in {"settle-back", "settle-close"}:
                self.duel_wait_kind = "settle-back"
                self.duel_step_deadline = time.monotonic() + self.LATE_RANKINGS_SETTLE_SECONDS
                self._set_duel_status(
                    f"Late Sunday Rankings opened. Waiting {self.LATE_RANKINGS_SETTLE_SECONDS:.1f}s before switching to My Alliance."
                )
            elif name == "CloseBtn" and self.duel_wait_kind in {"settle-back", "settle-close"}:
                self.duel_wait_kind = "settle-close"
                self.duel_step_deadline = time.monotonic() + self.LATE_CLOSE_SETTLE_SECONDS
                self._set_duel_status(
                    f"Late Sunday rankings closed. Waiting {self.LATE_CLOSE_SETTLE_SECONDS:.1f}s for the UI to settle."
                )

    def _duel_sequence_tick(self, generation: int | None = None) -> None:
        if not self.duel_running or self.duel_stage != "sequence":
            return
        if generation is not None and generation != self._duel_generation:
            return

        # Late Sunday gets a little extra settling time after the fresh My Alliance
        # response before the close button is replayed.
        if (
            self._is_late_sunday()
            and self.duel_current_control == "Toggle3"
            and self.duel_wait_kind == "data"
            and self._duel_data_condition_met()
        ):
            self.duel_wait_kind = "post-data-settle"
            self.duel_step_deadline = time.monotonic() + self.LATE_ROSTER_SETTLE_SECONDS
            self._set_duel_status(
                f"Late Sunday My Alliance roster arrived. Waiting {self.LATE_ROSTER_SETTLE_SECONDS:.1f}s before closing the rankings UI."
            )
            self._schedule_duel_tick(250, generation)
            return

        # If Early successfully clicked Toggle3 but the expected fresh roster never
        # arrives, the first method is considered failed and Late is tried from scratch.
        if (
            self._is_sunday_auto()
            and self.duel_sunday_branch == "early"
            and not self.duel_sunday_fallback_used
            and self.duel_current_control == "Toggle3"
            and self.duel_wait_kind == "data"
            and time.monotonic() >= self.duel_step_deadline
        ):
            self._restart_as_late(
                "Early Sunday reached My Alliance, but no fresh weekly own-alliance roster arrived before timeout."
            )
            return

        CoreApp._duel_sequence_tick(self, generation)

    def _retry_duel_step(self, reason: str) -> None:
        if not self.duel_running:
            return

        # Keep the existing best-effort startup mask behavior. A missing PCMask does
        # not mean the Sunday layout is wrong; it usually means there was no splash.
        if self.duel_step_index == 0 and self.duel_current_control == "PCMask":
            CoreApp._retry_duel_step(self, reason)
            return

        if self._is_sunday_auto() and self.duel_sunday_branch == "early" and not self.duel_sunday_fallback_used:
            if self.duel_step_attempts >= self.EARLY_FAILURE_LIMIT:
                self._restart_as_late(
                    f"Early Sunday control {self.duel_current_control} failed {self.duel_step_attempts} times. Last reason: {reason}"
                )
                return

        if self._is_sunday_auto() and self.duel_sunday_branch == "late":
            if self.duel_step_attempts >= self.LATE_FAILURE_LIMIT:
                self._duel_fail(
                    f"Late Sunday fallback also failed: {self.duel_current_control} failed after "
                    f"{self.duel_step_attempts} attempts. Last reason: {reason}"
                )
                return

        CoreApp._retry_duel_step(self, reason)

    def _restart_as_late(self, reason: str) -> None:
        if not self.duel_running or self.duel_sunday_fallback_used:
            return

        self.duel_sunday_fallback_used = True
        self.duel_sunday_branch = "late"
        self.duel_sunday_branch_reason = "Early-first fallback: " + reason

        # Invalidate all callbacks from the Early attempt and restart the Late
        # recording from step 1. Its first PCMask is useful as a best-effort way to
        # unwind any Early UI that may have partially opened before the failure.
        self._duel_generation += 1
        self.duel_step_index = 0
        self.duel_step_attempts = 0
        self.duel_current_control = ""
        self.duel_wait_kind = ""
        self.duel_step_deadline = 0.0

        self._set_duel_status(
            f"Sunday Early method failed. {reason} Restarting with Sunday Late / Already Viewed from PCMask."
        )
        self._write_duel_sequence_file()
        self.after(self.INTER_STEP_GAP_MS, self._queue_current_duel_step)

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        merged = dict(extra or {})
        merged.update({
            "sundayStrategy": "early-first-then-late",
            "earlyFailureLimit": self.EARLY_FAILURE_LIMIT,
            "lateFailureLimit": self.LATE_FAILURE_LIMIT,
            "sundayFallbackUsed": self.duel_sunday_fallback_used,
        })
        super()._write_duel_run_report(status, merged)
