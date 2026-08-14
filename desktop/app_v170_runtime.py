from __future__ import annotations

import csv
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import customtkinter as ctk

from app import Colors
from app_v140_runtime import CAPTURE_PURPOSES
from app_v162_runtime import App as BaseApp
from utils import SESSIONS_DIR, utc_now


FULL_DISCOVERY_PURPOSE = "Full Data Discovery"
BROAD_DISCOVERY_PURPOSES = {
    FULL_DISCOVERY_PURPOSE,
    "Arena Power + Last Online",
    "Total Power + Last Online",
}
TIMELINE_KINDS = {
    "dispatch-response",
    "response",
    "automation-click",
    "automation-toggle-click",
    "automation-request-created",
    "automation-request-sent",
    "automation-response",
    "diagnostic",
}
FIELD_KEYWORDS = (
    "power",
    "combat",
    "fight",
    "strength",
    "online",
    "offline",
    "login",
    "logout",
    "active",
    "last",
    "arena",
    "arms",
    "rank",
    "score",
    "uid",
    "name",
    "level",
    "alliance",
    "server",
)
COMMAND_KEYWORDS = (
    "user",
    "player",
    "person",
    "member",
    "alliance",
    "arena",
    "rank",
    "arms",
    "power",
    "info",
)

# Mutate the shared Capture Studio purpose registry before the inherited layout is
# constructed. Existing purposes remain unchanged; this only adds an explicit broad
# decoder mode for reverse-engineering new read-only datasets.
CAPTURE_PURPOSES[FULL_DISCOVERY_PURPOSE] = (
    "Capture every decoded game response the current hook can safely serialize, plus a command/click timeline. "
    "Use this while manually opening unknown screens such as Arena rankings, Alliance members and player profiles."
)


