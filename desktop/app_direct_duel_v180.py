from __future__ import annotations

from typing import Any

from app import Colors
from app_direct_duel_v178 import App as DirectDuelDiagnosticsApp
from capture import decode_response
from direct_duel import summarize_response


class App(DirectDuelDiagnosticsApp):
    """Direct Duel 1.8.0: working direct sync plus bounded historical exploration."""

    EXPLORER_GRACE_MS = 8000

    def __init__(self) -> None:
        super().__init__()
        if hasattr(self, "direct_previous_button"):
            self.direct_previous_button.configure(
                text="HISTORICAL EXPLORER",
                command=lambda: self._start_direct_duel("explore"),
            )
        if hasattr(self, "direct_duel_status"):
            self.direct_duel_status.configure(
                text=(
                    "Direct request transport is confirmed working. Historical Explorer tests a small, fixed set of "
                    "read-only Duel request variants against the known previous group/week and packages every response."
                )
            )
        self._set_direct_summary(
            "Historical Explorer target from the successful context capture:\n"
            "  previous Duel group: 400_3_1\n"
            "  previous week start: 1789956000000\n\n"
            "The probe checks rank types 0-5 plus bounded previous-week/group argument variants.\n"
            "No mutation commands and no arbitrary request console are exposed."
        )

    @staticmethod
    def _find(value: Any, key: str) -> Any:
        if isinstance(value, dict):
            if key in value:
                return value[key]
            for child in value.values():
                found = App._find(child, key)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = App._find(child, key)
                if found is not None:
                    return found
        return None

    def _write_explorer_response_observation(self, payload: Any) -> None:
        try:
            command, sequence, captured_at, decoded = decode_response(payload)
        except Exception as exc:
            self._write_direct_diagnostic(
                "direct-duel-explorer-response-decode-error",
                {"error": str(exc)},
            )
            return

        if command not in {
            "get.alliance.duel.season.info",
            "get.alliance.duel.group.info",
            "al.battle.week.result.info",
            "al.battle.rank.info",
        }:
            return

        rank_info = self._find(decoded, "rankInfo")
        flattened_rows = 0
        if isinstance(rank_info, list):
            for item in rank_info:
                if isinstance(item, list):
                    flattened_rows += len(item)
                elif isinstance(item, dict):
                    flattened_rows += 1

        self._write_direct_diagnostic(
            "direct-duel-explorer-response",
            {
                "sequence": sequence,
                "capturedAt": captured_at,
                "command": command,
                "summary": summarize_response(command, decoded),
                "rankType": self._find(decoded, "type"),
                "weekStartTime": self._find(decoded, "startTime"),
                "currentGroup": (
                    (self._find(decoded, "duelInfo") or {}).get("group")
                    if isinstance(self._find(decoded, "duelInfo"), dict)
                    else None
                ),
                "previousGroup": (
                    (self._find(decoded, "lastDuelInfo") or {}).get("group")
                    if isinstance(self._find(decoded, "lastDuelInfo"), dict)
                    else None
                ),
                "rankRows": flattened_rows,
            },
        )

    def handle(self, kind: str, payload: Any) -> None:
        if kind == "response" and self.direct_duel_active and self.direct_duel_mode == "explore":
            self._write_explorer_response_observation(payload)

        super().handle(kind, payload)

        if (
            kind == "direct-duel-executed"
            and self.direct_duel_active
            and self.direct_duel_mode == "explore"
            and not self.direct_duel_finish_scheduled
        ):
            self.direct_duel_finish_scheduled = True
            self._set_direct_status(
                "Historical Explorer request set executed. Collecting late/experimental responses for 8 seconds…",
                Colors.SUCCESS,
            )
            self.after(
                self.EXPLORER_GRACE_MS,
                lambda: self._finish_direct_duel(
                    "Historical Explorer grace period completed; all observed responses were packaged.",
                    success=True,
                ),
            )
