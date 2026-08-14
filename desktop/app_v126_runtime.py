from __future__ import annotations

import time
from typing import Any

from app import Colors
from app_v125_runtime import App as BaseApp


class App(BaseApp):
    """1.2.7 review: fresh-session typed component replay with availability waits."""

    CONTROL_APPEAR_TIMEOUT_SECONDS = 20.0
    CONTROL_APPEAR_POLL_MS = 750

    def __init__(self) -> None:
        self.automation_control_wait_name = ""
        self.automation_control_wait_started = 0.0
        self.automation_control_wait_deadline = 0.0
        self.automation_control_wait_polls = 0
        self.automation_last_resolver_error = ""
        super().__init__()

    def run_duel_sync(self) -> None:
        self._reset_control_availability_wait()
        super().run_duel_sync()

    def _reset_control_availability_wait(self) -> None:
        self.automation_control_wait_name = ""
        self.automation_control_wait_started = 0.0
        self.automation_control_wait_deadline = 0.0
        self.automation_control_wait_polls = 0
        self.automation_last_resolver_error = ""

    def _queue_current_duel_step(self) -> None:
        if not self.automation_sequence_mode:
            super()._queue_current_duel_step()
            return

        sequence = self._active_sequence()
        if not self.duel_running or not (0 <= self.duel_step_index < len(sequence)):
            return

        # Generic Sequence Studio replay now sends BOTH the portable GameObject name
        # and the recorded Unity control type. The Frida side can therefore resolve
        # "Toggle named Toggle3" instead of accepting the first GameObject called
        # Toggle3, which is ambiguous in Last Z.
        self._duel_generation += 1
        generation = self._duel_generation
        step = sequence[self.duel_step_index]
        name = str(step.get("name") or "").strip()
        control_type = str(step.get("controlType") or "Control").strip()
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
            self._duel_fail("The capture script detached before the selected sequence finished.")
            return
        try:
            script.post({
                "type": "automation-replay-control-v2",
                "payload": {"name": name, "controlType": control_type},
            })
        except Exception as exc:
            self._duel_fail(f"Could not queue {control_type} {name}: {exc}")
            return

        total = len(sequence)
        self._set_duel_status(
            f"Step {self.duel_step_index + 1}/{total} · attempt {self.duel_step_attempts}: "
            f"resolving {control_type} {name}."
        )
        self._schedule_duel_tick(350, generation)

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if (
            self.automation_sequence_mode
            and self.duel_running
            and self.duel_stage == "sequence"
            and self.duel_wait_kind == "replay"
            and str(data.get("name") or "") == self.duel_current_control
        ):
            if bool(data.get("ok")):
                self._reset_control_availability_wait()
            elif bool(data.get("availabilityFailure")):
                self._wait_for_dynamic_control(str(data.get("error") or "control is not active yet"))
                return
        super()._handle_duel_replay_result(data)

    def _wait_for_dynamic_control(self, reason: str) -> None:
        if not self.duel_running:
            return
        name = self.duel_current_control
        now = time.monotonic()
        if self.automation_control_wait_name != name or self.automation_control_wait_deadline <= 0:
            self.automation_control_wait_name = name
            self.automation_control_wait_started = now
            self.automation_control_wait_deadline = now + self.CONTROL_APPEAR_TIMEOUT_SECONDS
            self.automation_control_wait_polls = 0
        self.automation_control_wait_polls += 1
        self.automation_last_resolver_error = reason

        # A lookup that found no usable component never invoked the Button/Toggle, so
        # it should not consume the operator's real invocation retry budget.
        self.duel_step_attempts = max(0, self.duel_step_attempts - 1)

        if now >= self.automation_control_wait_deadline:
            elapsed = max(0.0, now - self.automation_control_wait_started)
            self._duel_fail(
                f"Sequence {self.automation_sequence_name} could not continue at step {self.duel_step_index + 1}: "
                f"{name} never became available during a {elapsed:.1f}s fresh-UI wait. "
                f"Last resolver result: {reason} The 1.2.7 resolver searches the recorded component type first; "
                "if this still fails, the next diagnostic is the component candidate count rather than only the GameObject name."
            )
            return

        remaining = max(0.0, self.automation_control_wait_deadline - now)
        self._duel_generation += 1
        self.duel_wait_kind = "availability"
        self._set_duel_status(
            f"Waiting for {name} to expose the recorded Unity component. {remaining:.1f}s remain. Resolver: {reason}"
        )
        self.after(self.CONTROL_APPEAR_POLL_MS, self._queue_current_duel_step)

    def _advance_duel_step(self) -> None:
        if self.automation_sequence_mode:
            self._reset_control_availability_wait()
        super()._advance_duel_step()

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        merged = dict(extra or {})
        if self.automation_sequence_mode:
            merged.update({
                "typedReplayProtocol": 2,
                "controlIdentity": "recorded controlType + GameObject name",
                "dynamicControlWaitSeconds": self.CONTROL_APPEAR_TIMEOUT_SECONDS,
                "lastAvailabilityControl": self.automation_control_wait_name or None,
                "lastAvailabilityPolls": self.automation_control_wait_polls,
                "lastResolverError": self.automation_last_resolver_error or None,
            })
        super()._write_duel_run_report(status, merged)
