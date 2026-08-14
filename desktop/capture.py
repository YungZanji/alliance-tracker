from __future__ import annotations

import json
import queue
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import frida

from utils import utc_now

PROCESS_NAME = "Survival.exe"
ALLIANCE_DUEL_COMMANDS = {
    "al.battle.rank.info",
    "al.battle.week.result.info",
    "get.alliance.duel.season.info",
}
ALLIANCE_DISCOVERY_COMMANDS = {
    "get.alliance.vote",
    "get.alliance.notice",
}
CONFIRMED_EVENT_COMMANDS = {
    "server.battle.maininfo",
    "server.battle.score.info",
    "server.battle.user.score.rank",
    "server.battle.rank",
    "server.battle.score.person.rank",
    "server.battle.score.ali.rank",
    "server.cross.battle.maininfo",
    "get.person.arms.group.rank",
}
DISCOVERY_KEYWORDS = (
    "glory",
    "ruler",
    "server.battle",
    "server.cross.battle",
    "cross.battle",
    "arms.group",
    "state.battle",
    "state.ruler",
    "throne",
    "svs",
    "alliance.vote",
    "alliance.notice",
)
TARGET_COMMANDS = ALLIANCE_DUEL_COMMANDS | ALLIANCE_DISCOVERY_COMMANDS | CONFIRMED_EVENT_COMMANDS
AUTOMATION_TRACE_KINDS = {
    "automation-click",
    "automation-request-created",
    "automation-request-sent",
    "automation-response",
    "automation-trace-ready",
    "automation-control-catalogued",
    "automation-control-observed",
    "automation-control-auto-observed",
    "automation-control-resolve",
    "automation-lifecycle-catalog-ready",
    "automation-lifecycle-catalog-error",
    "automation-replay-diagnostics-ready",
    "automation-replay-queued",
    "automation-replay-result",
    "automation-toggle-click",
}


def is_discovery_command(command: str) -> bool:
    value = command.strip().lower()
    return value in TARGET_COMMANDS or any(keyword in value for keyword in DISCOVERY_KEYWORDS)


@dataclass
class Event:
    kind: str
    payload: Any


@dataclass
class State:
    device: Any | None = None
    session: Any | None = None
    script: Any | None = None
    pid: int | None = None
    attached: bool = False
    ready: bool = False
    capturing: bool = False
    tracing: bool = False
    discovery_all: bool = False
    counters: dict[str, Any] = field(default_factory=dict)


