from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox
from typing import Any

import customtkinter as ctk

from app import CLOUDFLARE_ENDPOINT, Colors
from app_v141_runtime import App as BaseApp
from utils import SESSIONS_DIR, utc_now


class App(BaseApp):
    """1.4.2 review: guided Alliance Poll capture -> review -> explicit archive sync."""

    def __init__(self) -> None:
        self.poll_capture_wait_started = 0.0
        self.poll_capture_session_id = ""
        self.poll_capture_active = False
        self.poll_capture_polls: list[dict[str, Any]] = []
        self.poll_capture_labels: dict[str, int] = {}
        super().__init__()

    def _layout(self) -> None:
        super()._layout()
        self._add_poll_capture_panel()

    def _add_poll_capture_panel(self) -> None:
        page = self.pages.get("overview")
        if not page or not hasattr(self, "capture_purpose_menu"):
            return
        try:
            generic_studio = self.capture_purpose_menu.master.master
        except Exception:
            generic_studio = None

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=16,
            border_width=1,
            border_color=Colors.BORDER,
        )
        kwargs: dict[str, Any] = {"fill": "x", "pady": (14, 0)}
        if generic_studio is not None:
            kwargs["before"] = generic_studio
        panel.pack(**kwargs)
        self.poll_capture_panel = panel

        ctk.CTkLabel(
            panel,
            text="ALLIANCE POLL CAPTURE",
            text_color=Colors.ACCENT,
            font=(self.font, 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 2))
        ctk.CTkLabel(
            panel,
            text="Capture a poll, review exactly what was decoded, then archive it permanently.",
            text_color=Colors.TEXT,
            font=(self.font, 17, "bold"),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16)
        ctk.CTkLabel(
            panel,
            text=(
                "Start Poll Capture handles the tracker attachment and recording. In Last Z, open Alliance chat > notices, "
                "open the poll you want, then return here and press Stop & Review. Nothing is sent to Cloudflare until you explicitly confirm Sync Selected Poll."
            ),
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        ).pack(anchor="w", padx=16, pady=(3, 10))

        actions = ctk.CTkFrame(panel, fg_color="transparent")
        actions.pack(fill="x", padx=16, pady=(0, 10))
        self.poll_start_button = ctk.CTkButton(
            actions,
            text="START POLL CAPTURE",
            height=40,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 10, "bold"),
            command=self.start_poll_capture,
        )
        self.poll_start_button.pack(side="left")
        self.poll_stop_button = ctk.CTkButton(
            actions,
            text="STOP & REVIEW",
            height=40,
            fg_color=Colors.DANGER,
            hover_color="#D94A5B",
            font=(self.font, 10, "bold"),
            state="disabled",
            command=self.stop_poll_capture,
        )
        self.poll_stop_button.pack(side="left", padx=8)
        self.poll_sync_button = ctk.CTkButton(
            actions,
            text="SYNC SELECTED POLL",
            height=40,
            fg_color=Colors.SUCCESS,
            hover_color="#24B984",
            text_color="#07111F",
            font=(self.font, 10, "bold"),
            state="disabled",
            command=self.sync_selected_poll,
        )
        self.poll_sync_button.pack(side="right")

        self.poll_capture_status = ctk.CTkLabel(
            panel,
            text="Ready. Last Z may already be open or you can open it before starting.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=900,
            justify="left",
        )
        self.poll_capture_status.pack(anchor="w", padx=16, pady=(0, 8))

        review = ctk.CTkFrame(panel, fg_color=Colors.PANEL2, corner_radius=12)
        review.pack(fill="x", padx=16, pady=(0, 14))
        top = ctk.CTkFrame(review, fg_color="transparent")
        top.pack(fill="x", padx=12, pady=(11, 6))
        ctk.CTkLabel(top, text="Decoded poll", text_color=Colors.MUTED, font=(self.font, 9, "bold")).pack(side="left")
        self.poll_select_menu = ctk.CTkComboBox(
            top,
            values=["No poll decoded yet"],
            height=33,
            fg_color=Colors.PANEL,
            border_color=Colors.BORDER,
            button_color=Colors.ACCENT,
            button_hover_color=Colors.ACCENT_HOVER,
            text_color=Colors.TEXT,
            font=(self.font, 9),
            state="disabled",
            command=self._poll_selection_changed,
        )
        self.poll_select_menu.pack(side="right", fill="x", expand=True, padx=(12, 0))
        self.poll_review_text = ctk.CTkLabel(
            review,
            text="Open a poll during capture. The review will show the question, options and decoded voter count before anything is uploaded.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
            wraplength=850,
            justify="left",
        )
        self.poll_review_text.pack(anchor="w", padx=12, pady=(0, 12))

    def _set_poll_status(self, text: str, color: Any = None) -> None:
        if hasattr(self, "poll_capture_status"):
            self.poll_capture_status.configure(text=text, text_color=color or Colors.MUTED)
        self.write("Poll Capture: " + text)

    def start_poll_capture(self) -> None:
        if self.session_id or self.poll_capture_active:
            self._set_poll_status("A capture is already running. Stop it before starting a poll capture.", Colors.DANGER)
            return
        self.poll_capture_polls = []
        self.poll_capture_labels = {}
        self.poll_capture_session_id = ""
        self.poll_sync_button.configure(state="disabled")
        self.poll_select_menu.configure(values=["No poll decoded yet"], state="disabled")
        self.poll_select_menu.set("No poll decoded yet")
        self.poll_review_text.configure(text="Waiting for a decoded get.alliance.vote response…")
        self.poll_start_button.configure(state="disabled", text="ATTACHING…")
        self._set_poll_status("Attaching to Survival.exe and waiting for the capture engine…", Colors.ACCENT)
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_poll_recording()
            return
        self.attach()
        self.poll_capture_wait_started = datetime.now(timezone.utc).timestamp()
        self.after(250, self._wait_for_poll_attach)

    def _wait_for_poll_attach(self) -> None:
        if self.capture.state.ready and self.capture.state.attached:
            self._begin_poll_recording()
            return
        elapsed = datetime.now(timezone.utc).timestamp() - self.poll_capture_wait_started
        if elapsed >= 20:
            self.poll_start_button.configure(state="normal", text="START POLL CAPTURE")
            self._set_poll_status("Could not get the capture engine ready within 20 seconds. Confirm Last Z is in the city and try again.", Colors.DANGER)
            return
        self.after(250, self._wait_for_poll_attach)

    def _begin_poll_recording(self) -> None:
        try:
            if hasattr(self, "capture_purpose_menu"):
                self.capture_purpose_menu.set("Alliance Vote / Poll")
                self._capture_purpose_changed("Alliance Vote / Poll")
            if hasattr(self, "capture_label_entry"):
                self.capture_label_entry.delete(0, "end")
                self.capture_label_entry.insert(0, "Alliance Vote Poll")
            self._capture_studio_start()
            self.poll_capture_session_id = str(self.session_id or "")
            self.poll_capture_active = bool(self.poll_capture_session_id)
        except Exception as exc:
            self.poll_capture_active = False
            self.poll_start_button.configure(state="normal", text="START POLL CAPTURE")
            self._set_poll_status(f"Could not start poll capture: {exc}", Colors.DANGER)
            return
        if not self.poll_capture_active:
            self.poll_start_button.configure(state="normal", text="START POLL CAPTURE")
            self._set_poll_status("Capture did not start. Check the main capture log for details.", Colors.DANGER)
            return
        self.poll_start_button.configure(text="CAPTURING…")
        self.poll_stop_button.configure(state="normal")
        self._set_poll_status("Recording. Open the desired Alliance poll in Last Z, then press Stop & Review.", Colors.SUCCESS)

    def stop_poll_capture(self) -> None:
        session_id = str(self.session_id or self.poll_capture_session_id or "")
        if not session_id:
            self._set_poll_status("There is no active poll capture to stop.", Colors.DANGER)
            return
        self.poll_stop_button.configure(state="disabled", text="REVIEWING…")
        try:
            self._capture_studio_stop()
        except Exception as exc:
            self.poll_stop_button.configure(state="normal", text="STOP & REVIEW")
            self._set_poll_status(f"Could not stop/package capture: {exc}", Colors.DANGER)
            return
        self.poll_capture_active = False
        self.poll_capture_session_id = session_id
        self.poll_start_button.configure(state="normal", text="START POLL CAPTURE")
        self.after(250, lambda sid=session_id: self._review_poll_session(sid))

    def _review_poll_session(self, session_id: str) -> None:
        try:
            polls = self._extract_polls(session_id)
        except Exception as exc:
            self.poll_stop_button.configure(text="STOP & REVIEW")
            self._set_poll_status(f"Capture was packaged, but the vote response could not be reviewed: {exc}", Colors.DANGER)
            return
        self.poll_stop_button.configure(text="STOP & REVIEW")
        self.poll_capture_polls = polls
        if not polls:
            self.poll_select_menu.configure(values=["No poll decoded"], state="disabled")
            self.poll_select_menu.set("No poll decoded")
            self.poll_sync_button.configure(state="disabled")
            self.poll_review_text.configure(text="No decoded get.alliance.vote payload was found. Re-run the capture and make sure the Alliance poll itself is opened while recording.")
            self._set_poll_status("No Alliance poll was decoded in this session.", Colors.DANGER)
            return

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
        self._persist_poll_review(session_id, polls)
        self._set_poll_status(f"Decoded {len(polls)} poll(s). Review the selected poll, then sync only when you are ready.", Colors.SUCCESS)

    def _extract_polls(self, session_id: str) -> list[dict[str, Any]]:
        path = SESSIONS_DIR / session_id / "raw" / "responses.jsonl"
        if not path.exists():
            raise FileNotFoundError(f"responses.jsonl was not found for {session_id}")
        latest: dict[str, dict[str, Any]] = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if str(row.get("command") or "") != "get.alliance.vote":
                continue
            captured_at = str(row.get("capturedAt") or utc_now())
            payload = row.get("payload") or {}
            for raw in payload.get("notices") or []:
                if not isinstance(raw, dict) or not (raw.get("voteList") or raw.get("voteDetails")):
                    continue
                poll_id = str(raw.get("uuid") or "").strip()
                if not poll_id:
                    continue
                poll = {
                    "pollId": poll_id,
                    "question": str(raw.get("notice") or "").strip(),
                    "publisherUid": str(raw.get("uid") or ""),
                    "publisherName": str(raw.get("name") or ""),
                    "allianceAbbr": str(raw.get("abbr") or ""),
                    "createdAt": self._poll_iso(raw.get("create_time")),
                    "endsAt": self._poll_iso(raw.get("end_time")),
                    "status": int(raw.get("status") or 0),
                    "supportMulti": bool(int(raw.get("supportMulti") or 0)),
                    "options": [
                        {"id": str(option.get("index") or ""), "text": str(option.get("voteNote") or "").strip()}
                        for option in (raw.get("voteList") or []) if isinstance(option, dict)
                    ],
                    "votes": [
                        {"uid": str(vote.get("uid") or ""), "optionId": str(vote.get("voteId") or "")}
                        for vote in (raw.get("voteDetails") or []) if isinstance(vote, dict)
                    ],
                    "sessionId": session_id,
                    "capturedAt": captured_at,
                }
                previous = latest.get(poll_id)
                if previous is None or str(poll["capturedAt"]) >= str(previous.get("capturedAt") or ""):
                    latest[poll_id] = poll
        return sorted(latest.values(), key=lambda row: str(row.get("createdAt") or row.get("capturedAt") or ""), reverse=True)

    @staticmethod
    def _poll_iso(value: Any) -> str:
        try:
            number = float(value)
            if number > 0:
                if number > 10_000_000_000:
                    number /= 1000.0
                return datetime.fromtimestamp(number, tz=timezone.utc).isoformat(timespec="milliseconds")
        except Exception:
            pass
        return ""

    def _persist_poll_review(self, session_id: str, polls: list[dict[str, Any]]) -> None:
        session_dir = SESSIONS_DIR / session_id
        normalized = session_dir / "normalized"
        normalized.mkdir(parents=True, exist_ok=True)
        path = normalized / "alliance-polls.json"
        path.write_text(json.dumps({"schemaVersion": 1, "sessionId": session_id, "polls": polls}, indent=2, ensure_ascii=False), encoding="utf-8")
        zip_path = SESSIONS_DIR / f"{session_id}.zip"
        if zip_path.exists():
            try:
                with zipfile.ZipFile(zip_path, "a", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.write(path, "normalized/alliance-polls.json")
            except Exception as exc:
                self.write(f"Poll Capture: local poll review was saved but could not be appended to ZIP: {exc}")

    def _poll_selection_changed(self, label: str) -> None:
        index = self.poll_capture_labels.get(str(label), 0)
        self._render_poll_preview(index)

    def _render_poll_preview(self, index: int) -> None:
        if not self.poll_capture_polls:
            return
        index = max(0, min(len(self.poll_capture_polls) - 1, int(index)))
        poll = self.poll_capture_polls[index]
        counts: dict[str, int] = {str(option.get("id") or ""): 0 for option in poll.get("options") or []}
        voters = set()
        for vote in poll.get("votes") or []:
            uid = str(vote.get("uid") or "")
            option_id = str(vote.get("optionId") or "")
            if uid:
                voters.add(uid)
            counts[option_id] = counts.get(option_id, 0) + 1
        options = []
        for option in poll.get("options") or []:
            option_id = str(option.get("id") or "")
            options.append(f"{option.get('text') or 'Option'}: {counts.get(option_id, 0)}")
        self.poll_review_text.configure(text=(
            f"{poll.get('question') or 'Untitled poll'}\n"
            f"Created by {poll.get('publisherName') or 'Unknown'} · {len(voters)} unique voter(s) decoded\n"
            f"" + " · ".join(options) + "\n"
            "Cloudflare will add the current WDZ roster snapshot at sync time so the archive can permanently show who did not vote."
        ))

    def _selected_poll(self) -> dict[str, Any] | None:
        if not self.poll_capture_polls:
            return None
        label = self.poll_select_menu.get() if hasattr(self, "poll_select_menu") else ""
        index = self.poll_capture_labels.get(str(label), 0)
        return self.poll_capture_polls[max(0, min(len(self.poll_capture_polls) - 1, index))]

    def sync_selected_poll(self) -> None:
        poll = self._selected_poll()
        if poll is None:
            self._set_poll_status("There is no reviewed poll to sync.", Colors.DANGER)
            return
        token = str(self.config.values.get("uploadToken") or "").strip()
        if not token:
            self._set_poll_status("Cloud upload token is missing. Save it in Settings first.", Colors.DANGER)
            return
        question = str(poll.get("question") or "this poll")
        if not messagebox.askyesno(
            "Archive Alliance Poll",
            f"Archive this poll permanently in the admin Polls page?\n\n{question}\n\nThe current WDZ roster will be frozen with it so non-voters can be shown later.",
            parent=self,
        ):
            return
        endpoint = self._poll_sync_endpoint()
        payload = {
            "schemaVersion": 1,
            "sessionId": self.poll_capture_session_id,
            "capturedAt": str(poll.get("capturedAt") or utc_now()),
            "polls": [poll],
        }
        self.poll_sync_button.configure(state="disabled", text="SYNCING…")
        self._set_poll_status("Uploading reviewed poll to the permanent Cloudflare archive…", Colors.ACCENT)
        threading.Thread(target=self._poll_sync_worker, args=(endpoint, token, payload), daemon=True).start()

    def _poll_sync_endpoint(self) -> str:
        configured = str(self.config.values.get("cloudEndpoint") or CLOUDFLARE_ENDPOINT).strip() or CLOUDFLARE_ENDPOINT
        parts = urllib.parse.urlsplit(configured)
        if not parts.scheme or not parts.netloc:
            return "https://wdz.state305.cc/api/polls/sync"
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "/api/polls/sync", "", ""))

    def _poll_sync_worker(self, endpoint: str, token: str, payload: dict[str, Any]) -> None:
        try:
            request = urllib.request.Request(
                endpoint,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
            if result.get("ok") is not True:
                raise RuntimeError(str(result.get("error") or "Cloudflare returned ok=false"))
            self.after(0, lambda r=result: self._poll_sync_done(r))
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8")
            except Exception:
                detail = str(exc)
            self.after(0, lambda d=detail: self._poll_sync_failed(d))
        except Exception as exc:
            self.after(0, lambda d=str(exc): self._poll_sync_failed(d))

    def _poll_sync_done(self, result: dict[str, Any]) -> None:
        archived = result.get("archived") or []
        row = archived[0] if archived else {}
        self.poll_sync_button.configure(state="normal", text="SYNC SELECTED POLL")
        self._set_poll_status(
            f"Archived successfully: {row.get('votes', 0)} voted, {row.get('didNotVote', 0)} did not vote, roster snapshot {row.get('rosterSize', 0)}. You can now view it on the admin Polls page.",
            Colors.SUCCESS,
        )

    def _poll_sync_failed(self, detail: str) -> None:
        self.poll_sync_button.configure(state="normal", text="SYNC SELECTED POLL")
        self._set_poll_status(f"Poll sync failed: {detail}", Colors.DANGER)
