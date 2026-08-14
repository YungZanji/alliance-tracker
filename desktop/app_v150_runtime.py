from __future__ import annotations

from typing import Any

from app_v143_runtime import App as BaseApp


class App(BaseApp):
    """1.5.0 review: package the proven one-touch Duel workflow and audit outcome-feed capture."""

    def _outcome_capture_status(self) -> tuple[bool, int]:
        session_id = str(getattr(self, "duel_session_id", "") or "")
        if not session_id:
            return False, 0
        try:
            summary = self.store.summary(session_id)
            datasets = summary.get("datasets") or []
            count = 0
            for row in datasets:
                if str(row.get("dataset") or "") == "alliance_duel_results":
                    count += int(row.get("count") or row.get("snapshots") or 1)
            return count > 0, count
        except Exception:
            return False, 0

    def _write_duel_run_report(self, status: str, extra: dict[str, Any] | None = None) -> None:
        captured, count = self._outcome_capture_status()
        merged = dict(extra or {})
        merged.update({
            "oneTouchRelease": "1.5.0-review",
            "duelOutcomeDatasetCaptured": captured,
            "duelOutcomeSnapshotCount": count,
            "duelOutcomeContract": (
                "alliance_duel_results is uploaded whenever Last Z emits al.battle.week.result.info; "
                "missing outcome data is a warning, not a hard failure, until weekday emission is proven universal"
            ),
        })
        super()._write_duel_run_report(status, merged)

    def _duel_success(self, message: str) -> None:
        captured, count = self._outcome_capture_status()
        if captured:
            message = (
                f"{message} Duel Win/Loss outcome feed captured ({count} result snapshot"
                f"{'s' if count != 1 else ''}) and included in the Cloudflare package."
            )
        else:
            message = (
                f"{message} Score sync succeeded, but this run did not emit an Alliance Duel result snapshot. "
                "Scores are safe; Win/Loss status may remain pending until a later run captures the result feed."
            )
        super()._duel_success(message)
