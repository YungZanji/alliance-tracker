from __future__ import annotations

import threading
import time
from typing import Any

from app import Colors
from app_direct_events_v184 import App as DirectEventApp
from capture import decode_response
from cloud import CloudClient
from direct_glory_history import latest_finished_war, validate_historical_snapshot
from glory_war_capture import build_glory_war_snapshot
from svs_capture import save_snapshot
from utils import SESSIONS_DIR


class App(DirectEventApp):
    """Current-week Duel sync plus validated direct Glory War history sync."""

    GLORY_HISTORY_TIMEOUT = 45.0

    def __init__(self) -> None:
        self.direct_glory_target: dict[str, Any] | None = None
        self.direct_glory_queued = False
        super().__init__()
        self.direct_event_buttons[0].configure(
            text="PULL + SYNC GLORY WAR", command=lambda: self._start_direct_duel("glory-history"),
        )
        self.direct_duel_status.configure(
            text="Pull + Sync Duel uploads the week through the current day. Glory War reads the latest finished Logs battle, validates both score lists and the official result, then syncs only that battle."
        )

    def _start_direct_duel(self, mode: str) -> None:
        if mode == "glory-history":
            self.direct_glory_target = None
            self.direct_glory_queued = False
        super()._start_direct_duel(mode)

    def handle(self, kind: str, payload: Any) -> None:
        history = self.direct_duel_active and self.direct_duel_mode == "glory-history"
        command, decoded = "", None
        if history and kind == "response":
            try:
                command, _, _, decoded = decode_response(payload)
                if command in {"domain.al.his", "domain.al.war.member.score.his"}:
                    self.direct_duel_observed[command] += 1
            except Exception:
                pass

        # The base Duel completion rule only checks the index command. Keep the
        # capture open until both historical score lists pass validation.
        if history:
            self.direct_duel_finish_scheduled = True
        super().handle(kind, payload)
        if history and self.direct_duel_active:
            self.direct_duel_finish_scheduled = False

        if not history or kind != "response":
            return
        if command == "domain.al.his" and not self.direct_glory_queued:
            target = latest_finished_war(decoded)
            if target is None:
                self._set_direct_status("No recent finished WDZ Glory War appeared in the Logs response; retaining the diagnostic package.", Colors.DANGER)
                return
            self.direct_glory_target = target
            self.direct_glory_queued = True
            try:
                script = self.capture.state.script
                if script is None:
                    raise RuntimeError("The capture bridge detached before history requests were queued.")
                planned = script.exports_sync.queue_direct_glory_history_scores(target)
                self._set_direct_status(
                    f"Latest war: WDZ vs {target['sides'][1]['abbr']} / State {target['sides'][1]['serverId']}. "
                    f"Queued {planned['requestCount']} bounded historical score requests; waiting for both lists…",
                    Colors.ACCENT,
                )
            except Exception as exc:
                self._set_direct_status(f"Could not request historical score lists: {exc}", Colors.DANGER)
        elif command == "domain.al.war.member.score.his" and self.direct_glory_target:
            try:
                session_id = str(self.session_id or self.direct_duel_session_id or "")
                snapshot, _ = build_glory_war_snapshot(session_id, SESSIONS_DIR)
                validate_historical_snapshot(snapshot, self.direct_glory_target)
            except (ValueError, FileNotFoundError):
                return
            if not self.direct_duel_finish_scheduled:
                self.direct_duel_finish_scheduled = True
                self.after(1200, lambda: self._finish_direct_duel("Both historical score lists and the official Logs result validated.", True))

    def _poll_direct_duel(self) -> None:
        if self.direct_duel_active and self.direct_duel_mode == "glory-history" and \
                time.monotonic() - self.direct_duel_started_at >= self.GLORY_HISTORY_TIMEOUT:
            self._finish_direct_duel("The historical score lists did not validate within 45 seconds. Diagnostic ZIP saved; nothing uploaded.", False)
            return
        super()._poll_direct_duel()

    def _finish_direct_duel(self, reason: str, success: bool) -> None:
        history = self.direct_duel_mode == "glory-history"
        session_id = str(self.session_id or self.direct_duel_session_id or "")
        super()._finish_direct_duel(reason, success)
        if not history or not session_id or not success:
            return
        try:
            if self.direct_glory_target is None:
                raise ValueError("No matching recent Logs battle was found.")
            snapshot, summary = build_glory_war_snapshot(session_id, SESSIONS_DIR)
            validate_historical_snapshot(snapshot, self.direct_glory_target)
            save_snapshot(self.store, session_id, snapshot)
            self.store.stop_session(session_id)
            package = self.store.package(session_id)
            rows = [row for row in self.store.snapshots_for_session(session_id) if row.get("dataset") == "glory_war_rankings"]
            if len(rows) != 1:
                raise ValueError("The validated Glory War snapshot was not saved exactly once.")
        except Exception as exc:
            self._append_direct_summary([f"Glory War: UNVERIFIED — {exc}", "Cloud sync: SKIPPED"])
            self._set_direct_status("Glory War scores could not be validated; no upload was sent.", Colors.DANGER)
            return

        opponent = f"{summary['opponentAllianceAbbr']} / State {summary['opponentServerId']}"
        self._append_direct_summary([
            f"Glory War: {summary['result']} vs {opponent}; {summary['players']} WDZ score rows.",
            f"Battle ended: {summary['capturedAt']}", f"Package: {package}",
        ])
        endpoint = str(self.config.values.get("cloudEndpoint") or "").strip()
        token = str(self.config.values.get("uploadToken") or "").strip()
        if not endpoint or not token:
            self._append_direct_summary(["Cloud sync: NOT CONFIGURED; validated capture remains local."])
            self._set_direct_status("Glory War validated locally. Configure Cloud Sync to upload it.", Colors.DANGER)
            return

        self._set_direct_buttons(False)
        self._set_direct_status("Glory War validated. Uploading the single historical score snapshot…", Colors.ACCENT)

        def upload() -> None:
            try:
                result = CloudClient(endpoint, token).upload(rows)
                confirmation = result.get("glorySync") if isinstance(result, dict) else None
                if not isinstance(confirmation, dict) or not confirmation.get("ok"):
                    raise RuntimeError(
                        "Cloud accepted the capture but did not confirm Glory War scores "
                        f"(accepted={result.get('accepted')}, duplicates={result.get('duplicates')}, "
                        f"cycle={result.get('cycleId')}, week={result.get('cycleWeek')}). "
                        "Deploy the current Alliance Tracker Worker, then press Pull + Sync Glory War again."
                    )
                if str(confirmation.get("opponentAllianceAbbr") or "").upper() != str(summary["opponentAllianceAbbr"]).upper() or \
                        str(confirmation.get("result") or "").upper() != str(summary["result"]).upper():
                    raise RuntimeError("Cloud confirmation did not match the locally validated Glory War result.")
                accepted_ids = {int(value) for value in result.get("acceptedSnapshotIds", [])}
                if int(rows[0]["id"]) not in accepted_ids:
                    raise RuntimeError("Cloud did not acknowledge this Glory War snapshot ID.")
                self.store.mark_synced([rows[0]["id"]])
                self.after(0, lambda: self._glory_sync_done(session_id, result, summary))
            except Exception as exc:
                self.after(0, lambda message=str(exc): self._glory_sync_failed(message))

        threading.Thread(target=upload, daemon=True).start()

    def _glory_sync_done(self, session_id: str, result: dict[str, Any], summary: dict[str, Any]) -> None:
        self._set_direct_buttons(True)
        self._append_direct_summary([
            "Cloud sync: ACCEPTED",
            f"Session: {session_id}; cycle {result.get('glorySync', {}).get('cycleId', '—')} / week {result.get('glorySync', {}).get('cycleWeek', '—')}",
            f"WDZ {summary['primaryStateScore']:,} vs {summary['opponentAllianceAbbr']} {summary['opponentStateScore']:,} ({summary['result']})",
        ])
        self._set_direct_status("Glory War score snapshot was accepted by cloud sync.", Colors.SUCCESS)
        self.refresh_sessions()

    def _glory_sync_failed(self, message: str) -> None:
        self._set_direct_buttons(True)
        self._append_direct_summary(["Cloud sync: FAILED / NOT ACKNOWLEDGED", message, "The validated local ZIP remains available as a diagnostic record."])
        self._set_direct_status("Glory War validated locally, but cloud sync did not complete.", Colors.DANGER)
