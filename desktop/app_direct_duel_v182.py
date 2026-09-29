from __future__ import annotations

import threading
from typing import Any

from app import Colors
from app_direct_duel_v181 import App as DirectFullSyncApp
from cloud import CloudClient
from direct_duel import validate_sync_summary


class App(DirectFullSyncApp):
    """Direct Duel 1.8.3: pull locally, validate, then sync full-fidelity Duel data."""

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
                "Pull + Sync captures the seven verified read-only Duel responses locally, validates every required "
                "dataset including group context, packages the ZIP, and only then uploads that exact session. The "
                "cloud must confirm matchup and exact-rank persistence before the local session is marked synced."
            ),
            text_color=Colors.MUTED,
        )
        self._set_direct_summary(
            "PULL + SYNC DUEL is a validated full-fidelity operation:\n"
            "  1. Pull current Duel data directly from Last Z and save it locally.\n"
            "  2. Validate current day, weekly combined, My Alliance weekly, completed days when available, official results, season, and Duel group context.\n"
            "  3. Upload only that validated session to https://wdz.state305.cc.\n"
            "  4. Require cloud confirmation that opponent/group context and exact overall + alliance rank positions were preserved.\n\n"
            "PULL ONLY performs the complete local collection without uploading. Re-running during the week is safe: "
            "identical snapshots are deduplicated and newer score/rank captures update the current week."
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
            f"Pull validated ({len(snapshots)} snapshot(s)). Uploading this exact session with full-fidelity verification…",
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
                fidelity = result.get("fidelitySync") if isinstance(result, dict) else None
                rank_sync = result.get("rankSync") if isinstance(result, dict) else None
                if not isinstance(fidelity, dict) or not fidelity.get("ok"):
                    raise RuntimeError(
                        "The cloud endpoint accepted the score payload but did not confirm the full-fidelity Duel "
                        "matchup sync. Deploy the current Alliance Tracker Cloudflare Worker before retrying."
                    )
                if not isinstance(rank_sync, dict) or not rank_sync.get("ok"):
                    raise RuntimeError(
                        "The cloud endpoint did not confirm exact overall/alliance rank persistence. Deploy the current "
                        "Alliance Tracker Cloudflare Worker before retrying."
                    )
                if not fidelity.get("matchupCaptured"):
                    raise RuntimeError(
                        "The score pull was valid, but the cloud could not identify the current Duel opponent from the "
                        "group + combined-ranking context. The local package was kept for inspection."
                    )

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
        fidelity = result.get("fidelitySync") if isinstance(result.get("fidelitySync"), dict) else {}
        rank_sync = result.get("rankSync") if isinstance(result.get("rankSync"), dict) else {}
        matchup = result.get("matchup") if isinstance(result.get("matchup"), dict) else {}
        primary = matchup.get("primary") if isinstance(matchup.get("primary"), dict) else {}
        opponent = matchup.get("opponent") if isinstance(matchup.get("opponent"), dict) else {}

        primary_abbr = str(primary.get("abbr") or "WDZ")
        opponent_abbr = str(opponent.get("abbr") or "—")
        opponent_name = str(opponent.get("name") or "")
        opponent_state = opponent.get("serverId")
        state_text = f"State {opponent_state}" if opponent_state not in (None, "", 0) else "State —"
        opponent_text = " · ".join(value for value in (opponent_abbr, opponent_name, state_text) if value)
        duel_group = str(matchup.get("duelGroup") or "—")

        self._append_direct_summary([
            "Cloud sync: COMPLETE + VERIFIED",
            f"Session: {session_id}",
            f"Matchup: {primary_abbr} vs {opponent_text}",
            f"Duel group: {duel_group}",
            f"Group alliances stored: {int(fidelity.get('groupMembers', 0))}",
            f"Exact rank rows preserved: {int(rank_sync.get('rows', 0))}",
            f"Accepted snapshots: {accepted}",
            f"Already-known snapshots: {duplicates}",
            f"Marked synced locally: {marked}",
            f"Cycle / week: {cycle_id} / {cycle_week}",
            f"Weekly score rows updated: {weekly_changes}",
            f"Daily score rows updated: {daily_changes}",
        ])
        self._set_direct_status(
            f"Pull + Sync verified. {primary_abbr} vs {opponent_abbr}; scores, matchup, group context, and exact ranks are preserved.",
            Colors.SUCCESS,
        )
        self.refresh_sessions()

    def _direct_sync_failed(self, session_id: str, message: str) -> None:
        self._set_direct_buttons(True)
        self._append_direct_summary([
            "Cloud sync: FAILED / NOT VERIFIED",
            f"Session: {session_id}",
            message,
            "The local package was preserved and was not marked synced. Retrying is safe because cloud snapshots are deduplicated.",
        ])
        self._set_direct_status(
            "The pull was saved locally, but full-fidelity cloud verification did not complete. The session can be retried safely.",
            Colors.DANGER,
        )
