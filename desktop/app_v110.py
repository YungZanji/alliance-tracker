from __future__ import annotations

import json
import os
import queue
import threading
import time
from pathlib import Path
from tkinter import filedialog
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v100 import App as BaseApp
from cloud import CloudClient
from utils import SESSIONS_DIR, utc_now


DEFAULT_DUEL_SEQUENCE = [
    {"controlType": "Button", "name": "UIMain_icon_AlCompete", "replayKey": "UIMain_icon_AlCompete", "delayMs": 0},
    {"controlType": "Button", "name": "rankBtn", "replayKey": "rankBtn", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle2", "replayKey": "Toggle2", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle3", "replayKey": "Toggle3", "delayMs": 0},
    {"controlType": "Toggle", "name": "Toggle1", "replayKey": "Toggle1", "delayMs": 0},
    {"controlType": "Button", "name": "CloseBtn", "replayKey": "CloseBtn", "delayMs": 0},
    {"controlType": "Button", "name": "PCMask", "replayKey": "PCMask", "delayMs": 0},
]

REQUIRED_RANK_LABELS = {
    "current_day_combined",
    "weekly_combined",
    "weekly_own_alliance",
    "completed_days",
}


class App(BaseApp):
    """Alliance Tracker 1.1 automated Alliance Duel collection and sync review."""

    def __init__(self) -> None:
        self.duel_running = False
        self.duel_cancelled = False
        self.duel_stage = "idle"
        self.duel_started_at = ""
        self.duel_launched_game = False
        self.duel_process_deadline = 0.0
        self.duel_attach_deadline = 0.0
        self.duel_step_index = -1
        self.duel_step_attempts = 0
        self.duel_current_control = ""
        self.duel_step_deadline = 0.0
        self.duel_wait_kind = ""
        self.duel_wait_baseline: dict[str, int] = {}
        self.duel_seen_season = False
        self.duel_rank_counts: dict[int, int] = {}
        self.duel_rank_rows: dict[int, int] = {}
        self.duel_step_results: list[dict[str, Any]] = []
        self.duel_session_id: str | None = None
        self.duel_package: str = ""
        self.duel_cloud_result: dict[str, Any] | None = None
        self.duel_error: str = ""
        super().__init__()

    def _layout(self) -> None:
        super()._layout()
        self._duel_auto_page()

        side = next(iter(self.nav.values())).master
        auto_nav = ctk.CTkButton(
            side,
            text="Duel Auto Sync",
            anchor="w",
            height=43,
            corner_radius=10,
            fg_color="transparent",
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 13, "bold"),
            command=lambda: self.show("duel_auto"),
        )
        auto_nav.grid(row=8, column=0, sticky="new", padx=11, pady=3)
        self.nav["duel_auto"] = auto_nav

    def _duel_auto_page(self) -> None:
        page = self.page(
            "duel_auto",
            "Alliance Duel Auto Sync",
            "Launch or use Last Z, attach, collect the proven Alliance Duel sequence, package it, and sync it in one run.",
        )
        scroll = ctk.CTkScrollableFrame(page, fg_color="transparent", corner_radius=0)
        scroll.pack(fill="both", expand=True)

        setup = ctk.CTkFrame(scroll, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        setup.pack(fill="x")
        ctk.CTkLabel(setup, text="GAME LAUNCH", text_color=Colors.ACCENT, font=(self.font, 11, "bold")).pack(anchor="w", padx=17, pady=(16, 2))
        ctk.CTkLabel(
            setup,
            text="Choose the executable that should start Last Z when it is not already running.",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            setup,
            text=(
                "This can be Last Z.exe, Launcher.exe, or Survival.exe. The tracker always waits for the actual "
                "Survival.exe game process before attaching, so launcher executables are supported."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 9))

        path_row = ctk.CTkFrame(setup, fg_color="transparent")
        path_row.pack(fill="x", padx=17, pady=(0, 8))
        self.duel_game_path = ctk.CTkEntry(path_row, height=39, fg_color=Colors.PANEL2, border_color=Colors.BORDER, font=(self.font, 10))
        self.duel_game_path.pack(side="left", fill="x", expand=True)
        self.duel_game_path.insert(0, str(self.config.values.get("gameExecutable") or ""))
        ctk.CTkButton(
            path_row,
            text="Browse",
            width=90,
            height=39,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            command=self.browse_game_executable,
        ).pack(side="left", padx=(8, 0))
        ctk.CTkButton(
            path_row,
            text="Save",
            width=74,
            height=39,
            fg_color="transparent",
            border_width=1,
            border_color=Colors.BORDER,
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 10, "bold"),
            command=self.save_game_executable,
        ).pack(side="left", padx=(8, 0))

        option_row = ctk.CTkFrame(setup, fg_color="transparent")
        option_row.pack(fill="x", padx=17, pady=(0, 15))
        self.duel_sync_switch = ctk.CTkSwitch(
            option_row,
            text="Sync to WDZ Cloudflare after a verified capture",
            text_color=Colors.MUTED,
            font=(self.font, 10),
        )
        self.duel_sync_switch.pack(side="left")
        if bool(self.config.values.get("autoSyncAfterDuel", True)):
            self.duel_sync_switch.select()

        run_panel = ctk.CTkFrame(scroll, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        run_panel.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(run_panel, text="AUTOMATED RUN", text_color=Colors.ACCENT, font=(self.font, 11, "bold")).pack(anchor="w", padx=17, pady=(16, 2))
        ctk.CTkLabel(
            run_panel,
            text="One button from launch to cloud sync",
            text_color=Colors.TEXT,
            font=(self.font, 20, "bold"),
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            run_panel,
            text=(
                "The sequence is the successful seven-step path already trained against Last Z. Data-sensitive steps wait for the "
                "expected decoded response instead of relying only on recorded sleep times. Do not touch Last Z while a run is active."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 12))

        self.duel_run_button = ctk.CTkButton(
            run_panel,
            text="RUN ALLIANCE DUEL SYNC",
            height=54,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 13, "bold"),
            command=self.run_duel_sync,
        )
        self.duel_run_button.pack(fill="x", padx=17, pady=(0, 9))
        self.duel_stop_button = ctk.CTkButton(
            run_panel,
            text="Stop automated run",
            height=36,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            state="disabled",
            command=self.cancel_duel_sync,
        )
        self.duel_stop_button.pack(anchor="w", padx=17, pady=(0, 13))

        self.duel_status = ctk.CTkLabel(
            run_panel,
            text="Ready. Last Z may be closed or already running.",
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        )
        self.duel_status.pack(anchor="w", padx=17, pady=(0, 15))

        progress = ctk.CTkFrame(scroll, fg_color=Colors.PANEL, corner_radius=16, border_width=1, border_color=Colors.BORDER)
        progress.pack(fill="x", pady=(14, 16))
        ctk.CTkLabel(progress, text="Run progress", text_color=Colors.TEXT, font=(self.font, 15, "bold")).pack(anchor="w", padx=17, pady=(15, 8))
        self.duel_progress: dict[str, ctk.CTkLabel] = {}
        for key, label in (
            ("game", "Launch / find Survival.exe"),
            ("attach", "Attach capture engine"),
            ("capture", "Start capture session"),
            ("base", "Open Alliance Duel + capture season/current/completed"),
            ("weekly", "Capture weekly combined"),
            ("alliance", "Capture My Alliance weekly roster"),
            ("return", "Return to current day and close UI"),
            ("verify", "Verify required datasets"),
            ("package", "Package session ZIP"),
            ("cloud", "Sync this session to Cloudflare"),
        ):
            row = ctk.CTkFrame(progress, fg_color="transparent")
            row.pack(fill="x", padx=17, pady=3)
            ctk.CTkLabel(row, text=label, text_color=Colors.MUTED, font=(self.font, 10)).pack(side="left")
            status = ctk.CTkLabel(row, text="Waiting", text_color=Colors.MUTED, font=(self.font, 10, "bold"))
            status.pack(side="right")
            self.duel_progress[key] = status

        self.duel_report = ctk.CTkTextbox(
            progress,
            height=150,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 9),
        )
        self.duel_report.pack(fill="x", padx=17, pady=(12, 15))
        self.duel_report.insert("1.0", "No automated run has completed yet.\n")
        self.duel_report.configure(state="disabled")

    def browse_game_executable(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose Last Z launch executable",
            filetypes=[("Windows executable", "*.exe"), ("All files", "*.*")],
        )
        if not path:
            return
        self.duel_game_path.delete(0, "end")
        self.duel_game_path.insert(0, path)
        self.save_game_executable()

    def save_game_executable(self) -> None:
        self.config.values["gameExecutable"] = self.duel_game_path.get().strip()
        self.config.values["autoSyncAfterDuel"] = bool(self.duel_sync_switch.get()) if hasattr(self, "duel_sync_switch") else True
        self.config.save()
        if hasattr(self, "duel_status"):
            self.duel_status.configure(text="Game launch settings saved locally.", text_color=Colors.SUCCESS)

    def _set_duel_progress(self, key: str, text: str, color: Any = None) -> None:
        widget = self.duel_progress.get(key)
        if widget:
            widget.configure(text=text, text_color=color or Colors.MUTED)

    def _set_duel_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "duel_status"):
            self.duel_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Duel Auto: " + text)

    def _reset_duel_ui(self) -> None:
        for key in self.duel_progress:
            self._set_duel_progress(key, "Waiting", Colors.MUTED)
        self.duel_report.configure(state="normal")
        self.duel_report.delete("1.0", "end")
        self.duel_report.insert("1.0", "Automated run in progress...\n")
        self.duel_report.configure(state="disabled")

    def run_duel_sync(self) -> None:
        if self.duel_running:
            return
        if self.session_id:
            self._set_duel_status("Stop the currently active manual capture before starting an automated run.", Colors.DANGER)
            return

        self.save_game_executable()
        wants_sync = bool(self.duel_sync_switch.get())
        if wants_sync and (not self.config.values.get("cloudEndpoint") or not self.config.values.get("uploadToken")):
            self._set_duel_status("Cloud sync is enabled but the Cloud Sync endpoint/token is not configured yet.", Colors.DANGER)
            return

        self.duel_running = True
        self.duel_cancelled = False
        self.duel_stage = "preflight"
        self.duel_started_at = utc_now()
        self.duel_launched_game = False
        self.duel_step_index = -1
        self.duel_step_attempts = 0
        self.duel_current_control = ""
        self.duel_wait_kind = ""
        self.duel_seen_season = False
        self.duel_rank_counts.clear()
        self.duel_rank_rows.clear()
        self.duel_step_results.clear()
        self.duel_session_id = None
        self.duel_package = ""
        self.duel_cloud_result = None
        self.duel_error = ""
        self._reset_duel_ui()
        self.duel_run_button.configure(state="disabled", text="ALLIANCE DUEL SYNC RUNNING")
        self.duel_stop_button.configure(state="normal")
        self._set_duel_progress("game", "Checking", Colors.ACCENT)
        self._set_duel_status("Checking for Survival.exe...")
        self.after(50, self._ensure_game_running)

    def _ensure_game_running(self) -> None:
        if not self.duel_running:
            return
        if self._survival_running():
            self._set_duel_progress("game", "Running", Colors.SUCCESS)
            self._begin_duel_attach()
            return

        executable = Path(str(self.config.values.get("gameExecutable") or "").strip())
        if not executable.is_file():
            self._duel_fail("Survival.exe is not running and the saved Last Z executable path is missing or invalid.")
            return
        try:
            os.startfile(str(executable))
        except Exception as exc:
            self._duel_fail(f"Could not launch {executable.name}: {exc}")
            return

        self.duel_launched_game = True
        self.duel_stage = "waiting_game"
        self.duel_process_deadline = time.monotonic() + 120.0
        self._set_duel_progress("game", "Launching", Colors.ACCENT)
        self._set_duel_status(f"Launched {executable.name}. Waiting up to 120 seconds for Survival.exe...")
        self.after(1000, self._poll_survival_process)

    def _survival_running(self) -> bool:
        try:
            device = self.capture._local_device()
            return any(str(getattr(item, "name", "")).lower() == "survival.exe" for item in device.enumerate_processes())
        except Exception:
            return False

    def _poll_survival_process(self) -> None:
        if not self.duel_running:
            return
        if self._survival_running():
            self._set_duel_progress("game", "Running", Colors.SUCCESS)
            self._begin_duel_attach()
            return
        if time.monotonic() >= self.duel_process_deadline:
            self._duel_fail("Timed out waiting for Survival.exe after launching Last Z.")
            return
        self.after(1000, self._poll_survival_process)

    def _begin_duel_attach(self) -> None:
        if not self.duel_running:
            return
        self.duel_stage = "attaching"
        self._set_duel_progress("attach", "Attaching", Colors.ACCENT)
        self._set_duel_status("Survival.exe is running. Attaching Alliance Tracker...")
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

    def _duel_attach_failed(self, message: str) -> None:
        if not self.duel_running:
            return
        if time.monotonic() < self.duel_attach_deadline and self._survival_running():
            self._set_duel_status(f"Game is still initializing ({message}). Retrying attach...")
            self.after(1000, self._begin_duel_attach)
            return
        self._duel_fail("Could not attach to Survival.exe: " + message)

    def _poll_duel_hook_ready(self) -> None:
        if not self.duel_running:
            return
        if self.capture.state.ready:
            self._set_duel_progress("attach", "Ready", Colors.SUCCESS)
            self._start_duel_capture()
            return
        if time.monotonic() >= self.duel_attach_deadline:
            self._duel_fail("Attached to the game but the capture/replay hooks did not become ready in time.")
            return
        self.after(250, self._poll_duel_hook_ready)

    def _start_duel_capture(self) -> None:
        if not self.duel_running:
            return
        self.duel_stage = "starting_capture"
        self._set_duel_progress("capture", "Starting", Colors.ACCENT)
        try:
            self.label.delete(0, "end")
            self.label.insert(0, "Alliance Duel Auto Sync")
            self.start()
        except Exception as exc:
            self._duel_fail(f"Could not start the capture session: {exc}")
            return
        if not self.session_id:
            self._duel_fail("Alliance Tracker did not create a capture session.")
            return
        self.duel_session_id = self.session_id
        self._write_duel_sequence_file()
        self._write_duel_run_report("running")
        self._set_duel_progress("capture", "Recording", Colors.SUCCESS)
        self._set_duel_progress("base", "Running", Colors.ACCENT)
        self._set_duel_status("Capture started. Opening Alliance Duel through the proven internal Unity control...")
        self.duel_stage = "sequence"
        self.duel_step_index = 0
        self.after(250, self._queue_current_duel_step)

    def _write_duel_sequence_file(self) -> None:
        if not self.duel_session_id:
            return
        raw = SESSIONS_DIR / self.duel_session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 1,
            "name": "Alliance Duel Auto Sync",
            "timingMode": "response-driven",
            "source": "proven Full succeded test sequence",
            "steps": DEFAULT_DUEL_SEQUENCE,
        }
        (raw / "control-sequence.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _current_rank_count(self, rank_type: int) -> int:
        return int(self.duel_rank_counts.get(rank_type, 0))

    def _queue_current_duel_step(self) -> None:
        if not self.duel_running or not (0 <= self.duel_step_index < len(DEFAULT_DUEL_SEQUENCE)):
            return
        step = DEFAULT_DUEL_SEQUENCE[self.duel_step_index]
        name = str(step["name"])
        self.duel_current_control = name
        self.duel_step_attempts += 1
        self.duel_wait_kind = "replay"
        self.duel_step_deadline = time.monotonic() + 12.0
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
        self._set_duel_status(f"Step {self.duel_step_index + 1}/7: {name}")
        self.after(250, self._duel_sequence_tick)

    def _duel_sequence_tick(self) -> None:
        if not self.duel_running or self.duel_stage != "sequence":
            return
        if self.duel_wait_kind == "data" and self._duel_data_condition_met():
            self._advance_duel_step()
            return
        if self.duel_wait_kind in {"settle-close", "settle-back"} and time.monotonic() >= self.duel_step_deadline:
            self._advance_duel_step()
            return
        if time.monotonic() >= self.duel_step_deadline:
            if self.duel_wait_kind == "replay":
                self._retry_duel_step(f"No replay result arrived for {self.duel_current_control}.")
                return
            self._duel_fail(self._duel_timeout_message())
            return
        self.after(250, self._duel_sequence_tick)

    def _duel_data_condition_met(self) -> bool:
        name = self.duel_current_control
        b = self.duel_wait_baseline
        if name == "UIMain_icon_AlCompete":
            return self.duel_seen_season and self._current_rank_count(0) > b.get("rank0", 0) and self._current_rank_count(3) > b.get("rank3", 0)
        if name == "rankBtn":
            return sum(self.duel_rank_counts.values()) > b.get("rankTotal", 0)
        if name == "Toggle2":
            return self._current_rank_count(1) > b.get("rank1", 0)
        if name == "Toggle3":
            return self._current_rank_count(2) > b.get("rank2", 0) and int(self.duel_rank_rows.get(2, 0)) > 0
        if name == "Toggle1":
            return self._current_rank_count(0) > b.get("rank0", 0)
        return True

    def _duel_timeout_message(self) -> str:
        name = self.duel_current_control
        if name == "UIMain_icon_AlCompete":
            return "Alliance Duel opened, but season/current-day/completed-day responses did not all arrive in time."
        if name == "rankBtn":
            return "Rankings opened, but no fresh Alliance Duel ranking response arrived."
        if name == "Toggle2":
            return "Weekly was selected, but rankType 1 / weekly combined data did not arrive."
        if name == "Toggle3":
            return "My Alliance was selected, but rankType 2 / weekly own-alliance data did not arrive."
        if name == "Toggle1":
            return "Current Day was selected again, but a fresh rankType 0 response did not arrive."
        return f"Timed out after replaying {name}."

    def _handle_duel_replay_result(self, data: dict[str, Any]) -> None:
        if not self.duel_running or self.duel_stage != "sequence" or self.duel_wait_kind != "replay":
            return
        name = str(data.get("name") or "")
        if name != self.duel_current_control:
            return
        if not data.get("ok"):
            self._retry_duel_step(str(data.get("error") or "replay failed"))
            return

        self.duel_step_results.append({
            "index": self.duel_step_index + 1,
            "name": name,
            "ok": True,
            "method": data.get("method"),
            "completedAt": utc_now(),
        })
        self.duel_step_attempts = 0

        if name in {"UIMain_icon_AlCompete", "rankBtn", "Toggle2", "Toggle3", "Toggle1"}:
            self.duel_wait_kind = "data"
            self.duel_step_deadline = time.monotonic() + (16.0 if name == "UIMain_icon_AlCompete" else 12.0)
            if self._duel_data_condition_met():
                self.after(100, self._advance_duel_step)
            else:
                self.after(250, self._duel_sequence_tick)
            return
        if name == "CloseBtn":
            self.duel_wait_kind = "settle-close"
            self.duel_step_deadline = time.monotonic() + 0.35
            self.after(100, self._duel_sequence_tick)
            return
        if name == "PCMask":
            self.duel_wait_kind = "settle-back"
            self.duel_step_deadline = time.monotonic() + 0.55
            self.after(100, self._duel_sequence_tick)

    def _retry_duel_step(self, reason: str) -> None:
        if not self.duel_running:
            return
        if self.duel_step_attempts >= 8:
            self._duel_fail(f"{self.duel_current_control} failed after {self.duel_step_attempts} attempts: {reason}")
            return
        self._set_duel_status(f"{self.duel_current_control} is not ready yet. Retrying ({self.duel_step_attempts + 1}/8)...")
        self.duel_wait_kind = "retry"
        self.after(500, self._queue_current_duel_step)

    def _advance_duel_step(self) -> None:
        if not self.duel_running:
            return
        name = self.duel_current_control
        if name == "UIMain_icon_AlCompete":
            self._set_duel_progress("base", "Captured", Colors.SUCCESS)
        elif name == "Toggle2":
            self._set_duel_progress("weekly", "Captured", Colors.SUCCESS)
        elif name == "Toggle3":
            rows = int(self.duel_rank_rows.get(2, 0))
            self._set_duel_progress("alliance", f"Captured ({rows})", Colors.SUCCESS)
        elif name == "Toggle1":
            self._set_duel_progress("return", "Closing", Colors.ACCENT)
        elif name == "PCMask":
            self._set_duel_progress("return", "Returned", Colors.SUCCESS)

        self.duel_step_index += 1
        self.duel_current_control = ""
        self.duel_wait_kind = ""
        self.duel_step_attempts = 0
        if self.duel_step_index >= len(DEFAULT_DUEL_SEQUENCE):
            self.after(200, self._finish_duel_capture)
            return
        self.after(150, self._queue_current_duel_step)

    def _observe_duel_response(self, data: dict[str, Any]) -> None:
        if not self.duel_running:
            return
        command = str(data.get("command") or "")
        raw = data.get("json")
        if command == "get.alliance.duel.season.info":
            self.duel_seen_season = True
            return
        if command != "al.battle.rank.info" or not isinstance(raw, str) or not raw:
            return
        try:
            decoded = json.loads(raw)
            rank_type = int(decoded.get("type"))
        except Exception:
            return
        self.duel_rank_counts[rank_type] = self._current_rank_count(rank_type) + 1
        rows = decoded.get("rankInfo") or []
        self.duel_rank_rows[rank_type] = len(rows) if isinstance(rows, list) else 0

    def _finish_duel_capture(self) -> None:
        if not self.duel_running or not self.duel_session_id:
            return
        session_id = self.duel_session_id
        self.duel_stage = "packaging"
        self._set_duel_progress("verify", "Checking", Colors.ACCENT)
        self._set_duel_progress("package", "Packaging", Colors.ACCENT)
        self._set_duel_status("Sequence complete. Stopping capture and verifying the structured datasets...")
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
            self._duel_fail(f"Could not stop/package the automated capture: {exc}", preserve_capture=False)
            return

        self.session_id = None
        self.duel_package = str(package)
        self.stop_button.configure(state="disabled")
        self.start_button.configure(state="normal")
        self.recording.set("Stopped", "Automated package ready")
        self.refresh_sessions()

        datasets = {str(row.get("dataset") or "") for row in summary.get("datasets") or []}
        rank_labels = set(summary.get("captureQuality", {}).get("rankTypesCaptured") or [])
        missing: list[str] = []
        if "alliance_duel_season" not in datasets:
            missing.append("season")
        missing.extend(sorted(REQUIRED_RANK_LABELS - rank_labels))
        if missing:
            self._set_duel_progress("verify", "Failed", Colors.DANGER)
            self._set_duel_progress("package", "Saved partial", Colors.DANGER)
            self._duel_fail("Capture packaged, but required data is missing: " + ", ".join(missing), preserve_capture=False)
            return

        self._set_duel_progress("verify", "Verified", Colors.SUCCESS)
        self._set_duel_progress("package", "Saved", Colors.SUCCESS)
        self._write_duel_run_report("packaged", {"captureSummary": summary})

        if not bool(self.duel_sync_switch.get()):
            self._set_duel_progress("cloud", "Skipped", Colors.MUTED)
            self._duel_success("Verified capture packaged locally. Cloud sync was disabled for this run.")
            return
        self._begin_duel_cloud_sync(session_id)

    def _begin_duel_cloud_sync(self, session_id: str) -> None:
        snapshots = self.store.snapshots_for_session(session_id)
        if not snapshots:
            self._duel_fail("Verified package was created, but no snapshots were available for cloud sync.", preserve_capture=False)
            return
        self.duel_stage = "syncing"
        self._set_duel_progress("cloud", "Uploading", Colors.ACCENT)
        self._set_duel_status(f"Uploading {len(snapshots)} verified snapshots from this run to WDZ Cloudflare...")

        def work() -> None:
            try:
                result = CloudClient(self.config.values["cloudEndpoint"], self.config.values["uploadToken"]).upload(snapshots)
                ids = result.get("acceptedSnapshotIds") or [row["id"] for row in snapshots]
                self.store.mark_synced(int(value) for value in ids)
                self.after(0, lambda: self._duel_cloud_done(result, len(ids)))
            except Exception as exc:
                self.after(0, lambda msg=str(exc): self._duel_fail("Cloud sync failed after the verified package was saved: " + msg, preserve_capture=False))

        threading.Thread(target=work, daemon=True).start()

    def _duel_cloud_done(self, result: dict[str, Any], acknowledged: int) -> None:
        if not self.duel_running:
            return
        self.duel_cloud_result = dict(result)
        accepted = int(result.get("accepted", acknowledged))
        duplicates = int(result.get("duplicates", 0))
        self._set_duel_progress("cloud", f"Synced ({accepted} new / {duplicates} existing)", Colors.SUCCESS)
        self.cloud_card.set("Connected", "Automated Duel sync succeeded")
        self._duel_success(f"Alliance Duel Auto Sync complete. Cloud acknowledged {acknowledged} snapshots; {accepted} new, {duplicates} already present.")

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        session_id = self.duel_session_id
        if not session_id:
            return
        raw = SESSIONS_DIR / session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        report: dict[str, Any] = {
            "schemaVersion": 1,
            "status": status,
            "startedAt": self.duel_started_at,
            "updatedAt": utc_now(),
            "gameExecutable": str(self.config.values.get("gameExecutable") or ""),
            "launchedGame": self.duel_launched_game,
            "sessionId": session_id,
            "stage": self.duel_stage,
            "sequence": [dict(step) for step in DEFAULT_DUEL_SEQUENCE],
            "stepResults": list(self.duel_step_results),
            "seasonObserved": self.duel_seen_season,
            "rankResponseCounts": {str(k): v for k, v in sorted(self.duel_rank_counts.items())},
            "rankRows": {str(k): v for k, v in sorted(self.duel_rank_rows.items())},
            "package": self.duel_package,
            "cloudResult": self.duel_cloud_result,
            "error": self.duel_error,
        }
        if extra:
            report.update(extra)
        (raw / "automated-duel-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def _render_duel_report(self, final_status: str, message: str) -> None:
        lines = [
            f"Status: {final_status}",
            f"Session: {self.duel_session_id or '-'}",
            f"Game launched by tracker: {'yes' if self.duel_launched_game else 'no'}",
            f"Successful replay steps: {len(self.duel_step_results)}/7",
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

    def _duel_success(self, message: str) -> None:
        self.duel_stage = "complete"
        self.duel_error = ""
        self._write_duel_run_report("success")
        self._render_duel_report("SUCCESS", message)
        self._set_duel_status(message, Colors.SUCCESS)
        self.duel_running = False
        self.duel_run_button.configure(state="normal", text="RUN ALLIANCE DUEL SYNC")
        self.duel_stop_button.configure(state="disabled")

    def _duel_fail(self, message: str, preserve_capture: bool = True) -> None:
        if not self.duel_running:
            return
        self.duel_error = message
        self.duel_stage = "failed"
        if preserve_capture and self.duel_session_id and self.session_id:
            session_id = self.duel_session_id
            try:
                self.capture.stop()
                while True:
                    try:
                        event = self.capture.events.get_nowait()
                    except queue.Empty:
                        break
                    self.handle(event.kind, event.payload)
                self.store.stop_session(session_id)
                package = self.store.package(session_id)
                self.duel_package = str(package)
                self.session_id = None
                self.stop_button.configure(state="disabled")
                self.start_button.configure(state="normal")
                self.recording.set("Stopped", "Partial automated package")
                self.refresh_sessions()
            except Exception as exc:
                message += f" | Also could not preserve the partial capture: {exc}"
                self.duel_error = message
        self._write_duel_run_report("failed")
        self._render_duel_report("FAILED", message)
        self._set_duel_status(message, Colors.DANGER)
        self.duel_running = False
        self.duel_run_button.configure(state="normal", text="RUN ALLIANCE DUEL SYNC")
        self.duel_stop_button.configure(state="disabled")

    def cancel_duel_sync(self) -> None:
        if not self.duel_running:
            return
        self.duel_cancelled = True
        self._duel_fail("Automated run stopped by user. A partial capture was preserved when possible.")

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}
        if self.duel_running:
            if kind == "automation-replay-result":
                self._handle_duel_replay_result(data)
            elif kind == "response":
                self._observe_duel_response(data)
        super().handle(kind, payload)
