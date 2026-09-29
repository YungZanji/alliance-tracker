from __future__ import annotations

import queue
import time
from collections import Counter
from typing import Any

import customtkinter as ctk

from app import Colors
from app_event_capture import App as BaseApp
from capture import decode_response
from direct_duel import DIRECT_DUEL_CONTEXT_COMMANDS, expected_commands, probe_complete, summarize_response


class App(BaseApp):
    """Experimental read-only Direct Duel probe layered onto the current desktop app."""

    DIRECT_TIMEOUT_SECONDS = 160.0

    def __init__(self) -> None:
        self.direct_duel_active = False
        self.direct_duel_mode = "previous"
        self.direct_duel_session_id = ""
        self.direct_duel_started_at = 0.0
        self.direct_duel_observed: Counter[str] = Counter()
        self.direct_duel_summaries: list[str] = []
        self.direct_duel_finish_scheduled = False
        super().__init__()
        self._build_direct_duel_lab()

    def _build_direct_duel_lab(self) -> None:
        page = self.pages.get("overview")
        if page is None:
            return

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        before = getattr(self, "overview_log", None)
        pack_args: dict[str, Any] = {"fill": "x", "pady": (0, 14)}
        if before is not None:
            pack_args["before"] = before
        panel.pack(**pack_args)

        ctk.CTkLabel(
            panel,
            text="DIRECT DUEL LAB · READ ONLY",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="Request Duel data without opening the ranking screens",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Experimental test of the game's own xLua request path. Alliance Tracker queues only a hard-coded read-only "
                "Duel request set and captures the normal server responses through the existing response hook. No arbitrary "
                "command console is exposed. Keep Last Z in the foreground while the request is being executed."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=12, pady=(0, 8))
        row.grid_columnconfigure((0, 1, 2), weight=1)

        self.direct_previous_button = ctk.CTkButton(
            row,
            text="FETCH PREVIOUS WEEK",
            height=38,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 9, "bold"),
            command=lambda: self._start_direct_duel("previous"),
        )
        self.direct_previous_button.grid(row=0, column=0, sticky="ew", padx=4)
        self.direct_current_button = ctk.CTkButton(
            row,
            text="FETCH CURRENT WEEK",
            height=38,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=lambda: self._start_direct_duel("current"),
        )
        self.direct_current_button.grid(row=0, column=1, sticky="ew", padx=4)
        self.direct_context_button = ctk.CTkButton(
            row,
            text="CONTEXT ONLY",
            height=38,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=lambda: self._start_direct_duel("context"),
        )
        self.direct_context_button.grid(row=0, column=2, sticky="ew", padx=4)

        self.direct_duel_status = ctk.CTkLabel(
            panel,
            text="Ready. Start with Fetch Previous Week; it requests type 3 plus Duel context and writes a normal capture package.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.direct_duel_status.pack(anchor="w", padx=16, pady=(1, 7))

        self.direct_duel_summary = ctk.CTkTextbox(
            panel,
            height=118,
            fg_color=Colors.PANEL2,
            text_color=Colors.MUTED,
            border_width=1,
            border_color=Colors.BORDER,
            corner_radius=10,
            font=("Consolas", 9),
        )
        self.direct_duel_summary.pack(fill="x", padx=16, pady=(0, 14))
        self._set_direct_summary(
            "Previous-week probe sends:\n"
            "  get.alliance.duel.season.info\n"
            "  get.alliance.duel.group.info\n"
            "  al.battle.week.result.info\n"
            "  al.battle.rank.info, type=3\n\n"
            "No request has been run in this app session yet."
        )

    def _set_direct_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "direct_duel_status"):
            self.direct_duel_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Direct Duel: " + text)

    def _set_direct_summary(self, text: str) -> None:
        if not hasattr(self, "direct_duel_summary"):
            return
        self.direct_duel_summary.configure(state="normal")
        self.direct_duel_summary.delete("1.0", "end")
        self.direct_duel_summary.insert("1.0", text.rstrip() + "\n")
        self.direct_duel_summary.configure(state="disabled")

    def _set_direct_buttons(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for name in ("direct_previous_button", "direct_current_button", "direct_context_button"):
            button = getattr(self, name, None)
            if button is not None:
                button.configure(state=state)

    def _start_direct_duel(self, mode: str) -> None:
        if self.session_id or self.direct_duel_active:
            self._set_direct_status("Another capture is active. Stop it before running Direct Duel.", Colors.DANGER)
            return

        self.direct_duel_mode = mode
        self.direct_duel_observed.clear()
        self.direct_duel_summaries = []
        self.direct_duel_finish_scheduled = False
        self._set_direct_buttons(False)
        self._set_direct_status("Preparing the capture engine…", Colors.ACCENT)

        if self.capture.state.ready and self.capture.state.attached:
            self._begin_direct_duel()
            return

        self.attach()
        self.direct_duel_started_at = time.monotonic()
        self.after(250, self._wait_for_direct_attach)

    def _wait_for_direct_attach(self) -> None:
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_direct_duel()
            return
        if time.monotonic() - self.direct_duel_started_at >= 25.0:
            self._set_direct_buttons(True)
            self._set_direct_status("Capture engine was not ready within 25 seconds. Confirm Last Z is running and try again.", Colors.DANGER)
            return
        self.after(250, self._wait_for_direct_attach)

    def _begin_direct_duel(self) -> None:
        try:
            self.capture.capture_all_responses = True
            session_id = self.store.start_session(f"Direct Duel {self.direct_duel_mode.title()} Probe")
            self.session_id = session_id
            self.direct_duel_session_id = session_id
            self.capture.start()
            script = self.capture.state.script
            if script is None:
                raise RuntimeError("Frida agent is not available after attach.")
            queued = dict(script.exports_sync.queue_direct_duel_probe(self.direct_duel_mode) or {})
        except Exception as exc:
            try:
                if self.capture.state.capturing:
                    self.capture.stop()
            except Exception:
                pass
            if self.session_id:
                try:
                    self.store.stop_session(self.session_id)
                except Exception:
                    pass
            self.session_id = None
            self.direct_duel_session_id = ""
            self.capture.capture_all_responses = False
            self._set_direct_buttons(True)
            self._set_direct_status(f"Could not queue Direct Duel probe: {exc}", Colors.DANGER)
            return

        self.direct_duel_active = True
        self.direct_duel_started_at = time.monotonic()
        commands = queued.get("commands") or []
        self._set_direct_status(
            "Probe queued. Put Last Z in the foreground and leave it there; first-time LuaEnv discovery can take up to ~100 seconds.",
            Colors.SUCCESS,
        )
        self._set_direct_summary(
            f"Session: {self.direct_duel_session_id}\n"
            f"Mode: {self.direct_duel_mode}\n"
            f"Queued request #{queued.get('requestId', '—')}\n"
            f"Commands: {', '.join(str(value) for value in commands)}\n\n"
            "Waiting for the game main thread to execute the request…"
        )
        self.after(500, self._poll_direct_duel)

    def _poll_direct_duel(self) -> None:
        if not self.direct_duel_active:
            return
        elapsed = time.monotonic() - self.direct_duel_started_at
        if elapsed >= self.DIRECT_TIMEOUT_SECONDS:
            self._finish_direct_duel(
                "Timed out waiting for the complete response set. The partial capture was packaged for diagnosis.",
                success=False,
            )
            return
        self.after(500, self._poll_direct_duel)

    def _direct_progress_text(self) -> str:
        wanted = expected_commands(self.direct_duel_mode)
        parts = []
        for command, count in wanted.items():
            parts.append(f"{command}: {self.direct_duel_observed.get(command, 0)}/{count}")
        return " · ".join(parts)

    def handle(self, kind: str, payload: Any) -> None:
        if kind == "direct-duel-hook-ready":
            self._set_direct_status("Direct Duel main-thread hook is ready. Waiting for XLua.LuaEnv…", Colors.ACCENT)
        elif kind == "direct-duel-luaenv-ready":
            self._set_direct_status("XLua.LuaEnv found. Preparing the read-only request invoker…", Colors.ACCENT)
        elif kind in {"direct-duel-invoker-ready", "direct-duel-ready"} and self.direct_duel_active:
            self._set_direct_status("Direct request bridge ready. Waiting for the queued Duel request to execute…", Colors.ACCENT)
        elif kind == "direct-duel-executed" and self.direct_duel_active:
            self._set_direct_status("Request sent through the game's own SFSNetwork path. Waiting for server responses…", Colors.SUCCESS)
        elif kind == "direct-duel-error" and self.direct_duel_active:
            self._set_direct_status("Direct request execution failed: " + str(payload.get("error") or "unknown error"), Colors.DANGER)

        if kind == "response" and self.direct_duel_active:
            try:
                command, _sequence, _captured, decoded = decode_response(payload)
            except Exception:
                command = ""
                decoded = None
            if command in set(DIRECT_DUEL_CONTEXT_COMMANDS) | {"al.battle.rank.info"}:
                self.direct_duel_observed[command] += 1
                self.direct_duel_summaries.append(summarize_response(command, decoded))
                self._set_direct_status("Receiving direct Duel data: " + self._direct_progress_text(), Colors.ACCENT)

        super().handle(kind, payload)

        if kind == "response" and self.direct_duel_active and not self.direct_duel_finish_scheduled:
            if probe_complete(self.direct_duel_mode, self.direct_duel_observed):
                self.direct_duel_finish_scheduled = True
                self.after(1200, lambda: self._finish_direct_duel("Complete response set captured.", success=True))

    def _finish_direct_duel(self, reason: str, success: bool) -> None:
        if not self.direct_duel_active:
            return
        session_id = str(self.session_id or self.direct_duel_session_id or "")
        try:
            self.capture.stop()
            while True:
                try:
                    event = self.capture.events.get_nowait()
                except queue.Empty:
                    break
                # Capture late responses, but do not recursively schedule another finish.
                was_scheduled = self.direct_duel_finish_scheduled
                self.direct_duel_finish_scheduled = True
                self.handle(event.kind, event.payload)
                self.direct_duel_finish_scheduled = was_scheduled or True
            if session_id:
                self.store.stop_session(session_id)
                package = self.store.package(session_id)
            else:
                package = None
        except Exception as exc:
            package = None
            reason = f"{reason} Packaging error: {exc}"
            success = False

        self.session_id = None
        self.direct_duel_active = False
        self.direct_duel_session_id = ""
        self.capture.capture_all_responses = False
        self.direct_duel_finish_scheduled = False
        self._set_direct_buttons(True)
        self.refresh_sessions()

        wanted = expected_commands(self.direct_duel_mode)
        lines = [
            f"Mode: {self.direct_duel_mode}",
            f"Result: {'COMPLETE' if success else 'PARTIAL / DIAGNOSTIC'}",
            reason,
            "",
            "Responses:",
        ]
        for command, count in wanted.items():
            lines.append(f"  {command}: {self.direct_duel_observed.get(command, 0)}/{count}")
        if self.direct_duel_summaries:
            lines += ["", "Decoded summary:"] + [f"  - {item}" for item in self.direct_duel_summaries]
        if package is not None:
            lines += ["", f"Package: {package}"]
        self._set_direct_summary("\n".join(lines))
        self._set_direct_status(
            ("Direct Duel probe completed and packaged." if success else "Direct Duel probe stopped with partial diagnostic data."),
            Colors.SUCCESS if success else Colors.DANGER,
        )
