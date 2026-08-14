from __future__ import annotations

import time
from typing import Any

from app import Colors
from app_v120 import App as BaseApp
from utils import utc_now


class App(BaseApp):
    """Hardened 1.2 Sunday-aware runtime with serialized timers and visible pacing."""

    CITY_SETTLE_SECONDS = 10
    INTER_STEP_GAP_MS = 1200
    RESPONSE_SETTLE_SECONDS = 1.5
    SUNDAY_SETTLE_SECONDS = {
        "PCMask": 3.0,
        "UIMain_icon_AlCompete": 5.0,
        "UIPlayerHead": 4.0,
        "CheckBox": 4.0,
    }
    WEEKDAY_SETTLE_SECONDS = {
        "PCMask": 3.0,
        "CloseBtn": 2.0,
    }

    def __init__(self) -> None:
        self._duel_generation = 0
        self._duel_trace_started = 0.0
        self._duel_city_remaining = 0
        super().__init__()

    def run_duel_sync(self) -> None:
        # Invalidate any timer callback left over from an earlier run before resetting.
        self._duel_generation += 1
        self._duel_trace_started = time.monotonic()
        super().run_duel_sync()

    def _append_duel_trace(self, message: str) -> None:
        if not self.duel_running or not hasattr(self, "duel_report"):
            return
        elapsed = max(0.0, time.monotonic() - self._duel_trace_started)
        try:
            self.duel_report.configure(state="normal")
            self.duel_report.insert("end", f"[+{elapsed:05.1f}s] {message}\n")
            self.duel_report.see("end")
            self.duel_report.configure(state="disabled")
        except Exception:
            pass

    def _set_duel_status(self, text: str, color: Any = None) -> None:
        super()._set_duel_status(text, color)
        self._append_duel_trace(text)

    def _start_duel_capture(self) -> None:
        if not self.duel_running:
            return
        if self.duel_settle_started:
            # This path is only used if a caller intentionally asks to start again.
            super()._start_duel_capture()
            return

        self.duel_settle_started = True
        self.duel_stage = "settling_city"
        self._duel_city_remaining = self.CITY_SETTLE_SECONDS
        self._set_duel_progress("capture", f"City settle: {self._duel_city_remaining}s", Colors.ACCENT)
        self._set_duel_status(
            "Capture hooks are ready. Starting a visible 10-second city/startup settling countdown before any game control is replayed."
        )
        self._city_settle_tick()

    def _city_settle_tick(self) -> None:
        if not self.duel_running or self.duel_stage != "settling_city":
            return
        if self._duel_city_remaining <= 0:
            self._set_duel_progress("capture", "Starting capture", Colors.ACCENT)
            self._set_duel_status("10-second city settling period complete. Starting capture now.")
            super()._start_duel_capture_after_settle()
            return

        self._set_duel_progress("capture", f"City settle: {self._duel_city_remaining}s", Colors.ACCENT)
        if self._duel_city_remaining in {10, 5, 3, 2, 1}:
            self._append_duel_trace(f"City/startup settling: {self._duel_city_remaining}s remaining")
        self._duel_city_remaining -= 1
        self.after(1000, self._city_settle_tick)

    def _schedule_duel_tick(self, delay_ms: int, generation: int | None = None) -> None:
        token = self._duel_generation if generation is None else generation
        self.after(delay_ms, lambda g=token: self._duel_sequence_tick(g))

    def _queue_current_duel_step(self) -> None:
        sequence = self._active_sequence()
        if not self.duel_running or not (0 <= self.duel_step_index < len(sequence)):
            return

        # Every queued replay gets a generation. Any polling callback from a previous
        # control/attempt becomes harmless as soon as this value changes.
        self._duel_generation += 1
        generation = self._duel_generation
        step = sequence[self.duel_step_index]
        name = str(step["name"])
        self.duel_current_control = name
        self.duel_step_attempts += 1
        self.duel_wait_kind = "replay"
        self.duel_step_deadline = time.monotonic() + 20.0
        self.duel_wait_baseline = {
            "rank0": self._current_rank_count(0),
            "rank1": self._current_rank_count(1),
            "rank2": self._current_rank_count(2),
            "rank3": self._current_rank_count(3),
            "rankTotal": sum(self.duel_rank_counts.values()),
            "season": 1 if self.duel_seen_season else 0,
        }

        script = getattr(self.capture.state, "script", None)
        if script is None:
            self._duel_fail("The capture script detached before the control sequence finished.")
            return
        try:
            script.post({"type": "automation-replay-control", "payload": {"name": name}})
        except Exception as exc:
            self._duel_fail(f"Could not queue {name}: {exc}")
            return

        total = len(sequence)
        self._set_duel_status(
            f"Step {self.duel_step_index + 1}/{total} · attempt {self.duel_step_attempts}: replaying {name}."
        )
        self._schedule_duel_tick(350, generation)

    def _duel_sequence_tick(self, generation: int | None = None) -> None:
        if not self.duel_running or self.duel_stage != "sequence":
            return
        if generation is not None and generation != self._duel_generation:
            return
        if not self.duel_current_control or not self.duel_wait_kind:
            return
        if self.duel_wait_kind == "retry":
            return

        now = time.monotonic()
        if self.duel_wait_kind == "data" and self._duel_data_condition_met():
            self.duel_wait_kind = "post-data-settle"
            self.duel_step_deadline = now + self.RESPONSE_SETTLE_SECONDS
            self._set_duel_status(
                f"Expected data arrived for {self.duel_current_control}. Waiting {self.RESPONSE_SETTLE_SECONDS:.1f}s for the UI to settle before advancing."
            )
            self._schedule_duel_tick(250, generation)
            return

        if self.duel_wait_kind in {"settle-close", "settle-back", "post-data-settle"}:
            if now >= self.duel_step_deadline:
                self._advance_duel_step()
                return
            self._schedule_duel_tick(250, generation)
            return

        if now >= self.duel_step_deadline:
            if self.duel_wait_kind == "replay":
                self._retry_duel_step(f"No replay result arrived for {self.duel_current_control} within 20 seconds.")
                return
            self._duel_fail(self._duel_timeout_message())
            return

        self._schedule_duel_tick(250, generation)

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if not self.duel_running or self.duel_stage != "sequence" or self.duel_wait_kind != "replay":
            return
        name = str(data.get("name") or "")
        if name != self.duel_current_control:
            return
        if not data.get("ok"):
            self._retry_duel_step(str(data.get("error") or "replay failed"))
            return

        method = str(data.get("method") or "unknown method")
        self.duel_step_results.append({
            "index": self.duel_step_index + 1,
            "name": name,
            "ok": True,
            "method": data.get("method"),
            "completedAt": utc_now(),
        })
        self.duel_step_attempts = 0
        self._set_duel_status(f"Replay succeeded: {name} via {method}.")

        if self.duel_profile_kind == "sunday":
            if name == "Toggle3":
                self.duel_wait_kind = "data"
                self.duel_step_deadline = time.monotonic() + 30.0
                self._set_duel_status(
                    "Sunday My Alliance control succeeded. Waiting up to 30s for a fresh weekly own-alliance ranking response with rows."
                )
                if self._duel_data_condition_met():
                    self.duel_wait_kind = "post-data-settle"
                    self.duel_step_deadline = time.monotonic() + self.RESPONSE_SETTLE_SECONDS
                self._schedule_duel_tick(250)
                return

            settle = self.SUNDAY_SETTLE_SECONDS.get(name, 3.0)
            self.duel_wait_kind = "settle-back"
            self.duel_step_deadline = time.monotonic() + settle
            self._set_duel_status(f"{name} completed. Waiting {settle:.1f}s before the next Sunday control.")
            self._schedule_duel_tick(250)
            return

        # Monday-Saturday path: wait for the expected decoded response after every
        # data-sensitive control, then allow the UI an extra settling interval.
        if name in {"UIMain_icon_AlCompete", "rankBtn", "Toggle2", "Toggle3", "Toggle1"}:
            timeout = 30.0 if name == "UIMain_icon_AlCompete" else 22.0
            self.duel_wait_kind = "data"
            self.duel_step_deadline = time.monotonic() + timeout
            self._set_duel_status(f"{name} succeeded. Waiting up to {timeout:.0f}s for its expected decoded response.")
            if self._duel_data_condition_met():
                self.duel_wait_kind = "post-data-settle"
                self.duel_step_deadline = time.monotonic() + self.RESPONSE_SETTLE_SECONDS
            self._schedule_duel_tick(250)
            return

        settle = self.WEEKDAY_SETTLE_SECONDS.get(name, 2.0)
        self.duel_wait_kind = "settle-close" if name == "CloseBtn" else "settle-back"
        self.duel_step_deadline = time.monotonic() + settle
        self._set_duel_status(f"{name} completed. Waiting {settle:.1f}s before the next control.")
        self._schedule_duel_tick(250)

    def _retry_duel_step(self, reason: str) -> None:
        if not self.duel_running:
            return
        if (
            self.duel_step_index == 0
            and self.duel_current_control == "PCMask"
            and self.duel_step_attempts >= 3
        ):
            self.duel_step_results.append({
                "index": 1,
                "name": "PCMask",
                "ok": True,
                "skipped": True,
                "reason": "No startup overlay mask was active after three attempts.",
                "completedAt": utc_now(),
            })
            self._set_duel_status(
                "No active startup PCMask was found after three attempts. Treating the splash as already closed and continuing."
            )
            self._advance_duel_step()
            return

        if self.duel_step_attempts >= 8:
            self._duel_fail(
                f"{self.duel_current_control} failed after {self.duel_step_attempts} attempts. Last reason: {reason}"
            )
            return

        # Invalidate every outstanding polling callback for the failed attempt.
        self._duel_generation += 1
        self.duel_wait_kind = "retry"
        self._set_duel_status(
            f"{self.duel_current_control} is not ready yet. {reason} Retrying in 1.2s ({self.duel_step_attempts + 1}/8)."
        )
        self.after(1200, self._queue_current_duel_step)

    def _advance_duel_step(self) -> None:
        if not self.duel_running:
            return

        # Invalidate all still-pending tick callbacks before changing the active control.
        self._duel_generation += 1
        name = self.duel_current_control
        last_index = len(self._active_sequence()) - 1

        if self.duel_profile_kind == "sunday":
            if name == "UIMain_icon_AlCompete":
                self._set_duel_progress("base", "Sunday Duel opened", Colors.SUCCESS)
            elif name == "UIPlayerHead":
                self._set_duel_progress("weekly", "Finished-week view", Colors.ACCENT)
            elif name == "CheckBox":
                self._set_duel_progress("weekly", "League selected", Colors.SUCCESS)
            elif name == "Toggle3":
                rows = int(self.duel_rank_rows.get(2, 0))
                self._set_duel_progress("alliance", f"Captured ({rows})", Colors.SUCCESS)
                self._set_duel_progress("return", "Not required", Colors.MUTED)
        else:
            if name == "UIMain_icon_AlCompete":
                self._set_duel_progress("base", "Captured", Colors.SUCCESS)
            elif name == "Toggle2":
                self._set_duel_progress("weekly", "Captured", Colors.SUCCESS)
            elif name == "Toggle3":
                rows = int(self.duel_rank_rows.get(2, 0))
                self._set_duel_progress("alliance", f"Captured ({rows})", Colors.SUCCESS)
            elif name == "Toggle1":
                self._set_duel_progress("return", "Closing", Colors.ACCENT)
            elif name == "PCMask" and self.duel_step_index == last_index:
                self._set_duel_progress("return", "Returned", Colors.SUCCESS)

        completed_index = self.duel_step_index + 1
        total = len(self._active_sequence())
        self.duel_step_index += 1
        self.duel_current_control = ""
        self.duel_wait_kind = ""
        self.duel_step_attempts = 0

        if self.duel_step_index >= total:
            self._set_duel_status(f"Step {completed_index}/{total} complete. Sequence finished; preparing verification/package.")
            self.after(self.INTER_STEP_GAP_MS, self._finish_duel_capture)
            return

        next_name = str(self._active_sequence()[self.duel_step_index]["name"])
        self._set_duel_status(
            f"Step {completed_index}/{total} complete. Waiting {self.INTER_STEP_GAP_MS / 1000:.1f}s before {next_name}."
        )
        self.after(self.INTER_STEP_GAP_MS, self._queue_current_duel_step)

    def _duel_timeout_message(self) -> str:
        name = self.duel_current_control
        if not name:
            return (
                "The automation timer reached a stale state with no active control. "
                "This should be prevented by the 1.2.1 serialized timer guard."
            )
        base = super()._duel_timeout_message()
        return f"{base} [control={name}; wait={self.duel_wait_kind}]"

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        pacing = {
            "serializedTimerGeneration": self._duel_generation,
            "startupSettleSeconds": self.CITY_SETTLE_SECONDS,
            "interStepGapMs": self.INTER_STEP_GAP_MS,
            "responseSettleSeconds": self.RESPONSE_SETTLE_SECONDS,
            "sundaySettles": dict(self.SUNDAY_SETTLE_SECONDS),
        }
        merged = {"pacing": pacing}
        if extra:
            merged.update(extra)
        super()._write_duel_run_report(status, merged)

    def _render_duel_report(self, final_status: str, message: str) -> None:
        total = len(self._active_sequence())
        last_step = self.duel_step_results[-1].get("name") if self.duel_step_results else "-"
        lines = [
            f"Status: {final_status}",
            f"Profile: {self.duel_profile_kind}",
            f"Session: {self.duel_session_id or '-'}",
            f"Stage: {self.duel_stage}",
            f"Last successful control: {last_step}",
            f"Active control at finish: {self.duel_current_control or '-'}",
            f"Wait state at finish: {self.duel_wait_kind or '-'}",
            f"Game launched by tracker: {'yes' if self.duel_launched_game else 'no'}",
            f"Successful replay steps: {len(self.duel_step_results)}/{total}",
            f"Season observed: {'yes' if self.duel_seen_season else 'no'}",
            "Rank responses: " + ", ".join(f"type {k}={v}" for k, v in sorted(self.duel_rank_counts.items())),
            "Rank rows: " + ", ".join(f"type {k}={v}" for k, v in sorted(self.duel_rank_rows.items())),
            f"Package: {self.duel_package or '-'}",
            "",
            message,
        ]
        self.duel_report.configure(state="normal")
        self.duel_report.delete("1.0", "end")
        self.duel_report.insert("1.0", "\n".join(lines) + "\n")
        self.duel_report.configure(state="disabled")
