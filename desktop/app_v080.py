from __future__ import annotations

from typing import Any

import customtkinter as ctk

from app import Colors
from app_v070 import App as BaseApp


class App(BaseApp):
    """Alliance Tracker 0.8 internal Unity-control replay proof."""

    def __init__(self) -> None:
        self.replay_attempts = 0
        self.replay_successes = 0
        super().__init__()

    def _layout(self) -> None:
        super()._layout()

        # Replay used to be appended below the Capture page. On common 1080p/windowed
        # layouts that placed the controls below the non-scrollable viewport. Give the
        # proof its own first-class page so the test is always reachable.
        self._replay_page()

        side = next(iter(self.nav.values())).master
        replay_nav = ctk.CTkButton(
            side,
            text="Replay Test",
            anchor="w",
            height=43,
            corner_radius=10,
            fg_color="transparent",
            hover_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            font=(self.font, 13, "bold"),
            command=lambda: self.show("replay"),
        )
        replay_nav.grid(row=6, column=0, sticky="ew", padx=11, pady=3)
        self.nav["replay"] = replay_nav

    def _capture(self) -> None:
        # Keep Capture focused on capture. Replay has its own sidebar page.
        super()._capture()

    def _replay_page(self) -> None:
        page = self.page(
            "replay",
            "Internal replay test",
            "Trigger an already observed Last Z Unity control from inside the game process without moving the mouse.",
        )

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x")

        ctk.CTkLabel(
            panel,
            text="NEXT TEST",
            text_color=Colors.ACCENT,
            font=(self.font, 11, "bold"),
        ).pack(anchor="w", padx=17, pady=(16, 2))
        ctk.CTkLabel(
            panel,
            text=(
                "1. Attach and start a capture.  2. Open Alliance Duel rankings manually.  "
                "3. Click segment_1 once in Last Z so the control is observed.  "
                "4. Stop touching Last Z.  5. Press the large button below."
            ),
            text_color=Colors.TEXT,
            font=(self.font, 11),
            wraplength=920,
            justify="left",
        ).pack(anchor="w", padx=17, pady=(0, 14))

        self.primary_replay_button = ctk.CTkButton(
            panel,
            text="TEST INTERNAL REPLAY — segment_1",
            height=54,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 14, "bold"),
            command=lambda: self.replay_control_named("segment_1"),
        )
        self.primary_replay_button.pack(fill="x", padx=17, pady=(0, 16))

        mapping = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        mapping.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(
            mapping,
            text="Confirmed controls",
            text_color=Colors.TEXT,
            font=(self.font, 15, "bold"),
        ).pack(anchor="w", padx=17, pady=(15, 5))
        ctk.CTkLabel(
            mapping,
            text=(
                "Toggle2 = Weekly combined ranking\n"
                "Toggle3 = My Alliance weekly ranking\n"
                "CheckBox = UI state control; no ranking response observed by itself"
            ),
            text_color=Colors.MUTED,
            font=(self.font, 10),
            justify="left",
        ).pack(anchor="w", padx=17, pady=(0, 12))

        row = ctk.CTkFrame(mapping, fg_color="transparent")
        row.pack(fill="x", padx=17, pady=(0, 12))
        self.replay_control = ctk.CTkComboBox(
            row,
            values=[
                "segment_1",
                "segment_2",
                "segment_3",
                "segment_4",
                "segment_5",
                "segment_6",
                "rankBtn",
                "UIMain_icon_AlCompete",
                "Toggle2",
                "Toggle3",
                "CheckBox",
            ],
            width=280,
            height=40,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 10),
        )
        self.replay_control.set("segment_1")
        self.replay_control.pack(side="left")
        ctk.CTkButton(
            row,
            text="Replay selected control",
            height=40,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            border_width=1,
            border_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 11, "bold"),
            command=self.replay_selected_control,
        ).pack(side="left", padx=8)

        self.replay_status = ctk.CTkLabel(
            mapping,
            text="Attach and start a capture before using replay.",
            text_color=Colors.MUTED,
            font=(self.font, 10),
            wraplength=900,
            justify="left",
        )
        self.replay_status.pack(anchor="w", padx=17, pady=(0, 15))

    def replay_control_named(self, name: str) -> None:
        name = str(name or "").strip()
        if not name:
            self.replay_status.configure(text="Choose a control to replay.", text_color=Colors.DANGER)
            return
        script = getattr(self.capture.state, "script", None)
        if script is None or not self.capture.state.attached:
            self.replay_status.configure(text="Attach to Last Z first.", text_color=Colors.DANGER)
            return
        if not self.session_id:
            self.replay_status.configure(text="Start a capture before testing internal replay.", text_color=Colors.DANGER)
            return
        try:
            script.post({"type": "automation-replay-control", "payload": {"name": name}})
        except Exception as exc:
            self.replay_status.configure(text=f"Could not queue replay: {exc}", text_color=Colors.DANGER)
            return
        self.replay_attempts += 1
        self.replay_status.configure(
            text=f"Replay request sent for {name}. Do not touch Last Z; waiting for the game's main thread.",
            text_color=Colors.MUTED,
        )
        self.write(f"Internal replay queued from UI: {name}")

    def replay_selected_control(self) -> None:
        self.replay_control_named(self.replay_control.get())

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}

        if kind == "automation-replay-ready":
            supports = ", ".join(data.get("supports") or [])
            self.write(
                f"Internal Unity replay ready. {data.get('controlHooks') or 0} control hook(s), "
                f"{data.get('mainThreadHooks') or 0} main-thread hook(s). {supports}"
            )
            if hasattr(self, "replay_status"):
                self.replay_status.configure(
                    text="Replay engine ready. Prime segment_1 once, then use the large test button.",
                    text_color=Colors.SUCCESS,
                )

        elif kind == "automation-control-observed":
            name = data.get("name") or "<unnamed>"
            control_type = data.get("controlType") or "control"
            self.write(f"Observed Unity control: {control_type} {name}")

        elif kind == "automation-toggle-click":
            if self.session_id:
                self._save_trace_event(kind, data)
            name = data.get("name") or "<unnamed toggle>"
            self.write(f"Trace toggle: {name}")

        elif kind == "automation-replay-queued":
            if self.session_id:
                self._save_trace_event(kind, data)
            name = data.get("name") or "control"
            self.write(f"Replay accepted by agent: {name}")

        elif kind == "automation-replay-result":
            if self.session_id:
                self._save_trace_event(kind, data)
            name = data.get("name") or "control"
            if data.get("ok"):
                self.replay_successes += 1
                method = data.get("method") or "Unity control"
                message = f"INTERNAL REPLAY SUCCEEDED: {name} via {method}. Wait for the fresh game response."
                self.write(message)
                if hasattr(self, "replay_status"):
                    self.replay_status.configure(text=message, text_color=Colors.SUCCESS)
                if hasattr(self, "primary_replay_button") and name == "segment_1":
                    self.primary_replay_button.configure(text="REPLAY SUCCEEDED — WAIT FOR RANK RESPONSE")
            else:
                error = data.get("error") or "Unknown replay failure"
                message = f"INTERNAL REPLAY FAILED for {name}: {error}"
                self.write(message)
                if hasattr(self, "replay_status"):
                    self.replay_status.configure(text=message, text_color=Colors.DANGER)

        super().handle(kind, payload)