class CaptureController:
    def __init__(self, agent_dir: Path) -> None:
        self.agent_dir = agent_dir
        self.state = State()
        self.events: queue.Queue[Event] = queue.Queue()
        # Default remains zero so every existing visible/manual capture behaves exactly
        # as before. The 1.6.1 unattended wrapper opts into a short delay between the
        # native Frida session attach and loading the full Unity/SmartFox agent.
        self.pre_script_load_delay_seconds = 0.0
        # Full response discovery is deliberately opt-in. Production Duel/Poll/Event
        # captures continue using the proven command allowlists.
        self.capture_all_responses = False

    def _source(self) -> str:
        parts = sorted(self.agent_dir.glob("part*.js"))
        if not parts:
            raise RuntimeError(f"Capture agent parts are missing from {self.agent_dir}")
        return "\n".join(path.read_text(encoding="utf-8") for path in parts)

    @staticmethod
    def _local_device() -> Any:
        getter = getattr(frida, "get_local_device", None)
        if callable(getter):
            return getter()

        manager_getter = getattr(frida, "get_device_manager", None)
        if not callable(manager_getter):
            raise RuntimeError("This Frida installation does not expose a local-device API.")

        manager = manager_getter()
        for device in manager.enumerate_devices():
            if getattr(device, "type", None) == "local" or getattr(device, "id", None) == "local":
                return device
        raise RuntimeError("Frida could not find the local Windows device.")

    def attach(self) -> None:
        if self.state.attached:
            return

        device = self._local_device()
        processes = device.enumerate_processes()
        process = next(
            (item for item in processes if str(getattr(item, "name", "")).lower() == PROCESS_NAME.lower()),
            None,
        )
        if process is None:
            raise RuntimeError("Survival.exe is not running. Open Last Z and enter the city first.")

        session = device.attach(process.pid)
        delay = max(0.0, min(10.0, float(self.pre_script_load_delay_seconds or 0.0)))
        self.pre_script_load_delay_seconds = 0.0
        if delay:
            self.events.put(Event("attach-settle", {"pid": process.pid, "seconds": delay}))
            time.sleep(delay)
        script = session.create_script(self._source())
        script.on("message", self._on_message)
        session.on("detached", self._on_detached)
        script.load()

        self.state.device = device
        self.state.session = session
        self.state.script = script
        self.state.pid = process.pid
        self.state.attached = True
        self.events.put(Event("attached", {"pid": process.pid}))

    def start(self) -> dict[str, Any]:
        if not self.state.script or not self.state.ready:
            raise RuntimeError("The decoded-response hook is not ready yet.")
        discovery_all = bool(self.capture_all_responses)
        try:
            mode = dict(self.state.script.exports_sync.set_discovery_capture(discovery_all) or {})
        except Exception as error:
            if discovery_all:
                raise RuntimeError(f"This capture agent does not support Full Data Discovery yet: {error}") from error
            mode = {"captureAllResponses": False}
        self.state.discovery_all = discovery_all
        status = self.state.script.exports_sync.start_capture()
        trace_status: dict[str, Any] = {}
        try:
            trace_status = dict(self.state.script.exports_sync.start_automation_trace() or {})
            self.state.tracing = bool(trace_status.get("enabled"))
        except Exception as error:
            self.events.put(Event("automation-trace-error", {"error": str(error)}))
            self.state.tracing = False
        self.state.capturing = True
        return {
            **dict(status or {}),
            "discoveryMode": mode,
            "discoveryAll": discovery_all,
            "automationTrace": trace_status,
        }

    def stop(self) -> dict[str, Any]:
        trace_status: dict[str, Any] = {}
        if self.state.script and self.state.tracing:
            try:
                trace_status = dict(self.state.script.exports_sync.stop_automation_trace() or {})
            except Exception as error:
                self.events.put(Event("automation-trace-error", {"error": str(error)}))
        status = self.state.script.exports_sync.stop_capture() if self.state.script else {}
        self.state.capturing = False
        self.state.tracing = False
        self.state.counters = dict(status.get("counters") or {})
        return {
            **dict(status or {}),
            "discoveryAll": bool(self.state.discovery_all),
            "automationTrace": trace_status,
        }

    def status(self) -> dict[str, Any]:
        status = dict(self.state.script.exports_sync.get_status() or {}) if self.state.script else {}
        if self.state.script:
            try:
                status["automationTrace"] = dict(
                    self.state.script.exports_sync.get_automation_trace_status() or {}
                )
            except Exception:
                pass
        status["discoveryAll"] = bool(self.state.discovery_all)
        return status

    def detach(self) -> None:
        try:
            if self.state.script and self.state.tracing:
                self.state.script.exports_sync.stop_automation_trace()
        except Exception:
            pass
        try:
            if self.state.script and self.state.capturing:
                self.state.script.exports_sync.stop_capture()
        except Exception:
            pass
        try:
            if self.state.session:
                self.state.session.detach()
        except Exception:
            pass
        self.state = State()
        self.capture_all_responses = False

    def _on_detached(self, reason: str, crash: Any = None) -> None:
        self.state = State()
        self.capture_all_responses = False
        self.events.put(Event("detached", {"reason": reason, "crash": str(crash or "")}))

    def _on_message(self, message: dict[str, Any], data: bytes | None) -> None:
        if message.get("type") == "error":
            self.events.put(Event("agent-error", message))
            return
        payload = message.get("payload")
        if not isinstance(payload, dict):
            return
        kind = str(payload.get("kind") or "message")
        if kind == "hook-ready":
            self.state.ready = True
        if kind in {"lua-stack-response", "lua-object-response", "extension-response"}:
            command = str(payload.get("command") or "")
            if command and (self.state.discovery_all or is_discovery_command(command)):
                self.events.put(Event("response", payload))
                return
        self.events.put(Event(kind, payload))


def decode_response(payload: dict[str, Any]) -> tuple[str, int | None, str, Any]:
    command = str(payload.get("command") or "")
    raw = payload.get("json")
    if not isinstance(raw, str) or not raw:
        raise ValueError(f"Response {command!r} did not contain decoded JSON.")
    return command, payload.get("sequence"), str(payload.get("observedAt") or utc_now()), json.loads(raw)
