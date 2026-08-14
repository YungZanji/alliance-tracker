from __future__ import annotations

import json
import queue
import time
from pathlib import Path
from typing import Any

import customtkinter as ctk

import app_v110 as v110
from app import Colors
from app_v100 import SEQUENCE_DIR
from app_v110_runtime import App as RuntimeCoreApp
from app_v123_runtime import App as BaseApp
from utils import SESSIONS_DIR, utc_now


LEGACY_OPTION = "Legacy Duel Auto (1.2.3)"
NO_SEQUENCES = "No saved Sequence Studio JSONs"
STARTUP_NONE = "None"
STARTUP_PCMASK = "PCMask before sequence"
TIMING_RECORDED = "Recorded JSON timing"
TIMING_FIXED = "Fixed 1.2 seconds"


class App(BaseApp):
    """1.2.4 review: common startup orchestration + selectable Sequence Studio JSON workflows."""

    def __init__(self) -> None:
        self.automation_sequence_mode = False
        self.automation_sequence_name = ""
        self.automation_sequence_path: Path | None = None
        self.automation_sequence_payload: dict[str, Any] = {}
        self.automation_sequence_steps: list[dict[str, Any]] = []
        self.automation_startup_step_count = 0
        self.automation_sequence_retry_limit = 4
        self.automation_settle_seconds = 10
        self.automation_timing_mode = TIMING_RECORDED
        self._automation_profiles: dict[str, Path] = {}
        super().__init__()

    def _duel_auto_page(self) -> None:
        super()._duel_auto_page()
        page = self.pages.get("duel_auto")
        if not page:
            return
        scroll = next((child for child in page.winfo_children() if isinstance(child, ctk.CTkScrollableFrame)), None)
        if scroll is None:
            return

        existing = list(scroll.winfo_children())
        panel = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        pack_kwargs: dict[str, Any] = {"fill": "x", "pady": (14, 0)}
        if len(existing) >= 2:
            pack_kwargs["before"] = existing[1]
        panel.pack(**pack_kwargs)

        ctk.CTkLabel(
            panel,
            text="AUTOMATION SEQUENCE",
            text_color=Colors.ACCENT,
            font=(self.font, 11, "bold"),
        ).pack(anchor="w", padx=17, pady=(15, 2))
        ctk.CTkLabel(
            panel,
            text="Run any Sequence Studio JSON after the common game startup steps.",
            text_color=Colors.TEXT,
            font=(self.font, 16, "bold"),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            panel,
            text=(
                "Saved Sequence Studio files stay under %LOCALAPPDATA%\\AllianceTracker\\control-sequences. "
                "Create or edit a path in Sequence Studio, save it, then choose it here. The common runner handles "
                "Survival.exe, hook attach, startup settling, optional PCMask, capture, packaging and Cloud Sync."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 10))

        select_row = ctk.CTkFrame(panel, fg_color="transparent")
        select_row.pack(fill="x", padx=17, pady=(0, 9))
        self.automation_sequence_menu = ctk.CTkComboBox(
            select_row,
            values=[LEGACY_OPTION],
            height=38,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 10),
            command=self._automation_sequence_changed,
        )
        self.automation_sequence_menu.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            select_row,
            text="Refresh JSONs",
            width=116,
            height=38,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.refresh_automation_sequences,
        ).pack(side="left", padx=(8, 0))

        options = ctk.CTkFrame(panel, fg_color="transparent")
        options.pack(fill="x", padx=17, pady=(0, 8))

        ctk.CTkLabel(options, text="Startup wait", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=0, column=0, sticky="w", padx=(0, 5))
        self.automation_settle_menu = ctk.CTkOptionMenu(
            options,
            values=["5 seconds", "10 seconds", "15 seconds"],
            width=130,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        self.automation_settle_menu.set(str(self.config.values.get("automationStartupWait") or "10 seconds"))
        self.automation_settle_menu.grid(row=0, column=1, sticky="w", padx=(0, 14))

        ctk.CTkLabel(options, text="Startup action", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=0, column=2, sticky="w", padx=(0, 5))
        self.automation_startup_menu = ctk.CTkOptionMenu(
            options,
            values=[STARTUP_NONE, STARTUP_PCMASK],
            width=190,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        startup_value = str(self.config.values.get("automationStartupAction") or STARTUP_PCMASK)
        if startup_value not in {STARTUP_NONE, STARTUP_PCMASK}:
            startup_value = STARTUP_PCMASK
        self.automation_startup_menu.set(startup_value)
        self.automation_startup_menu.grid(row=0, column=3, sticky="w", padx=(0, 14))

        ctk.CTkLabel(options, text="Timing", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=1, column=0, sticky="w", padx=(0, 5), pady=(8, 0))
        self.automation_timing_menu = ctk.CTkOptionMenu(
            options,
            values=[TIMING_RECORDED, TIMING_FIXED],
            width=175,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        timing_value = str(self.config.values.get("automationSequenceTiming") or TIMING_RECORDED)
        if timing_value not in {TIMING_RECORDED, TIMING_FIXED}:
            timing_value = TIMING_RECORDED
        self.automation_timing_menu.set(timing_value)
        self.automation_timing_menu.grid(row=1, column=1, sticky="w", padx=(0, 14), pady=(8, 0))

        ctk.CTkLabel(options, text="Retries / step", text_color=Colors.MUTED, font=(self.font, 9)).grid(row=1, column=2, sticky="w", padx=(0, 5), pady=(8, 0))
        self.automation_retry_menu = ctk.CTkOptionMenu(
            options,
            values=["3", "4", "5", "8"],
            width=80,
            fg_color=Colors.PANEL2,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        retry_value = str(self.config.values.get("automationSequenceRetries") or "4")
        if retry_value not in {"3", "4", "5", "8"}:
            retry_value = "4"
        self.automation_retry_menu.set(retry_value)
        self.automation_retry_menu.grid(row=1, column=3, sticky="w", pady=(8, 0))

        self.automation_sequence_status = ctk.CTkLabel(
            panel,
            text="Loading saved Sequence Studio JSONs...",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.automation_sequence_status.pack(anchor="w", padx=17, pady=(2, 14))

        self.refresh_automation_sequences()
        if hasattr(self, "duel_run_button"):
            self.duel_run_button.configure(text="RUN SELECTED AUTOMATION SEQUENCE")

    def refresh_automation_sequences(self) -> None:
        SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(SEQUENCE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        self._automation_profiles = {path.stem: path for path in files}
        values = [LEGACY_OPTION] + list(self._automation_profiles.keys())
        if not self._automation_profiles:
            values.append(NO_SEQUENCES)
        if not hasattr(self, "automation_sequence_menu"):
            return
        self.automation_sequence_menu.configure(values=values)
        saved = str(self.config.values.get("automationSequenceName") or "")
        selected = saved if saved in self._automation_profiles else (next(iter(self._automation_profiles), LEGACY_OPTION))
        self.automation_sequence_menu.set(selected)
        self._automation_sequence_changed(selected)

    def _automation_sequence_changed(self, value: str) -> None:
        value = str(value or "").strip()
        if value in self._automation_profiles:
            path = self._automation_profiles[value]
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                steps = data.get("steps") or []
                count = len([step for step in steps if isinstance(step, dict) and str(step.get("name") or "").strip()])
                timing = str(data.get("timingMode") or "Recorded timing")
                message = f"Selected {path.name}: {count} step(s), saved timing={timing}."
                color = Colors.SUCCESS if count else Colors.DANGER
            except Exception as exc:
                message = f"Could not read {path.name}: {exc}"
                color = Colors.DANGER
        elif value == LEGACY_OPTION:
            message = "Legacy mode keeps the current hard-coded 1.2.3 weekday/Sunday Duel behavior."
            color = Colors.MUTED
        else:
            message = "No saved Sequence Studio JSON is available yet. Save one in Sequence Studio, then press Refresh JSONs."
            color = Colors.DANGER
        if hasattr(self, "automation_sequence_status"):
            self.automation_sequence_status.configure(text=message, text_color=color)
        self.config.values["automationSequenceName"] = value if value in self._automation_profiles else ""
        self.config.save()

    def save_game_executable(self) -> None:
        super().save_game_executable()
        if hasattr(self, "automation_sequence_menu"):
            selected = self.automation_sequence_menu.get().strip()
            self.config.values["automationSequenceName"] = selected if selected in self._automation_profiles else ""
            self.config.values["automationStartupWait"] = self.automation_settle_menu.get()
            self.config.values["automationStartupAction"] = self.automation_startup_menu.get()
            self.config.values["automationSequenceTiming"] = self.automation_timing_menu.get()
            self.config.values["automationSequenceRetries"] = self.automation_retry_menu.get()
            self.config.save()

    def _load_selected_automation_sequence(self) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
        selected = self.automation_sequence_menu.get().strip()
        path = self._automation_profiles.get(selected)
        if path is None:
            raise ValueError("Choose a saved Sequence Studio JSON, or select Legacy Duel Auto.")
        data = json.loads(path.read_text(encoding="utf-8"))
        raw_steps = data.get("steps") or []
        if not isinstance(raw_steps, list):
            raise ValueError(f"{path.name} does not contain a steps list.")
        steps: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_steps, start=1):
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "").strip()
            if not name:
                continue
            try:
                delay_ms = max(0, min(20_000, int(raw.get("delayMs") or 0)))
            except (TypeError, ValueError):
                delay_ms = 0
            steps.append({
                "controlType": str(raw.get("controlType") or "Control"),
                "name": name,
                # Observation IDs are process-local. Automated runs intentionally use
                # the portable active GameObject name saved alongside every step.
                "replayKey": name,
                "delayMs": delay_ms,
                "optional": bool(raw.get("optional", False)),
                "sourceIndex": index,
            })
        if not steps:
            raise ValueError(f"{path.name} contains no replayable controls.")
        return selected, data, steps

    def _effective_custom_sequence(self, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = [dict(step) for step in steps]
        startup = self.automation_startup_menu.get() if hasattr(self, "automation_startup_menu") else STARTUP_PCMASK
        self.automation_startup_step_count = 0
        if startup == STARTUP_PCMASK:
            # If the trained JSON already begins with PCMask, promote it to the common
            # startup layer instead of clicking the same mask twice.
            if result and str(result[0].get("name") or "") == "PCMask":
                result.pop(0)
            result.insert(0, {
                "controlType": "Button",
                "name": "PCMask",
                "replayKey": "PCMask",
                "delayMs": 0,
                "optional": True,
                "startupAction": True,
            })
            self.automation_startup_step_count = 1
        return result

    def run_duel_sync(self) -> None:
        selected = self.automation_sequence_menu.get().strip() if hasattr(self, "automation_sequence_menu") else LEGACY_OPTION
        if selected == LEGACY_OPTION:
            self.automation_sequence_mode = False
            super().run_duel_sync()
            return
        if selected == NO_SEQUENCES or selected not in self._automation_profiles:
            self._set_duel_status("Choose a saved Sequence Studio JSON before starting the automation.", Colors.DANGER)
            return
        try:
            name, payload, steps = self._load_selected_automation_sequence()
        except Exception as exc:
            self._set_duel_status(f"Could not load selected automation JSON: {exc}", Colors.DANGER)
            return

        self.automation_sequence_mode = True
        self.automation_sequence_name = name
        self.automation_sequence_path = self._automation_profiles[name]
        self.automation_sequence_payload = payload
        self.automation_sequence_steps = self._effective_custom_sequence(steps)
        self.automation_timing_mode = self.automation_timing_menu.get()
        try:
            self.automation_sequence_retry_limit = int(self.automation_retry_menu.get())
        except (TypeError, ValueError):
            self.automation_sequence_retry_limit = 4
        try:
            self.automation_settle_seconds = int(self.automation_settle_menu.get().split()[0])
        except Exception:
            self.automation_settle_seconds = 10

        if not self.automation_sequence_steps:
            self._set_duel_status("The selected automation sequence is empty after startup settings were applied.", Colors.DANGER)
            return

        self.save_game_executable()
        self.duel_profile_kind = "sequence"
        self.duel_settle_started = False
        self._duel_generation += 1
        self._duel_trace_started = time.monotonic()
        v110.DEFAULT_DUEL_SEQUENCE = [dict(step) for step in self.automation_sequence_steps]
        v110.REQUIRED_RANK_LABELS = set()
        v110.App.run_duel_sync(self)
        if self.duel_running:
            self.duel_run_button.configure(state="disabled", text="AUTOMATION SEQUENCE RUNNING")
            self._set_duel_status(
                f"Selected Sequence Studio workflow: {name}. Common startup will run first, then {len(steps)} trained JSON step(s)."
            )

    def _active_sequence(self) -> list[dict[str, Any]]:
        if self.automation_sequence_mode:
            return self.automation_sequence_steps
        return super()._active_sequence()

    def _start_duel_capture(self) -> None:
        if not self.automation_sequence_mode:
            super()._start_duel_capture()
            return
        if not self.duel_running:
            return
        if not self.duel_settle_started:
            self.duel_settle_started = True
            self.duel_stage = "settling_city"
            self._duel_city_remaining = self.automation_settle_seconds
            self._set_duel_progress("capture", f"Startup settle: {self._duel_city_remaining}s", Colors.ACCENT)
            self._set_duel_status(
                f"Capture/replay hooks are ready. Waiting {self.automation_settle_seconds} seconds before the common startup action and selected JSON sequence."
            )
            self._automation_city_settle_tick()
            return
        self._start_custom_capture_session()

    def _automation_city_settle_tick(self) -> None:
        if not self.duel_running or not self.automation_sequence_mode or self.duel_stage != "settling_city":
            return
        if self._duel_city_remaining <= 0:
            self._set_duel_progress("capture", "Starting capture", Colors.ACCENT)
            self._set_duel_status("Startup settling complete. Starting capture and selected sequence now.")
            self._start_custom_capture_session()
            return
        self._set_duel_progress("capture", f"Startup settle: {self._duel_city_remaining}s", Colors.ACCENT)
        if self._duel_city_remaining in {15, 10, 5, 3, 2, 1}:
            self._append_duel_trace(f"Startup settling: {self._duel_city_remaining}s remaining")
        self._duel_city_remaining -= 1
        self.after(1000, self._automation_city_settle_tick)

    def _start_custom_capture_session(self) -> None:
        if not self.duel_running:
            return
        self.duel_city_deadline = time.monotonic() + 120.0
        self.duel_stage = "starting_capture"
        self._set_duel_progress("capture", "Starting", Colors.ACCENT)
        try:
            self.label.delete(0, "end")
            self.label.insert(0, f"Automation - {self.automation_sequence_name}")
            self.start()
        except Exception as exc:
            self._duel_fail(f"Could not start the automation capture session: {exc}")
            return
        if not self.session_id:
            self._duel_fail("Alliance Tracker did not create a capture session.")
            return
        self.duel_session_id = self.session_id
        self._write_duel_sequence_file()
        self._write_duel_run_report("running")
        self._set_duel_progress("capture", "Recording", Colors.SUCCESS)
        self._set_duel_progress("base", "Sequence running", Colors.ACCENT)
        self._set_duel_progress("weekly", "Sequence-controlled", Colors.MUTED)
        self._set_duel_progress("alliance", "Sequence-controlled", Colors.MUTED)
        self._set_duel_progress("return", "Sequence-controlled", Colors.MUTED)
        self._set_duel_status(f"Capture started. Replaying {self.automation_sequence_name}.json through the internal Unity controls.")
        self.duel_stage = "sequence"
        self.duel_step_index = 0
        self.after(250, self._queue_current_duel_step)

    def _delay_before_next_custom_step(self) -> float:
        next_index = self.duel_step_index + 1
        if next_index >= len(self.automation_sequence_steps):
            return 0.8
        if self.automation_timing_mode == TIMING_FIXED:
            return 1.2
        try:
            delay_ms = int(self.automation_sequence_steps[next_index].get("delayMs") or 0)
        except (TypeError, ValueError):
            delay_ms = 0
        # Keep recorded timing usable while avoiding a zero-delay burst.
        return max(0.35, min(20.0, delay_ms / 1000.0 if delay_ms else 0.35))

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if not self.automation_sequence_mode:
            super()._handle_duel_replay_result(data)
            return
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
            "source": "startup" if self.duel_step_index < self.automation_startup_step_count else "sequence-json",
        })
        self.duel_step_attempts = 0
        delay = self._delay_before_next_custom_step()
        self.duel_wait_kind = "settle-back"
        self.duel_step_deadline = time.monotonic() + delay
        self._set_duel_status(f"Replay succeeded: {name} via {method}. Waiting {delay:.2f}s before continuing.")
        self._schedule_duel_tick(200)

    def _retry_duel_step(self, reason: str) -> None:
        if not self.automation_sequence_mode:
            super()._retry_duel_step(reason)
            return
        if not self.duel_running:
            return
        sequence = self._active_sequence()
        step = sequence[self.duel_step_index] if 0 <= self.duel_step_index < len(sequence) else {}
        limit = max(1, self.automation_sequence_retry_limit)
        if self.duel_step_attempts >= limit:
            if bool(step.get("optional")):
                self.duel_step_results.append({
                    "index": self.duel_step_index + 1,
                    "name": self.duel_current_control,
                    "ok": True,
                    "skipped": True,
                    "reason": f"Optional step unavailable after {limit} attempts: {reason}",
                    "completedAt": utc_now(),
                })
                self._set_duel_status(f"Optional {self.duel_current_control} was unavailable after {limit} attempts. Continuing.")
                self._advance_duel_step()
                return
            self._duel_fail(
                f"Sequence {self.automation_sequence_name} failed at step {self.duel_step_index + 1}: "
                f"{self.duel_current_control} was unavailable after {limit} attempts. Last reason: {reason}"
            )
            return
        self._duel_generation += 1
        self.duel_wait_kind = "retry"
        self._set_duel_status(
            f"{self.duel_current_control} is not ready. Retrying in 1.2s ({self.duel_step_attempts + 1}/{limit}). Last reason: {reason}"
        )
        self.after(1200, self._queue_current_duel_step)

    def _advance_duel_step(self) -> None:
        if not self.automation_sequence_mode:
            super()._advance_duel_step()
            return
        if not self.duel_running:
            return
        self._duel_generation += 1
        completed = self.duel_step_index + 1
        total = len(self.automation_sequence_steps)
        self.duel_step_index += 1
        self.duel_current_control = ""
        self.duel_wait_kind = ""
        self.duel_step_attempts = 0
        self._set_duel_progress("base", f"Sequence {min(completed, total)}/{total}", Colors.ACCENT)
        if self.duel_step_index >= total:
            self._set_duel_status(f"Sequence complete: {total}/{total} controls succeeded or were explicitly optional. Packaging capture.")
            self.after(700, self._finish_duel_capture)
            return
        next_name = str(self.automation_sequence_steps[self.duel_step_index].get("name") or "next control")
        self._set_duel_status(f"Step {completed}/{total} complete. Queuing {next_name} next.")
        self.after(100, self._queue_current_duel_step)

    def _finish_duel_capture(self) -> None:
        if not self.automation_sequence_mode:
            super()._finish_duel_capture()
            return
        if not self.duel_running or not self.duel_session_id:
            return
        session_id = self.duel_session_id
        self.duel_stage = "packaging"
        self._set_duel_progress("verify", "Sequence complete", Colors.SUCCESS)
        self._set_duel_progress("package", "Packaging", Colors.ACCENT)
        self._set_duel_status("Selected JSON sequence completed. Stopping capture and packaging every normalized snapshot produced by the run...")
        try:
            self.capture.stop()
            while True:
                try:
                    event = self.capture.events.get_nowait()
                except queue.Empty:
                    break
                self.handle(event.kind, event.payload)
            self.store.stop_session(session_id)
            summary = self.store.summary(session_id)
            package = self.store.package(session_id)
        except Exception as exc:
            self._duel_fail(f"Could not stop/package the selected automation capture: {exc}", preserve_capture=False)
            return

        self.session_id = None
        self.duel_package = str(package)
        self.stop_button.configure(state="disabled")
        self.start_button.configure(state="normal")
        self.recording.set("Stopped", "Automation package ready")
        self.refresh_sessions()
        self._set_duel_progress("package", "Saved", Colors.SUCCESS)
        snapshots = self.store.snapshots_for_session(session_id)
        self._write_duel_run_report("packaged", {"captureSummary": summary, "snapshotCount": len(snapshots)})

        if not bool(self.duel_sync_switch.get()):
            self._set_duel_progress("cloud", "Skipped", Colors.MUTED)
            self._duel_success(
                f"{self.automation_sequence_name}.json completed and was packaged locally with {len(snapshots)} normalized snapshot(s). Cloud sync was disabled."
            )
            return
        if not snapshots:
            self._set_duel_progress("cloud", "No snapshots", Colors.MUTED)
            self._duel_success(
                f"{self.automation_sequence_name}.json completed and was packaged, but this run produced no normalized snapshots to upload."
            )
            return
        self._begin_duel_cloud_sync(session_id)

    def _duel_cloud_done(self, result: dict[str, Any], acknowledged: int) -> None:
        if not self.automation_sequence_mode:
            super()._duel_cloud_done(result, acknowledged)
            return
        if not self.duel_running:
            return
        self.duel_cloud_result = dict(result)
        accepted = int(result.get("accepted", acknowledged))
        duplicates = int(result.get("duplicates", 0))
        self._set_duel_progress("cloud", f"Synced ({accepted} new / {duplicates} existing)", Colors.SUCCESS)
        self.cloud_card.set("Connected", "Automation sequence sync succeeded")
        self._duel_success(
            f"{self.automation_sequence_name}.json complete. Cloud acknowledged {acknowledged} snapshot(s); {accepted} new, {duplicates} already present."
        )

    def _write_duel_sequence_file(self) -> None:
        if not self.automation_sequence_mode:
            super()._write_duel_sequence_file()
            return
        if not self.duel_session_id:
            return
        raw = SESSIONS_DIR / self.duel_session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 4,
            "name": self.automation_sequence_name,
            "sourceFile": self.automation_sequence_path.name if self.automation_sequence_path else "",
            "source": "Sequence Studio saved JSON",
            "startup": {
                "settleSeconds": self.automation_settle_seconds,
                "action": self.automation_startup_menu.get(),
            },
            "timingMode": self.automation_timing_mode,
            "retryLimit": self.automation_sequence_retry_limit,
            "sourceSequence": self.automation_sequence_payload,
            "effectiveSteps": [dict(step) for step in self.automation_sequence_steps],
        }
        (raw / "control-sequence.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        if not self.automation_sequence_mode:
            super()._write_duel_run_report(status, extra)
            return
        merged = {
            "automationMode": "sequence-studio-json",
            "sequenceName": self.automation_sequence_name,
            "sequenceFile": str(self.automation_sequence_path or ""),
            "startupSettleSeconds": self.automation_settle_seconds,
            "startupAction": self.automation_startup_menu.get() if hasattr(self, "automation_startup_menu") else STARTUP_NONE,
            "timingMode": self.automation_timing_mode,
            "retryLimit": self.automation_sequence_retry_limit,
            "effectiveStepCount": len(self.automation_sequence_steps),
        }
        if extra:
            merged.update(extra)
        v110.App._write_duel_run_report(self, status, merged)

    def _render_duel_report(self, final_status: str, message: str) -> None:
        if not self.automation_sequence_mode:
            super()._render_duel_report(final_status, message)
            return
        total = len(self.automation_sequence_steps)
        lines = [
            f"Status: {final_status}",
            f"Automation JSON: {self.automation_sequence_name or '-'}",
            f"Session: {self.duel_session_id or '-'}",
            f"Game launched by tracker: {'yes' if self.duel_launched_game else 'no'}",
            f"Successful/optional steps: {len(self.duel_step_results)}/{total}",
            f"Startup wait: {self.automation_settle_seconds}s",
            f"Startup action: {self.automation_startup_menu.get() if hasattr(self, 'automation_startup_menu') else '-'}",
            f"Timing: {self.automation_timing_mode}",
            f"Package: {self.duel_package or '-'}",
            "",
            message,
        ]
        self.duel_report.configure(state="normal")
        self.duel_report.delete("1.0", "end")
        self.duel_report.insert("1.0", "\n".join(lines) + "\n")
        self.duel_report.configure(state="disabled")

    def _duel_success(self, message: str) -> None:
        super()._duel_success(message)
        if hasattr(self, "duel_run_button"):
            self.duel_run_button.configure(text="RUN SELECTED AUTOMATION SEQUENCE")

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        super()._duel_fail(message, preserve_capture=preserve_capture)
        if hasattr(self, "duel_run_button"):
            self.duel_run_button.configure(text="RUN SELECTED AUTOMATION SEQUENCE")