class App(BaseApp):
    """1.7.0 discovery review: opt-in broad response capture for training new datasets."""

    def __init__(self) -> None:
        self.discovery_session_id = ""
        self.discovery_enabled = False
        self.discovery_marker_count = 0
        super().__init__()

    def _layout(self) -> None:
        super()._layout()
        self._add_discovery_tools()

    def _add_discovery_tools(self) -> None:
        page = self.pages.get("overview")
        if not page or not hasattr(self, "overview_log"):
            return

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x", pady=(0, 14), before=self.overview_log)

        ctk.CTkLabel(
            panel,
            text="FULL DATA DISCOVERY",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="Teach the tracker an unknown screen without guessing its command first.",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Choose Full Data Discovery, Arena Power + Last Online, or Total Power + Last Online in Capture Studio. "
                "The agent will temporarily decode every response it can safely serialize. Navigate manually, add markers before important screens, then Stop & Package. "
                "Normal Duel, Poll and event captures keep their existing targeted filters."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 9))

        row = ctk.CTkFrame(panel, fg_color="transparent")
        row.pack(fill="x", padx=16, pady=(0, 8))
        self.discovery_marker_entry = ctk.CTkEntry(
            row,
            height=36,
            placeholder_text="Marker, e.g. Opened Arena ranking / Opened Alliance member profile",
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 9),
        )
        self.discovery_marker_entry.pack(side="left", fill="x", expand=True)
        self.discovery_marker_button = ctk.CTkButton(
            row,
            text="ADD MARKER",
            height=36,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.add_discovery_marker,
        )
        self.discovery_marker_button.pack(side="left", padx=(8, 0))

        presets = ctk.CTkFrame(panel, fg_color="transparent")
        presets.pack(fill="x", padx=16, pady=(0, 8))
        ctk.CTkLabel(presets, text="Quick markers", text_color=Colors.MUTED, font=(self.font, 8, "bold")).pack(side="left")
        for text in ("Arena ranking", "Alliance members", "Player profile", "Total power", "Last online"):
            ctk.CTkButton(
                presets,
                text=text,
                height=28,
                width=105,
                fg_color="transparent",
                border_width=1,
                border_color=Colors.BORDER,
                hover_color=Colors.PANEL2,
                text_color=Colors.MUTED,
                font=(self.font, 8, "bold"),
                command=lambda value=text: self.add_discovery_marker(value),
            ).pack(side="left", padx=(6, 0))

        self.discovery_status = ctk.CTkLabel(
            panel,
            text="Broad discovery is off. Targeted production capture behavior is unchanged.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.discovery_status.pack(anchor="w", padx=16, pady=(0, 13))

    def _capture_purpose_changed(self, value: str) -> None:
        super()._capture_purpose_changed(value)
        broad = str(value or "") in BROAD_DISCOVERY_PURPOSES
        if hasattr(self, "discovery_status") and not self.discovery_enabled:
            self.discovery_status.configure(
                text=(
                    "Broad discovery will be enabled for this capture. Add markers before opening important screens."
                    if broad
                    else "Targeted capture selected. Full-response discovery will remain off."
                ),
                text_color=Colors.ACCENT if broad else Colors.MUTED,
            )

    def _capture_studio_start(self) -> None:
        purpose = self.capture_purpose_menu.get() if hasattr(self, "capture_purpose_menu") else ""
        broad = str(purpose or "") in BROAD_DISCOVERY_PURPOSES
        self.capture.capture_all_responses = broad
        self.discovery_enabled = broad
        self.discovery_session_id = ""
        self.discovery_marker_count = 0
        super()._capture_studio_start()

        if broad and self.session_id:
            self.discovery_session_id = str(self.session_id)
            self._append_discovery_timeline(
                "discovery-start",
                {
                    "purpose": purpose,
                    "mode": "all-decoded-responses",
                    "sessionId": self.discovery_session_id,
                    "observedAt": utc_now(),
                },
            )
            if hasattr(self, "discovery_status"):
                self.discovery_status.configure(
                    text="FULL DATA DISCOVERY ACTIVE. Navigate manually and add markers before important screens.",
                    text_color=Colors.SUCCESS,
                )
            self.write("Discovery Capture: broad decoded-response mode enabled.")
        elif broad:
            self.discovery_enabled = False
            self.capture.capture_all_responses = False

    def _capture_studio_stop(self) -> None:
        session_id = str(self.session_id or self.discovery_session_id or "")
        broad = bool(self.discovery_enabled and session_id)
        if broad:
            self._append_discovery_timeline(
                "discovery-stop-requested",
                {"sessionId": session_id, "observedAt": utc_now()},
            )
        super()._capture_studio_stop()
        self.capture.capture_all_responses = False
        self.discovery_enabled = False

        if broad:
            try:
                summary = self._build_discovery_package(session_id)
                self.write(
                    "Discovery Capture: indexed "
                    f"{summary.get('decodedResponseCount', 0)} decoded response(s) across "
                    f"{summary.get('decodedCommandCount', 0)} command(s); "
                    f"{summary.get('undecodedCommandCount', 0)} observed command(s) were not decoded."
                )
                if hasattr(self, "discovery_status"):
                    self.discovery_status.configure(
                        text=(
                            f"Package ready: {summary.get('decodedResponseCount', 0)} decoded responses, "
                            f"{summary.get('decodedCommandCount', 0)} decoded commands, "
                            f"{summary.get('undecodedCommandCount', 0)} observed-but-undecoded commands. "
                            "Send the ZIP for correlation."
                        ),
                        text_color=Colors.SUCCESS,
                    )
            except Exception as exc:
                self.write(f"Discovery Capture: package index failed: {exc}")
                if hasattr(self, "discovery_status"):
                    self.discovery_status.configure(
                        text=f"Raw capture was packaged, but the discovery index could not be generated: {exc}",
                        text_color=Colors.DANGER,
                    )
        self.discovery_session_id = ""

    def handle(self, kind: str, payload: Any) -> None:
        if self.discovery_enabled and self.discovery_session_id and kind in TIMELINE_KINDS:
            try:
                self._append_discovery_timeline(kind, self._timeline_payload(kind, payload))
            except Exception:
                pass
        super().handle(kind, payload)

    def add_discovery_marker(self, label: str | None = None) -> None:
        session_id = str(self.session_id or self.discovery_session_id or "")
        if not self.discovery_enabled or not session_id:
            if hasattr(self, "discovery_status"):
                self.discovery_status.configure(
                    text="Start a Full Data Discovery/Arena/Total Power capture before adding markers.",
                    text_color=Colors.DANGER,
                )
            return
        text = str(label or "").strip()
        if not text and hasattr(self, "discovery_marker_entry"):
            text = self.discovery_marker_entry.get().strip()
        if not text:
            text = f"Marker {self.discovery_marker_count + 1}"
        self.discovery_marker_count += 1
        self._append_discovery_timeline(
            "manual-marker",
            {
                "marker": text,
                "markerNumber": self.discovery_marker_count,
                "sessionId": session_id,
                "observedAt": utc_now(),
            },
        )
        if hasattr(self, "discovery_marker_entry"):
            self.discovery_marker_entry.delete(0, "end")
        if hasattr(self, "discovery_status"):
            self.discovery_status.configure(
                text=f"Marker {self.discovery_marker_count} saved: {text}",
                text_color=Colors.SUCCESS,
            )
        self.write(f"Discovery marker: {text}")

    def _append_discovery_timeline(self, kind: str, payload: dict[str, Any]) -> None:
        session_id = str(self.discovery_session_id or self.session_id or "")
        if not session_id:
            return
        path = SESSIONS_DIR / session_id / "raw" / "discovery-timeline.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "kind": str(kind),
            "recordedAt": utc_now(),
            "payload": payload,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    @staticmethod
    def _timeline_payload(kind: str, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return {"value": str(payload)}
        if kind == "response":
            raw = str(payload.get("json") or "")
            return {
                "command": str(payload.get("command") or ""),
                "sequence": payload.get("sequence"),
                "sourceHook": str(payload.get("sourceHook") or ""),
                "jsonBytes": len(raw.encode("utf-8", errors="ignore")),
                "jsonOk": bool(payload.get("jsonOk", True)),
                "observedAt": str(payload.get("observedAt") or ""),
            }
        # Keep lightweight trace/dispatch metadata. Raw decoded response bodies live in
        # responses.jsonl and are intentionally not duplicated into the timeline.
        allowed = {
            "command", "count", "overload", "objectClass", "discoveryAll", "observedAt",
            "name", "controlType", "requestClass", "requestType", "method", "error",
            "mappedCommand", "source", "sequence", "kind",
        }
        return {key: value for key, value in payload.items() if key in allowed}

    def _build_discovery_package(self, session_id: str) -> dict[str, Any]:
        root = SESSIONS_DIR / session_id
        raw_responses = root / "raw" / "responses.jsonl"
        timeline_path = root / "raw" / "discovery-timeline.jsonl"
        discovery_dir = root / "discovery"
        discovery_dir.mkdir(parents=True, exist_ok=True)

        decoded_counts: Counter[str] = Counter()
        first_seen: dict[str, str] = {}
        last_seen: dict[str, str] = {}
        field_hints: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
        decoded_total = 0

        if raw_responses.exists():
            for line in raw_responses.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                command = str(row.get("command") or "").strip() or "<blank>"
                captured = str(row.get("capturedAt") or "")
                payload = row.get("payload")
                decoded_total += 1
                decoded_counts[command] += 1
                first_seen.setdefault(command, captured)
                last_seen[command] = captured
                self._collect_field_hints(payload, command, field_hints)

        observed_counts: Counter[str] = Counter()
        markers: list[dict[str, Any]] = []
        timeline_rows = 0
        if timeline_path.exists():
            for line in timeline_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                timeline_rows += 1
                kind = str(row.get("kind") or "")
                payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
                if kind == "dispatch-response":
                    command = str(payload.get("command") or "").strip()
                    if command:
                        observed_counts[command] += 1
                elif kind == "manual-marker":
                    markers.append(row)

        all_commands = sorted(set(decoded_counts) | set(observed_counts))
        undecoded = [command for command in all_commands if command not in decoded_counts]
        candidates = [
            command for command in all_commands
            if any(keyword in command.lower() for keyword in COMMAND_KEYWORDS)
        ]

        command_rows: list[dict[str, Any]] = []
        for command in all_commands:
            command_rows.append({
                "command": command,
                "observedDispatches": int(observed_counts.get(command, 0)),
                "decodedResponses": int(decoded_counts.get(command, 0)),
                "firstDecodedAt": first_seen.get(command, ""),
                "lastDecodedAt": last_seen.get(command, ""),
                "candidate": command in candidates,
                "decoded": command in decoded_counts,
            })

        field_rows: list[dict[str, Any]] = []
        for command in sorted(field_hints):
            for path, (value_type, sample) in sorted(field_hints[command].items()):
                field_rows.append({
                    "command": command,
                    "path": path,
                    "type": value_type,
                    "sample": sample,
                    "candidateField": any(keyword in path.lower() for keyword in FIELD_KEYWORDS),
                })

        summary = {
            "schemaVersion": 1,
            "sessionId": session_id,
            "generatedAt": utc_now(),
            "mode": "all-decoded-responses",
            "decodedResponseCount": decoded_total,
            "decodedCommandCount": len(decoded_counts),
            "observedCommandCount": len(observed_counts),
            "undecodedCommandCount": len(undecoded),
            "timelineRows": timeline_rows,
            "markerCount": len(markers),
            "candidateCommands": candidates,
            "undecodedCommands": undecoded,
            "commands": command_rows,
            "markers": markers,
            "notes": [
                "responses.jsonl contains the complete decoded payloads retained by the desktop store.",
                "discovery-timeline.jsonl correlates UI/request/response events and manual markers.",
                "Observed-but-undecoded commands are still listed so the next hook can target them if needed.",
                "Candidate flags are keyword hints only; they are not semantic classifications.",
            ],
        }

        (discovery_dir / "command-index.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._write_csv(discovery_dir / "command-index.csv", command_rows)
        self._write_csv(discovery_dir / "field-hints.csv", field_rows)
        (discovery_dir / "README.txt").write_text(
            "Alliance Tracker Full Data Discovery\n"
            "====================================\n\n"
            "raw/responses.jsonl                Complete decoded response payloads.\n"
            "raw/discovery-timeline.jsonl       Ordered command/click/request timeline + manual markers.\n"
            "discovery/command-index.json       Summary of decoded and observed-only commands.\n"
            "discovery/command-index.csv        Spreadsheet-friendly command counts.\n"
            "discovery/field-hints.csv          Flattened field paths and small samples for correlation.\n\n"
            "For Arena/Power/Last Online training, add a marker immediately before opening each relevant screen.\n",
            encoding="utf-8",
        )

        zip_path = SESSIONS_DIR / f"{session_id}.zip"
        if zip_path.exists():
            with zipfile.ZipFile(zip_path, "a", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(discovery_dir.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(root))
                if timeline_path.exists():
                    # Base packaging already contains this file in normal stop flow. Only
                    # add it if it somehow was created after packaging.
                    names = set(archive.namelist())
                    relative = str(timeline_path.relative_to(root)).replace("\\", "/")
                    if relative not in names:
                        archive.write(timeline_path, relative)
        return summary

    @classmethod
    def _collect_field_hints(
        cls,
        value: Any,
        command: str,
        output: dict[str, dict[str, tuple[str, str]]],
        path: str = "$",
        depth: int = 0,
    ) -> None:
        if depth > 4 or len(output[command]) >= 400:
            return
        if isinstance(value, dict):
            for key, child in list(value.items())[:150]:
                child_path = f"{path}.{key}"
                cls._remember_field(output[command], child_path, child)
                cls._collect_field_hints(child, command, output, child_path, depth + 1)
            return
        if isinstance(value, list):
            if value:
                child_path = f"{path}[]"
                cls._remember_field(output[command], child_path, value[0])
                cls._collect_field_hints(value[0], command, output, child_path, depth + 1)

    @staticmethod
    def _remember_field(target: dict[str, tuple[str, str]], path: str, value: Any) -> None:
        if path in target:
            return
        value_type = type(value).__name__
        if isinstance(value, (dict, list)):
            sample = f"<{value_type}>"
        else:
            sample = str(value)
            if len(sample) > 160:
                sample = sample[:157] + "..."
        target[path] = (value_type, sample)

    @staticmethod
    def _write_csv(path: Path, rows: Iterable[dict[str, Any]]) -> None:
        rows = list(rows)
        if not rows:
            path.write_text("", encoding="utf-8-sig")
            return
        fields: list[str] = []
        seen: set[str] = set()
        for row in rows:
            for key in row:
                if key not in seen:
                    fields.append(key)
                    seen.add(key)
        with path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
