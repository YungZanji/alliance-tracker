from __future__ import annotations

import json
import time
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v080 import App as BaseApp


class App(BaseApp):
    """Alliance Tracker 0.9 unattended Alliance Duel profile proof.

    This review build still expects Last Z to already be running and attached. Once
    started, however, the Alliance Duel profile resolves active Unity controls by
    GameObject name and drives the event/ranking/toggle sequence without mouse input.
    """

    def __init__(self) -> None:
        self.auto_running = False
        self.auto_phase = "idle"
        self.auto_current_control = ""
        self.auto_deadline = 0.0
        self.auto_retries: dict[str, int] = {}
        self.auto_seen_season = False
        self.auto_rank_types: set[int] = set()
        self.auto_type2_rows = 0
        super().__init__()

    def _layout(self) -> None:
        super()._layout()
        self._automation_page()

        side = next(iter(self.nav.values())).master
        auto_nav = ctk.CTkButton(
            side,
            text="Automation",
            anchor="w",
            height=43,
            corner_radius=10,
            fg_color="transparent",
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 13, "bold"),
            command=lambda: self.show("automation"),
        )
        auto_nav.grid(row=7, column=0, sticky="ew", padx=11, pady=3)
        self.nav["automation"] = auto_nav

    def _automation_page(self) -> None:
        page = self.page(
            "automation",
            "Alliance Duel automation",
            "Run the first no-mouse Alliance Duel collection profile through Last Z's own Unity controls.",
        )

        intro = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        intro.pack(fill="x")
        ctk.CTkLabel(
            intro,
            text="AUTOMATION PROOF",
            text_color=Colors.ACCENT,
            font=(self.font, 11, "bold"),
        ).pack(anchor="w", padx=17, pady=(16, 2))
        ctk.CTkLabel(
            intro,
            text="Alliance Duel daily collection",
            text_color=Colors.TEXT,
            font=(self.font, 20, "bold"),
        ).pack(anchor="w", padx=17)
        ctk.CTkLabel(
            intro,
            text=(
                "For this review test, Last Z should already be open in the city and Alliance Tracker should be attached. "
                "After you press Run, do not touch the game. The tracker will resolve and press the active Unity controls itself."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(3, 14))

        self.auto_run_button = ctk.CTkButton(
            intro,
            text="RUN ALLIANCE DUEL AUTO TEST",
            height=52,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 13, "bold"),
            command=self.run_duel_profile,
        )
        self.auto_run_button.pack(fill="x", padx=17, pady=(0, 10))
        self.auto_stop_button = ctk.CTkButton(
            intro,
            text="Stop automation",
            height=36,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 10, "bold"),
            state="disabled",
            command=lambda: self._automation_fail("Stopped by user."),
        )
        self.auto_stop_button.pack(anchor="w", padx=17, pady=(0, 16))

        progress = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        progress.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(
            progress,
            text="Profile progress",
            text_color=Colors.TEXT,
            font=(self.font, 15, "bold"),
        ).pack(anchor="w", padx=17, pady=(15, 8))

        self.auto_steps: dict[str, ctk.CTkLabel] = {}
        for key, label in (
            ("event", "Open Alliance Duel"),
            ("base", "Capture season, current day and completed days"),
            ("rank", "Open rankings"),
            ("weekly", "Capture weekly combined"),
            ("alliance", "Capture My Alliance weekly roster"),
        ):
            row = ctk.CTkFrame(progress, fg_color="transparent")
            row.pack(fill="x", padx=17, pady=3)
            ctk.CTkLabel(row, text=label, text_color=Colors.MUTED, font=(self.font, 10)).pack(side="left")
            status = ctk.CTkLabel(row, text="Waiting", text_color=Colors.MUTED, font=(self.font, 10, "bold"))
            status.pack(side="right")
            self.auto_steps[key] = status

        self.auto_status = ctk.CTkLabel(
            progress,
            text="Ready. No automatic run has started yet.",
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        )
        self.auto_status.pack(anchor="w", padx=17, pady=(12, 16))

        note = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL2,
            corner_radius=14,
            border_width=1,
            border_color=Colors.BORDER,
        )
        note.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(
            note,
            text=(
                "This stage intentionally stops after collection. Once this profile succeeds from the city with no game input, "
                "the next stage will add automatic cloud sync, Last Z launch/attach, and reset scheduling."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=15, pady=13)

    def _set_auto_step(self, key: str, text: str, color: Any = None) -> None:
        widget = self.auto_steps.get(key)
        if widget:
            widget.configure(text=text, text_color=color or Colors.MUTED)

    def _set_auto_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "auto_status"):
            self.auto_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Automation: " + text)

    def _reset_auto_ui(self) -> None:
        for key in self.auto_steps:
            self._set_auto_step(key, "Waiting", Colors.MUTED)

    def run_duel_profile(self) -> None:
        if self.auto_running:
            return
        if not self.capture.state.attached or not self.capture.state.ready:
            self._set_auto_status("Attach to Last Z first and wait until the capture engine is ready.", Colors.DANGER)
            return

        if not self.session_id:
            try:
                if not self.label.get().strip():
                    self.label.insert(0, "Alliance Duel Automated Test")
                self.start()
            except Exception as exc:
                self._set_auto_status(f"Could not start capture: {exc}", Colors.DANGER)
                return
            if not self.session_id:
                self._set_auto_status("Capture did not start.", Colors.DANGER)
                return

        self.auto_running = True
        self.auto_phase = "opening_event"
        self.auto_current_control = ""
        self.auto_deadline = time.monotonic() + 10.0
        self.auto_retries.clear()
        self.auto_seen_season = False
        self.auto_rank_types.clear()
        self.auto_type2_rows = 0
        self._reset_auto_ui()
        self.auto_run_button.configure(state="disabled", text="AUTOMATION RUNNING")
        self.auto_stop_button.configure(state="normal")
        self._set_auto_step("event", "Running", Colors.ACCENT)
        self._set_auto_status("Resolving the Alliance Duel button from the live city UI...")
        self.after(200, lambda: self._queue_auto_control("UIMain_icon_AlCompete"))
        self.after(250, self._automation_tick)

    def _queue_auto_control(self, name: str) -> None:
        if not self.auto_running:
            return
        script = getattr(self.capture.state, "script", None)
        if script is None:
            self._automation_fail("Capture script is no longer attached.")
            return
        self.auto_current_control = name
        self.auto_deadline = time.monotonic() + 8.0
        self.auto_retries[name] = self.auto_retries.get(name, 0) + 1
        try:
            script.post({"type": "automation-replay-control", "payload": {"name": name}})
        except Exception as exc:
            self._automation_fail(f"Could not queue {name}: {exc}")

    def _retry_auto_control(self, name: str) -> None:
        if not self.auto_running or self.auto_current_control != name:
            return
        attempts = self.auto_retries.get(name, 0)
        if attempts >= 8:
            self._automation_fail(f"Could not resolve/replay {name} after {attempts} attempts.")
            return
        self._set_auto_status(f"{name} is not ready yet; retrying ({attempts + 1}/8)...")
        self.after(500, lambda: self._queue_auto_control(name))

    def _automation_tick(self) -> None:
        if not self.auto_running:
            return
        if time.monotonic() > self.auto_deadline:
            if self.auto_phase == "wait_base" and not (self.auto_seen_season and {0, 3}.issubset(self.auto_rank_types)):
                self._automation_fail(
                    "Timed out waiting for season/current/completed-day data after opening Alliance Duel."
                )
                return
            if self.auto_phase == "wait_weekly" and 1 not in self.auto_rank_types:
                self._automation_fail("Timed out waiting for weekly combined ranking data.")
                return
            if self.auto_phase == "wait_alliance" and 2 not in self.auto_rank_types:
                self._automation_fail("Timed out waiting for the My Alliance weekly roster.")
                return
        self._maybe_advance_automation()
        if self.auto_running:
            self.after(250, self._automation_tick)

    def _maybe_advance_automation(self) -> None:
        if not self.auto_running:
            return

        if self.auto_phase == "wait_base" and self.auto_seen_season and {0, 3}.issubset(self.auto_rank_types):
            self._set_auto_step("base", "Captured", Colors.SUCCESS)
            self._set_auto_step("rank", "Running", Colors.ACCENT)
            self.auto_phase = "opening_rank"
            self._set_auto_status("Base Alliance Duel data captured. Opening rankings...")
            self.after(250, lambda: self._queue_auto_control("rankBtn"))
            return

        if self.auto_phase == "wait_weekly" and 1 in self.auto_rank_types:
            self._set_auto_step("weekly", "Captured", Colors.SUCCESS)
            self._set_auto_step("alliance", "Running", Colors.ACCENT)
            self.auto_phase = "opening_alliance"
            self._set_auto_status("Weekly combined captured. Switching to My Alliance...")
            self.after(250, lambda: self._queue_auto_control("Toggle3"))
            return

        if self.auto_phase == "wait_alliance" and 2 in self.auto_rank_types:
            if self.auto_type2_rows < 1:
                return
            self._set_auto_step("alliance", f"Captured ({self.auto_type2_rows})", Colors.SUCCESS)
            self._automation_success()

    def _automation_success(self) -> None:
        self.auto_running = False
        self.auto_phase = "complete"
        self.auto_current_control = ""
        self.auto_run_button.configure(state="normal", text="RUN ALLIANCE DUEL AUTO TEST")
        self.auto_stop_button.configure(state="disabled")
        self._set_auto_status(
            f"Alliance Duel profile complete with no game input. My Alliance roster rows: {self.auto_type2_rows}.",
            Colors.SUCCESS,
        )

    def _automation_fail(self, message: str) -> None:
        was_running = self.auto_running
        self.auto_running = False
        self.auto_phase = "failed"
        self.auto_current_control = ""
        if hasattr(self, "auto_run_button"):
            self.auto_run_button.configure(state="normal", text="RUN ALLIANCE DUEL AUTO TEST")
        if hasattr(self, "auto_stop_button"):
            self.auto_stop_button.configure(state="disabled")
        self._set_auto_status(message, Colors.DANGER if was_running else Colors.MUTED)

    def _handle_auto_replay_result(self, data: dict[str, Any]) -> None:
        if not self.auto_running:
            return
        name = str(data.get("name") or "")
        if not name or name != self.auto_current_control:
            return
        if not data.get("ok"):
            self._retry_auto_control(name)
            return

        if name == "UIMain_icon_AlCompete":
            self._set_auto_step("event", "Opened", Colors.SUCCESS)
            self._set_auto_step("base", "Waiting for data", Colors.ACCENT)
            self.auto_phase = "wait_base"
            self.auto_current_control = ""
            self.auto_deadline = time.monotonic() + 8.0
            self._set_auto_status("Alliance Duel opened internally. Waiting for season/current/completed-day responses...")
        elif name == "rankBtn":
            self._set_auto_step("rank", "Opened", Colors.SUCCESS)
            self._set_auto_step("weekly", "Running", Colors.ACCENT)
            self.auto_phase = "opening_weekly"
            self.auto_current_control = ""
            self._set_auto_status("Rankings opened internally. Switching to Weekly...")
            self.after(800, lambda: self._queue_auto_control("Toggle2"))
        elif name == "Toggle2":
            self.auto_phase = "wait_weekly"
            self.auto_current_control = ""
            self.auto_deadline = time.monotonic() + 8.0
            self._set_auto_status("Weekly toggle replayed. Waiting for rankType 1...")
        elif name == "Toggle3":
            self.auto_phase = "wait_alliance"
            self.auto_current_control = ""
            self.auto_deadline = time.monotonic() + 8.0
            self._set_auto_status("My Alliance toggle replayed. Waiting for the authoritative WDZ roster...")

    def _observe_profile_response(self, kind: str, payload: dict[str, Any]) -> None:
        if not self.auto_running or kind != "response":
            return
        command = str(payload.get("command") or "")
        if command == "get.alliance.duel.season.info":
            self.auto_seen_season = True
            self._maybe_advance_automation()
            return
        if command != "al.battle.rank.info":
            return
        try:
            decoded = json.loads(str(payload.get("json") or "{}"))
            rank_type = int(decoded.get("type"))
        except Exception:
            return
        self.auto_rank_types.add(rank_type)
        if rank_type == 2:
            rows = decoded.get("rankInfo") or []
            self.auto_type2_rows = len(rows) if isinstance(rows, list) else 0
        self._maybe_advance_automation()

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}

        if kind == "automation-resolver-ready":
            self.write("Automatic Unity control resolver ready: GameObject.Find + GetComponent")
        elif kind == "automation-control-resolve":
            if self.session_id:
                self._save_trace_event(kind, data)
            if data.get("ok"):
                self.write(
                    f"Resolved active control: {data.get('name')} [{data.get('controlType')}] via {data.get('method')}"
                )
            elif self.auto_running and data.get("name") == self.auto_current_control:
                self.write(f"Control not active yet: {data.get('name')}")
        elif kind == "automation-resolver-error":
            if self.session_id:
                self._save_trace_event(kind, data)
            self.write(f"Unity resolver error: {data.get('error') or data}")
        elif kind == "automation-replay-result":
            self._handle_auto_replay_result(data)

        self._observe_profile_response(kind, data)
        super().handle(kind, payload)
