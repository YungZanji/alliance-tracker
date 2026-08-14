from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v080 import App as BaseApp
from utils import APP_DATA_DIR, SESSIONS_DIR


SEQUENCE_DIR = APP_DATA_DIR / "control-sequences"
SEQUENCE_VERSION = 1


class App(BaseApp):
    """Alliance Tracker 1.0 control-sequence discovery studio.

    This build is intentionally a training tool. It records arbitrary Unity Button /
    Toggle interactions in the exact order the user performs them, packages that
    sequence with the capture session, and can replay one step or the complete
    sequence through the in-process Unity replay engine.
    """

    def __init__(self) -> None:
        self.sequence_recording = False
        self.sequence_replaying = False
        self.sequence_steps: list[dict[str, Any]] = []
        self.sequence_last_recorded_at = 0.0
        self.sequence_replay_index = -1
        self.sequence_waiting = False
        self.sequence_fallback_used = False
        self.sequence_last_started_at = ""
        self.sequence_event_stats: dict[str, Any] = {}
        super().__init__()

    def _layout(self) -> None:
        super()._layout()
        self._sequence_studio_page()

        side = next(iter(self.nav.values())).master
        studio_nav = ctk.CTkButton(
            side,
            text="Sequence Studio",
            anchor="w",
            height=43,
            corner_radius=10,
            fg_color="transparent",
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 13, "bold"),
            command=lambda: self.show("sequence_studio"),
        )
        studio_nav.grid(row=7, column=0, sticky="ew", padx=11, pady=3)
        self.nav["sequence_studio"] = studio_nav

    def _sequence_studio_page(self) -> None:
        page = self.page(
            "sequence_studio",
            "Control Sequence Studio",
            "Record the exact Last Z controls you use, arrange them, and replay the same path without touching the game.",
        )

        scroll = ctk.CTkScrollableFrame(page, fg_color="transparent", corner_radius=0)
        scroll.pack(fill="both", expand=True)

        recorder = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        recorder.pack(fill="x")
        ctk.CTkLabel(
            recorder,
            text="SEQUENCE RECORDER",
            text_color=Colors.ACCENT,
            font=(self.font, 11, "bold"),
        ).pack(anchor="w", padx=17, pady=(16, 2))
        ctk.CTkLabel(
            recorder,
            text="Teach the tracker the real path instead of guessing it.",
            text_color=Colors.TEXT,
            font=(self.font, 19, "bold"),
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            recorder,
            text=(
                "Press Record, then click any Last Z buttons or toggles you want in the exact order you want them replayed. "
                "Every recorded step is included in the session ZIP. Replaying uses the exact observed control when possible, "
                "with the control name as a fallback for a later screen/session."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 12))

        controls = ctk.CTkFrame(recorder, fg_color="transparent")
        controls.pack(fill="x", padx=17, pady=(0, 10))
        self.sequence_record_button = ctk.CTkButton(
            controls,
            text="Start recording controls",
            height=40,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 11, "bold"),
            command=self.start_sequence_recording,
        )
        self.sequence_record_button.pack(side="left")
        self.sequence_stop_record_button = ctk.CTkButton(
            controls,
            text="Stop recording",
            height=40,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 11, "bold"),
            state="disabled",
            command=self.stop_sequence_recording,
        )
        self.sequence_stop_record_button.pack(side="left", padx=8)
        ctk.CTkButton(
            controls,
            text="Clear sequence",
            height=40,
            fg_color="transparent",
            border_width=1,
            border_color=Colors.BORDER,
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 10, "bold"),
            command=self.clear_sequence,
        ).pack(side="right")

        self.sequence_record_status = ctk.CTkLabel(
            recorder,
            text="Ready. Start recording, then perform the path manually in Last Z.",
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        )
        self.sequence_record_status.pack(anchor="w", padx=17, pady=(0, 15))

        steps_panel = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        steps_panel.pack(fill="x", pady=(14, 0))
        header = ctk.CTkFrame(steps_panel, fg_color="transparent")
        header.pack(fill="x", padx=17, pady=(14, 6))
        ctk.CTkLabel(
            header,
            text="Recorded sequence",
            text_color=Colors.TEXT,
            font=(self.font, 15, "bold"),
        ).pack(side="left")
        self.sequence_count_label = ctk.CTkLabel(
            header,
            text="0 steps",
            text_color=Colors.MUTED,
            font=(self.font, 10, "bold"),
        )
        self.sequence_count_label.pack(side="right")

        self.sequence_rows = ctk.CTkFrame(steps_panel, fg_color="transparent")
        self.sequence_rows.pack(fill="x", padx=17, pady=(0, 12))

        replay = ctk.CTkFrame(
            steps_panel,
            fg_color=Colors.PANEL2,
            corner_radius=12,
            border_width=1,
            border_color=Colors.BORDER,
        )
        replay.pack(fill="x", padx=17, pady=(0, 15))
        replay_row = ctk.CTkFrame(replay, fg_color="transparent")
        replay_row.pack(fill="x", padx=12, pady=(11, 7))
        self.sequence_replay_button = ctk.CTkButton(
            replay_row,
            text="REPLAY FULL SEQUENCE",
            height=42,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 11, "bold"),
            command=self.replay_full_sequence,
        )
        self.sequence_replay_button.pack(side="left")
        self.sequence_stop_replay_button = ctk.CTkButton(
            replay_row,
            text="Stop replay",
            height=42,
            fg_color=Colors.PANEL,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            state="disabled",
            command=lambda: self._finish_sequence_replay(False, "Replay stopped by user."),
        )
        self.sequence_stop_replay_button.pack(side="left", padx=8)
        ctk.CTkLabel(
            replay_row,
            text="Timing",
            text_color=Colors.MUTED,
            font=(self.font, 10),
        ).pack(side="right", padx=(8, 5))
        self.sequence_timing = ctk.CTkOptionMenu(
            replay_row,
            values=["Recorded timing", "500 ms between steps", "1000 ms between steps"],
            width=205,
            fg_color=Colors.PANEL,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9),
        )
        self.sequence_timing.set("Recorded timing")
        self.sequence_timing.pack(side="right")
        self.sequence_replay_status = ctk.CTkLabel(
            replay,
            text="No sequence replay is running.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=880,
            justify="left",
        )
        self.sequence_replay_status.pack(anchor="w", padx=12, pady=(0, 11))

        profiles = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        profiles.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(
            profiles,
            text="Saved sequences",
            text_color=Colors.TEXT,
            font=(self.font, 14, "bold"),
        ).pack(anchor="w", padx=17, pady=(14, 6))
        profile_row = ctk.CTkFrame(profiles, fg_color="transparent")
        profile_row.pack(fill="x", padx=17, pady=(0, 8))
        self.sequence_name_entry = ctk.CTkEntry(
            profile_row,
            placeholder_text="Example: State Ruler participation path",
            height=38,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 10),
        )
        self.sequence_name_entry.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            profile_row,
            text="Save",
            height=38,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            command=self.save_sequence_profile,
        ).pack(side="left", padx=(8, 0))

        load_row = ctk.CTkFrame(profiles, fg_color="transparent")
        load_row.pack(fill="x", padx=17, pady=(0, 13))
        self.sequence_profile_menu = ctk.CTkComboBox(
            load_row,
            values=["No saved sequences"],
            height=36,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
        )
        self.sequence_profile_menu.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(
            load_row,
            text="Load",
            height=36,
            fg_color="transparent",
            border_width=1,
            border_color=Colors.BORDER,
            hover_color=Colors.PANEL2,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            command=self.load_sequence_profile,
        ).pack(side="left", padx=(8, 0))
        self.sequence_profile_status = ctk.CTkLabel(
            profiles,
            text="Sequences are stored locally and the active sequence is also written into the current capture ZIP.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.sequence_profile_status.pack(anchor="w", padx=17, pady=(0, 13))

        event_panel = ctk.CTkFrame(
            scroll,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        event_panel.pack(fill="x", pady=(14, 16))
        ctk.CTkLabel(
            event_panel,
            text="State Ruler / SVS capture inspector",
            text_color=Colors.TEXT,
            font=(self.font, 14, "bold"),
        ).pack(anchor="w", padx=17, pady=(14, 3))
        ctk.CTkLabel(
            event_panel,
            text=(
                "This is diagnostic only. It shows what the current capture actually contains so we can distinguish a top-100 "
                "leaderboard from a complete participation feed before putting anything on the public tracker."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(0, 8))
        self.sequence_event_summary = ctk.CTkTextbox(
            event_panel,
            height=180,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 10),
        )
        self.sequence_event_summary.pack(fill="x", padx=17, pady=(0, 15))
        self.sequence_event_summary.insert("1.0", "No State Ruler/SVS score payload has been decoded in this session yet.\n")
        self.sequence_event_summary.configure(state="disabled")

        self._refresh_sequence_profiles()
        self._render_sequence_steps()

    def start_sequence_recording(self) -> None:
        if not self.capture.state.attached or not self.capture.state.ready:
            self.sequence_record_status.configure(
                text="Attach to Last Z first and wait for the capture engine to become ready.",
                text_color=Colors.DANGER,
            )
            return
        if not self.session_id:
            if not self.label.get().strip():
                self.label.insert(0, "Control Sequence Training")
            self.start()
            if not self.session_id:
                return
        self.sequence_recording = True
        self.sequence_replaying = False
        self.sequence_last_recorded_at = 0.0
        self.sequence_last_started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        self.sequence_record_button.configure(state="disabled", text="RECORDING CONTROLS")
        self.sequence_stop_record_button.configure(state="normal")
        self.sequence_record_status.configure(
            text="Recording. Perform the exact path manually in Last Z now; every Button/Toggle click will be added below.",
            text_color=Colors.SUCCESS,
        )
        self.write("Control sequence recording started.")
        self._write_sequence_to_session()

    def stop_sequence_recording(self) -> None:
        if not self.sequence_recording:
            return
        self.sequence_recording = False
        self.sequence_record_button.configure(state="normal", text="Start recording controls")
        self.sequence_stop_record_button.configure(state="disabled")
        self.sequence_record_status.configure(
            text=f"Recording stopped. {len(self.sequence_steps)} step(s) captured. You can reorder, remove, replay, or package them.",
            text_color=Colors.MUTED,
        )
        self.write(f"Control sequence recording stopped: {len(self.sequence_steps)} step(s).")
        self._write_sequence_to_session()

    def _record_control_step(self, control_type: str, name: str, observation_id: Any = None) -> None:
        if not self.sequence_recording or self.sequence_replaying:
            return
        name = str(name or "").strip()
        if not name:
            return
        now = time.monotonic()
        delay_ms = 0 if not self.sequence_last_recorded_at else int(round((now - self.sequence_last_recorded_at) * 1000))
        self.sequence_last_recorded_at = now
        obs = None
        try:
            obs = int(observation_id) if observation_id is not None else None
        except (TypeError, ValueError):
            obs = None
        step = {
            "controlType": control_type,
            "name": name,
            "observationId": obs,
            "replayKey": f"@obs:{obs}" if obs else name,
            "delayMs": max(0, delay_ms),
        }
        self.sequence_steps.append(step)
        self.sequence_record_status.configure(
            text=f"Recording: captured step {len(self.sequence_steps)} — {control_type} {name}",
            text_color=Colors.SUCCESS,
        )
        self._render_sequence_steps()
        self._write_sequence_to_session()

    def _render_sequence_steps(self) -> None:
        if not hasattr(self, "sequence_rows"):
            return
        for child in self.sequence_rows.winfo_children():
            child.destroy()
        self.sequence_count_label.configure(text=f"{len(self.sequence_steps)} step{'s' if len(self.sequence_steps) != 1 else ''}")
        if not self.sequence_steps:
            ctk.CTkLabel(
                self.sequence_rows,
                text="No controls recorded yet.",
                text_color=Colors.MUTED,
                font=(self.font, 10),
            ).pack(anchor="w", pady=8)
            return
        for index, step in enumerate(self.sequence_steps):
            row = ctk.CTkFrame(self.sequence_rows, fg_color=Colors.PANEL2, corner_radius=10)
            row.pack(fill="x", pady=3)
            ctk.CTkLabel(
                row,
                text=f"{index + 1:02d}",
                width=38,
                text_color=Colors.ACCENT,
                font=(self.font, 10, "bold"),
            ).pack(side="left", padx=(8, 2), pady=8)
            ctk.CTkLabel(
                row,
                text=step.get("controlType") or "Control",
                width=60,
                text_color=Colors.MUTED,
                font=(self.font, 9),
            ).pack(side="left")
            ctk.CTkLabel(
                row,
                text=step.get("name") or "<unnamed>",
                text_color=Colors.TEXT,
                font=(self.font, 10, "bold"),
            ).pack(side="left", padx=7)
            delay = int(step.get("delayMs") or 0)
            obs = step.get("observationId")
            detail = f"+{delay} ms" + (f" · exact #{obs}" if obs else " · name fallback")
            ctk.CTkLabel(
                row,
                text=detail,
                text_color=Colors.MUTED,
                font=(self.font, 8),
            ).pack(side="left", padx=6)
            ctk.CTkButton(
                row,
                text="Replay",
                width=64,
                height=28,
                fg_color="transparent",
                border_width=1,
                border_color=Colors.BORDER,
                hover_color=Colors.BORDER,
                text_color=Colors.TEXT,
                font=(self.font, 8, "bold"),
                command=lambda i=index: self.replay_sequence_step(i),
            ).pack(side="right", padx=(3, 7), pady=6)
            ctk.CTkButton(
                row,
                text="×",
                width=30,
                height=28,
                fg_color="transparent",
                hover_color=Colors.BORDER,
                text_color=Colors.DANGER,
                font=(self.font, 11, "bold"),
                command=lambda i=index: self.remove_sequence_step(i),
            ).pack(side="right", padx=2)
            ctk.CTkButton(
                row,
                text="↓",
                width=30,
                height=28,
                fg_color="transparent",
                hover_color=Colors.BORDER,
                text_color=Colors.MUTED,
                font=(self.font, 10, "bold"),
                state="normal" if index < len(self.sequence_steps) - 1 else "disabled",
                command=lambda i=index: self.move_sequence_step(i, 1),
            ).pack(side="right", padx=2)
            ctk.CTkButton(
                row,
                text="↑",
                width=30,
                height=28,
                fg_color="transparent",
                hover_color=Colors.BORDER,
                text_color=Colors.MUTED,
                font=(self.font, 10, "bold"),
                state="normal" if index > 0 else "disabled",
                command=lambda i=index: self.move_sequence_step(i, -1),
            ).pack(side="right", padx=2)

    def move_sequence_step(self, index: int, direction: int) -> None:
        target = index + direction
        if index < 0 or index >= len(self.sequence_steps) or target < 0 or target >= len(self.sequence_steps):
            return
        self.sequence_steps[index], self.sequence_steps[target] = self.sequence_steps[target], self.sequence_steps[index]
        self._render_sequence_steps()
        self._write_sequence_to_session()

    def remove_sequence_step(self, index: int) -> None:
        if 0 <= index < len(self.sequence_steps):
            self.sequence_steps.pop(index)
            self._render_sequence_steps()
            self._write_sequence_to_session()

    def clear_sequence(self) -> None:
        if self.sequence_replaying:
            return
        self.sequence_steps.clear()
        self.sequence_last_recorded_at = 0.0
        self._render_sequence_steps()
        self._write_sequence_to_session()
        self.sequence_record_status.configure(text="Sequence cleared. Ready to record a new path.", text_color=Colors.MUTED)

    def _ensure_replay_ready(self) -> bool:
        if not self.capture.state.attached or not self.capture.state.ready:
            self.sequence_replay_status.configure(text="Attach to Last Z first.", text_color=Colors.DANGER)
            return False
        if not self.session_id:
            if not self.label.get().strip():
                self.label.insert(0, "Control Sequence Replay")
            self.start()
            if not self.session_id:
                return False
        return True

    def _post_sequence_replay(self, key: str) -> bool:
        script = getattr(self.capture.state, "script", None)
        if script is None:
            return False
        try:
            script.post({"type": "automation-replay-control", "payload": {"name": key}})
            return True
        except Exception as exc:
            self.sequence_replay_status.configure(text=f"Could not queue replay: {exc}", text_color=Colors.DANGER)
            return False

    def replay_sequence_step(self, index: int) -> None:
        if self.sequence_replaying or not (0 <= index < len(self.sequence_steps)) or not self._ensure_replay_ready():
            return
        step = self.sequence_steps[index]
        self.sequence_replay_index = index
        self.sequence_waiting = True
        self.sequence_fallback_used = False
        key = str(step.get("replayKey") or step.get("name") or "")
        if not self._post_sequence_replay(key):
            self.sequence_waiting = False
            return
        self.sequence_replay_status.configure(
            text=f"Replaying step {index + 1}: {step.get('name')}. Do not touch Last Z until the result appears.",
            text_color=Colors.MUTED,
        )

    def replay_full_sequence(self) -> None:
        if self.sequence_replaying or not self.sequence_steps or not self._ensure_replay_ready():
            if not self.sequence_steps:
                self.sequence_replay_status.configure(text="Record or load at least one step first.", text_color=Colors.DANGER)
            return
        self.stop_sequence_recording()
        self.sequence_replaying = True
        self.sequence_replay_index = 0
        self.sequence_waiting = True
        self.sequence_fallback_used = False
        self.sequence_replay_button.configure(state="disabled", text="REPLAYING SEQUENCE")
        self.sequence_stop_replay_button.configure(state="normal")
        self.sequence_replay_status.configure(
            text=f"Starting {len(self.sequence_steps)}-step replay. Do not touch Last Z.",
            text_color=Colors.ACCENT,
        )
        self.write(f"Control sequence replay started: {len(self.sequence_steps)} step(s).")
        first = self.sequence_steps[0]
        if not self._post_sequence_replay(str(first.get("replayKey") or first.get("name") or "")):
            self._finish_sequence_replay(False, "Could not queue the first replay step.")

    def _sequence_delay_for(self, index: int) -> int:
        mode = self.sequence_timing.get()
        if mode.startswith("500"):
            return 500
        if mode.startswith("1000"):
            return 1000
        if not (0 <= index < len(self.sequence_steps)):
            return 300
        # Preserve user timing, but cap accidental multi-minute pauses during training.
        return max(100, min(5000, int(self.sequence_steps[index].get("delayMs") or 300)))

    def _advance_sequence_replay(self) -> None:
        if not self.sequence_replaying:
            return
        self.sequence_replay_index += 1
        if self.sequence_replay_index >= len(self.sequence_steps):
            self._finish_sequence_replay(True, f"Sequence replay complete: {len(self.sequence_steps)} step(s) succeeded.")
            return
        index = self.sequence_replay_index
        step = self.sequence_steps[index]
        self.sequence_waiting = True
        self.sequence_fallback_used = False
        self.sequence_replay_status.configure(
            text=f"Replaying {index + 1}/{len(self.sequence_steps)}: {step.get('name')}",
            text_color=Colors.ACCENT,
        )
        if not self._post_sequence_replay(str(step.get("replayKey") or step.get("name") or "")):
            self._finish_sequence_replay(False, f"Could not queue step {index + 1}: {step.get('name')}")

    def _finish_sequence_replay(self, ok: bool, message: str) -> None:
        self.sequence_replaying = False
        self.sequence_waiting = False
        self.sequence_replay_index = -1
        self.sequence_fallback_used = False
        self.sequence_replay_button.configure(state="normal", text="REPLAY FULL SEQUENCE")
        self.sequence_stop_replay_button.configure(state="disabled")
        self.sequence_replay_status.configure(text=message, text_color=Colors.SUCCESS if ok else Colors.DANGER)
        self.write(message)
        self._write_sequence_to_session(extra={"lastReplayOk": ok, "lastReplayMessage": message})

    def _sequence_payload(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {
            "version": SEQUENCE_VERSION,
            "recordedAt": self.sequence_last_started_at,
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "steps": self.sequence_steps,
            "timingMode": self.sequence_timing.get() if hasattr(self, "sequence_timing") else "Recorded timing",
            "purpose": "manual Last Z control path for deterministic replay discovery",
        }
        if extra:
            payload.update(extra)
        return payload

    def _write_sequence_to_session(self, extra: dict[str, Any] | None = None) -> None:
        if not self.session_id:
            return
        raw = SESSIONS_DIR / self.session_id / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        (raw / "control-sequence.json").write_text(
            json.dumps(self._sequence_payload(extra), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _safe_profile_name(value: str) -> str:
        value = re.sub(r"[^A-Za-z0-9._ -]+", "", value.strip()).strip(" .")
        return value[:80] or "Control Sequence"

    def _refresh_sequence_profiles(self) -> None:
        SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(SEQUENCE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        values = [p.stem for p in files] or ["No saved sequences"]
        if hasattr(self, "sequence_profile_menu"):
            self.sequence_profile_menu.configure(values=values)
            self.sequence_profile_menu.set(values[0])

    def save_sequence_profile(self) -> None:
        if not self.sequence_steps:
            self.sequence_profile_status.configure(text="There is no sequence to save.", text_color=Colors.DANGER)
            return
        name = self._safe_profile_name(self.sequence_name_entry.get() or "Control Sequence")
        SEQUENCE_DIR.mkdir(parents=True, exist_ok=True)
        path = SEQUENCE_DIR / f"{name}.json"
        data = self._sequence_payload({"name": name})
        # Observation IDs are useful in the current attached process; names remain the portable fallback.
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self.sequence_profile_status.configure(text=f"Saved {name}.json", text_color=Colors.SUCCESS)
        self._refresh_sequence_profiles()

    def load_sequence_profile(self) -> None:
        value = self.sequence_profile_menu.get().strip()
        if not value or value == "No saved sequences":
            return
        path = SEQUENCE_DIR / f"{value}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            steps = data.get("steps") or []
            if not isinstance(steps, list):
                raise ValueError("Saved sequence did not contain a steps list.")
            self.sequence_steps = [dict(step) for step in steps if isinstance(step, dict)]
            # Exact observation IDs are process-local. Keep them for same-session use but the replay code falls back by name.
            self._render_sequence_steps()
            self._write_sequence_to_session()
            self.sequence_profile_status.configure(text=f"Loaded {value}: {len(self.sequence_steps)} step(s).", text_color=Colors.SUCCESS)
        except Exception as exc:
            self.sequence_profile_status.configure(text=f"Could not load sequence: {exc}", text_color=Colors.DANGER)

    def _update_event_inspector(self, command: str, decoded: Any) -> None:
        if not isinstance(decoded, dict):
            return
        stats = self.sequence_event_stats

        if command == "server.battle.user.score.rank":
            rows = decoded.get("rankList") or []
            wdz = [r for r in rows if isinstance(r, dict) and (r.get("abbr") == "WDZ" or r.get("allianceName") == "Face The Wrath")]
            stats["user_rank"] = {
                "rows": len(rows),
                "wdz": len({str(r.get("uid")) for r in wdz if r.get("uid")}),
                "label": "server.battle.user.score.rank",
            }
        elif command == "server.battle.score.person.rank":
            rows = decoded.get("personRank") or []
            wdz = [r for r in rows if isinstance(r, dict) and (r.get("abbr") == "WDZ" or r.get("allianceName") == "Face The Wrath")]
            stats["person_rank"] = {
                "rows": len(rows),
                "wdz": len({str(r.get("uid")) for r in wdz if r.get("uid")}),
                "label": "server.battle.score.person.rank",
            }
        elif command == "server.battle.score.ali.rank":
            rows = decoded.get("allianceRank") or []
            wdz = next((r for r in rows if isinstance(r, dict) and (r.get("abbr") == "WDZ" or r.get("alliancename") == "Face The Wrath")), None)
            stats["alliance_rank"] = {
                "rows": len(rows),
                "wdzRank": wdz.get("rank") if wdz else None,
                "wdzScore": wdz.get("score") if wdz else None,
            }
        elif command == "server.battle.score.info":
            logs = decoded.get("selfLogarr") or []
            actors: set[str] = set()
            for item in logs:
                try:
                    row = json.loads(item) if isinstance(item, str) else item
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                if row.get("abbr") == "WDZ" or row.get("allianceName") == "Face The Wrath" or row.get("alliancename") == "Face The Wrath":
                    if row.get("uid"):
                        actors.add(str(row.get("uid")))
            own = decoded.get("self") or {}
            other = decoded.get("other") or {}
            stats["score_info"] = {
                "logRows": len(logs),
                "wdzLogActors": len(actors),
                "selfTotal": sum(v for v in own.values() if isinstance(v, (int, float))),
                "otherTotal": sum(v for v in other.values() if isinstance(v, (int, float))),
            }
        elif command.startswith("server.cross.battle"):
            stats["server_cross"] = {"command": command, "keys": sorted(decoded.keys())[:20]}
        elif command.startswith("server.battle"):
            stats.setdefault("other_server_battle", set()).add(command)
        else:
            return

        lines = ["Decoded State Ruler / SVS feeds in this session:", ""]
        if "user_rank" in stats:
            s = stats["user_rank"]
            lines.append(f"• Main player ranking: {s['rows']} rows returned; {s['wdz']} distinct WDZ players inside that returned list.")
        if "person_rank" in stats:
            s = stats["person_rank"]
            lines.append(f"• Battle person ranking: {s['rows']} rows returned; {s['wdz']} distinct WDZ players inside that returned list.")
        if "alliance_rank" in stats:
            s = stats["alliance_rank"]
            lines.append(f"• Alliance ranking: {s['rows']} alliances returned; WDZ rank={s['wdzRank']} score={s['wdzScore']}.")
        if "score_info" in stats:
            s = stats["score_info"]
            lines.append(f"• Battle log payload: {s['logRows']} log rows; {s['wdzLogActors']} distinct WDZ actors in those returned logs.")
            lines.append(f"  State totals in that payload: 305={s['selfTotal']:,} vs opponent={s['otherTotal']:,}.")
        if "server_cross" in stats:
            s = stats["server_cross"]
            lines.append(f"• Cross-battle payload captured: {s['command']}.")
        if stats.get("other_server_battle"):
            lines.append("• Other battle commands: " + ", ".join(sorted(stats["other_server_battle"])))
        lines.extend([
            "",
            "Important: a returned top-100 list is not treated as the complete participation roster. The goal of the next training sequence is to expose a feed/paging path that returns everyone who scored.",
        ])
        if hasattr(self, "sequence_event_summary"):
            self.sequence_event_summary.configure(state="normal")
            self.sequence_event_summary.delete("1.0", "end")
            self.sequence_event_summary.insert("1.0", "\n".join(lines) + "\n")
            self.sequence_event_summary.configure(state="disabled")

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}

        if kind == "automation-click":
            self._record_control_step("Button", data.get("buttonName") or "", data.get("observationId"))
        elif kind == "automation-toggle-click":
            self._record_control_step("Toggle", data.get("name") or "", data.get("observationId"))
        elif kind == "automation-control-catalogued":
            if self.session_id:
                self._save_trace_event(kind, data)

        if kind == "automation-replay-result" and self.sequence_waiting and self.sequence_replay_index >= 0:
            step = self.sequence_steps[self.sequence_replay_index] if self.sequence_replay_index < len(self.sequence_steps) else None
            if step:
                if data.get("ok"):
                    self.sequence_waiting = False
                    if self.sequence_replaying:
                        next_index = self.sequence_replay_index + 1
                        delay = self._sequence_delay_for(next_index)
                        self.sequence_replay_status.configure(
                            text=f"Step {self.sequence_replay_index + 1} succeeded: {step.get('name')}. Next step in {delay} ms.",
                            text_color=Colors.SUCCESS,
                        )
                        self.after(delay, self._advance_sequence_replay)
                    else:
                        self.sequence_replay_status.configure(
                            text=f"Step {self.sequence_replay_index + 1} succeeded: {step.get('name')}",
                            text_color=Colors.SUCCESS,
                        )
                        self.sequence_replay_index = -1
                else:
                    replay_key = str(step.get("replayKey") or "")
                    name = str(step.get("name") or "")
                    if replay_key.startswith("@obs:") and not self.sequence_fallback_used and name:
                        self.sequence_fallback_used = True
                        self.sequence_replay_status.configure(
                            text=f"Exact observed control is no longer available; retrying {name} by active GameObject name...",
                            text_color=Colors.MUTED,
                        )
                        self._post_sequence_replay(name)
                    elif self.sequence_replaying:
                        self._finish_sequence_replay(False, f"Replay failed at step {self.sequence_replay_index + 1} ({name}): {data.get('error')}")
                    else:
                        self.sequence_waiting = False
                        self.sequence_replay_index = -1
                        self.sequence_replay_status.configure(
                            text=f"Replay failed for {name}: {data.get('error')}",
                            text_color=Colors.DANGER,
                        )

        if kind == "response":
            command = str(data.get("command") or "")
            raw = data.get("json")
            if command and isinstance(raw, str) and raw:
                try:
                    self._update_event_inspector(command, json.loads(raw))
                except Exception:
                    pass

        super().handle(kind, payload)

    def stop(self) -> None:
        self.stop_sequence_recording()
        if self.sequence_replaying:
            self._finish_sequence_replay(False, "Replay stopped because the capture was packaged.")
        self._write_sequence_to_session()
        super().stop()
