from __future__ import annotations

import json
from collections import Counter
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v061 import App as BaseApp
from capture import AUTOMATION_TRACE_KINDS
from utils import SESSIONS_DIR


class App(BaseApp):
    """Alliance Tracker 0.7 automation-discovery build.

    Normal capture remains user-driven. While the user performs one training run,
    the runtime agent records the Unity click -> SmartFox request -> decoded response
    path into raw/automation-trace.jsonl for replay-profile analysis.
    """

    def __init__(self) -> None:
        self.trace_counts: Counter[str] = Counter()
        super().__init__()

    def start(self) -> None:
        self.trace_counts.clear()
        super().start()

    def _capture(self) -> None:
        super()._capture()
        page = self.pages["capture"]
        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=14,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x", pady=(10, 4))
        ctk.CTkLabel(
            panel,
            text="Automation training trace",
            text_color=Colors.ACCENT,
            font=(self.font, 12, "bold"),
        ).pack(anchor="w", padx=15, pady=(12, 2))
        ctk.CTkLabel(
            panel,
            text=(
                "Every capture records the internal chain behind your normal clicks: Unity button, "
                "SmartFox request, request payload, native call path and matching decoded response. "
                "For the training run, open each Alliance Duel view once in the exact order you want the "
                "future automatic run to use. The trace is included in the packaged session ZIP."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=15, pady=(0, 11))

    def _save_trace_event(self, kind: str, payload: dict[str, Any]) -> None:
        if not self.session_id:
            return
        root = SESSIONS_DIR / self.session_id / "raw"
        root.mkdir(parents=True, exist_ok=True)
        item = {"kind": kind, **payload}
        with (root / "automation-trace.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        self.trace_counts[kind] += 1
        (root / "automation-trace-summary.json").write_text(
            json.dumps(
                {
                    "sessionId": self.session_id,
                    "counts": dict(sorted(self.trace_counts.items())),
                    "purpose": "manual click to internal request/response replay discovery",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def handle(self, kind: str, payload: Any) -> None:
        data = payload if isinstance(payload, dict) else {}

        if kind == "automation-trace-ready":
            self.write(
                "Automation trace ready: "
                f"button={'yes' if data.get('buttonHook') else 'no'}, "
                f"constructor={'yes' if data.get('extensionRequestHook') else 'no'}, "
                f"send={'yes' if data.get('smartFoxHook') else 'no'}"
            )

        if kind == "automation-request-inspector-ready":
            self.write(
                f"Send-time request inspector ready. {data.get('hooks') or 0} SmartFox send hook(s) active."
            )

        if kind in AUTOMATION_TRACE_KINDS and kind != "automation-trace-ready":
            self._save_trace_event(kind, data)
            if kind == "automation-click":
                self.write(f"Trace click: {data.get('buttonName') or '<unnamed button>'}")
            elif kind == "automation-request-created":
                command = data.get("command") or "<command not decoded yet>"
                button = data.get("buttonName") or "no recent button"
                request_class = data.get("requestClass") or data.get("payloadClass") or "request"
                source = "send inspector" if data.get("fallbackInspection") else "constructor"
                self.write(f"Trace request: {command}  <-  {button} [{request_class}; {source}]")
            elif kind == "automation-request-sent":
                command = data.get("command") or "<unmapped request>"
                request_class = data.get("requestClass") or "request"
                self.write(f"Trace sent: {command} [{request_class}]")
            elif kind == "automation-response":
                command = data.get("command") or "<unknown response>"
                latency = data.get("requestToResponseMs")
                suffix = f" ({latency} ms)" if latency is not None else ""
                self.write(f"Trace response: {command}{suffix}")

        if kind == "automation-trace-error":
            stage = data.get("stage")
            prefix = f"{stage}: " if stage else ""
            self.write(f"Automation trace error: {prefix}{data.get('error') or payload}")

        super().handle(kind, payload)
