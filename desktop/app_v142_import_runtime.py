from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from tkinter import filedialog
from typing import Any

import customtkinter as ctk

from app import Colors
from app_v142_runtime import App as BaseApp
from utils import SESSIONS_DIR


class App(BaseApp):
    """1.4.2 review add-on: review/sync a poll ZIP that was captured earlier."""

    def _add_poll_capture_panel(self) -> None:
        super()._add_poll_capture_panel()
        if not hasattr(self, "poll_start_button"):
            return
        actions = self.poll_start_button.master
        self.poll_import_button = ctk.CTkButton(
            actions,
            text="IMPORT POLL ZIP",
            height=40,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 9, "bold"),
            command=self.import_poll_zip,
        )
        self.poll_import_button.pack(side="left", padx=(0, 8))

    def import_poll_zip(self) -> None:
        if self.session_id or self.poll_capture_active:
            self._set_poll_status("Stop the active capture before importing an older Poll ZIP.", Colors.DANGER)
            return
        selected = filedialog.askopenfilename(
            title="Import Alliance Poll capture ZIP",
            filetypes=[("Alliance Tracker capture", "*.zip"), ("ZIP archive", "*.zip")],
        )
        if not selected:
            return
        path = Path(selected)
        self.poll_import_button.configure(state="disabled", text="IMPORTING…")
        self.poll_sync_button.configure(state="disabled")
        self._set_poll_status(f"Reading {path.name}…", Colors.ACCENT)
        try:
            polls, import_session_id = self._polls_from_zip(path)
            if not polls:
                raise ValueError("No decoded get.alliance.vote poll was found in this ZIP.")
            self.poll_capture_session_id = import_session_id
            self.poll_capture_polls = polls
            self._load_imported_poll_review(import_session_id, polls)
            self._persist_poll_review(import_session_id, polls)
            self._set_poll_status(
                f"Imported {len(polls)} decoded poll(s) from {path.name}. Review the selected poll, then use Sync Selected Poll.",
                Colors.SUCCESS,
            )
        except Exception as exc:
            self.poll_capture_polls = []
            self.poll_capture_labels = {}
            self.poll_select_menu.configure(values=["No poll decoded"], state="disabled")
            self.poll_select_menu.set("No poll decoded")
            self.poll_review_text.configure(text="The selected ZIP could not be converted into a Poll Archive record.")
            self._set_poll_status(f"Could not import poll ZIP: {exc}", Colors.DANGER)
        finally:
            self.poll_import_button.configure(state="normal", text="IMPORT POLL ZIP")

    def _polls_from_zip(self, path: Path) -> tuple[list[dict[str, Any]], str]:
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(path)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", path.stem).strip("_")[:70] or "Poll"
        session_id = f"{stamp}_Imported_{safe_stem}"
        session_dir = SESSIONS_DIR / session_id
        raw_dir = session_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(path, "r") as archive:
            names = archive.namelist()
            normalized_name = next((name for name in names if name.replace("\\", "/").endswith("normalized/alliance-polls.json")), "")
            if normalized_name:
                info = archive.getinfo(normalized_name)
                if info.file_size > 25_000_000:
                    raise ValueError("Normalized poll data in this ZIP is unexpectedly large.")
                payload = json.loads(archive.read(normalized_name).decode("utf-8"))
                polls = payload.get("polls") if isinstance(payload, dict) else []
                if isinstance(polls, list) and polls:
                    (session_dir / "normalized").mkdir(parents=True, exist_ok=True)
                    return [row for row in polls if isinstance(row, dict)], session_id

            response_name = next((name for name in names if name.replace("\\", "/").endswith("raw/responses.jsonl")), "")
            if not response_name:
                raise ValueError("This ZIP does not contain raw/responses.jsonl or normalized/alliance-polls.json.")
            info = archive.getinfo(response_name)
            if info.file_size > 25_000_000:
                raise ValueError("responses.jsonl in this ZIP is unexpectedly large.")
            response_text = archive.read(response_name).decode("utf-8")
            (raw_dir / "responses.jsonl").write_text(response_text, encoding="utf-8")

        return self._extract_polls(session_id), session_id

    def _load_imported_poll_review(self, session_id: str, polls: list[dict[str, Any]]) -> None:
        labels: list[str] = []
        self.poll_capture_labels = {}
        for index, poll in enumerate(polls):
            question = str(poll.get("question") or "Untitled poll")
            label = question if len(question) <= 72 else question[:69] + "…"
            if label in self.poll_capture_labels:
                label = f"{label} [{index + 1}]"
            self.poll_capture_labels[label] = index
            labels.append(label)
        self.poll_select_menu.configure(values=labels, state="normal")
        self.poll_select_menu.set(labels[0])
        self.poll_sync_button.configure(state="normal")
        self._render_poll_preview(0)
