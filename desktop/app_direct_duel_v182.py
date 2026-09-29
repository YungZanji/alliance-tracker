from __future__ import annotations

import threading
from typing import Any

from app import Colors
from app_direct_duel_v181 import App as DirectFullSyncApp
from cloud import CloudClient
from direct_duel import validate_sync_summary


class App(DirectFullSyncApp):
    """Direct Duel 1.8.2: pull locally, validate, then sync the exact session."""

    def __init__(self) -> None:
        self.direct_duel_sync_after_pull = False
        super().__init__()

        self.direct_previous_button.configure(
            text="PULL + SYNC DUEL",
            command=self._start_pull_and_sync,
        )
        self.direct_current_button.configure(
            text="PULL ONLY",
            command=self._start_pull_only,
        )
        self.direct_context_button.configure(
            text="HISTORICAL EXPLORER",
            command=lambda: self._start_direct_duel("explore"),
        )
        self.direct_duel_status.configure(
            text=(
                "Pull + Sync first captures the seven verified read-only Duel responses locally, validates that every "
                "required normalized dataset is present, packages the ZIP, and only then uploads that exact session to "
                "Alliance Tracker. Partial captures never auto-sync."
            ),
            text_color=Colors.MUTED,
        )
        self._set_direct_summary(
            "PULL + SYNC DUEL is a two-phase operation:\n"
            "  1. Pull current Duel data directly from Last Z and save it locally.\n"
            "  2. Validate current day, weekly combined, My Alliance weekly, completed days, official results, and season context.\n"
            "  3. Upload only that validated session to https://wdz.state305.cc.\n\n"
            "PULL ONLY performs steps 1-2 without uploading. Re-running during the week is safe: the cloud keeps newer "
            "authoritative rows and records score changes."
        )

    def _start_pull_and_sync(self) -> None:
        self.direct_duel_sync_after_pull = True
        self._start_direct_duel("sync")

    def _start_pull_only(self) -> None:
        self.direct_duel_sync_after_pull = False
        self._start_direct_duel("sync")

    def _append_direct_summary(self, lines: list[str]) -> None:
        box = getattr(self, "direct_duel_summary", None)
        if box is None:
            return
        try:
            current = str(box.get("1.0", "end")).rstrip()
        except Exception:
            current = ""
        extra = "\n".join(str(line) for line in lines if str(line).strip())
        self._set_direct_summary((current + "\n\n" + extra).strip())

    def _finish_direct_duel(self, reason: str, success: bool) -> None:
        session_id = str(self.session_id or self.direct_duel_session_id or "")
        should_sync = bool(self.direct_duel_sync_after_pull and self.direct_duel_mode == "sync")

        super()._finish_direct_duel(reason, success)

        # Historical Explorer and Pull Only never upload automatically.
        if not should_sync:
            self.direct_duel_sync_after_pull = False
            return
        self.direct_duel_sync_after_pull = False

        if not success or not session_id:
            self._append_direct_summary([
                "Cloud sync: SKIPPED",
                "The pull was partial or did not create a completed session, so nothing was uploaded.",
            ])
            self._set_direct_status("Pull was not complete; cloud sync was skipped.", Colors.DANGER)
            return

        try:
            summary = self.store.summary(session_id)
            valid, missing = validate_sync_summary(summary)
            snapshots = self.store.snapshots_for_session(session_id)
        except Exception as exc:
            self._append_direct_summary(["Cloud sync: SKIPPED", f"Validation error: {exc}"])
            self._set_direct_status("Local package was saved, but validation failed; nothing was uploaded.", Colors.DANGER)
            return

        if not valid:
            self._append_direct_summary([
                "Cloud sync: SKIPPED",
                "Capture validation failed.",
                "Missing: " + ", ".join(missing),
            ])
            self._set_direct_status("Local package saved, but required Duel datasets were missing; nothing was uploaded.", Colors.DANGER)
            return

        endpoint = str(self.config.values.get("cloudEndpoint") or "").strip()
        token = str(self.config.values.get("uploadToken") or "").strip()
        if not endpoint or not token:
            self._append_direct_summary([
                "Cloud sync: NOT CONFIGURED",
                "The validated local package is safe. Configure the Cloud Sync endpoint/token, then use Sync Latest Session.",
            ])
            self._set_direct_status("Pull validated successfully, but Cloud Sync is not configured.", Colors.DANGER)
            return

        self._set_direct_buttons(False)
        self._set_direct_status(
            f"Pull validated ({len(snapshots)} snapshot(s)). Uploading this exact session to Alliance Tracker…",
            Colors.ACCENT,
        )
        self._append_direct_summary([
            "Validation: PASSED",
            f"Snapshots queued for cloud sync: {len(snapshots)}",
            "Cloud sync: UPLOADING…",
        ])

        def work() -> None:
            try:
                result = CloudClient(endpoint, token).upload(snapshots)
                ids = result.get("acceptedSnapshotIds") or [row["id"] for row in snapshots]
                self.store.mark_synced(int(value) for value in ids)
                self.after(0, lambda: self._direct_sync_done(session_id, result, len(ids)))
            except Exception as exc:
                self.after(0, lambda msg=str(exc): self._direct_sync_failed(session_id, msg))

        threading.Thread(target=work, daemon=True).start()

    def _direct_sync_done(self, session_id: str, result: dict[str, Any], marked: int) -> None:
        self._set_direct_buttons(True)
        accepted = int(result.get("accepted", 0))
        duplicates = int(result.get("duplicates", 0))
        cycle_id = result.get("cycleId", "—")
        cycle_week = result.get("cycleWeek", "—")
        weekly_changes = int(result.get("weeklyChanges", 0))
        daily_changes = int(result.get("dailyChanges", 0))
        self._append_direct_summary([
            "Cloud sync: COMPLETE",
            f"Session: {session_id}",
            f"Accepted snapshots: {accepted}",
            f"Already-known snapshots: {duplicates}",
            f"Marked synced locally: {marked}",
            f"Cycle / week: {cycle_id} / {cycle_week}",
            f"Weekly rows updated: {weekly_changes}",
            f"Daily rows updated: {daily_changes}",
        ])
        self._set_direct_status(
            f"Pull + Sync complete. {accepted} new snapshot(s), {duplicates} duplicate(s); dashboard data is updated.",
            Colors.SUCCESS,
        )
        self.refresh_sessions()

    def _direct_sync_failed(self, session_id: str, message: str) -> None:
        self._set_direct_buttons(True)
        self._append_direct_summary([
            "Cloud sync: FAILED",
            f"Session: {session_id}",
            message,
            "The local package was preserved. Retrying Sync Latest Session is safe because cloud snapshots are deduplicated.",
        ])
        self._set_direct_status(
            "The pull was saved and validated locally, but the cloud upload failed. The local session can be retried safely.",
            Colors.DANGER,
        )
