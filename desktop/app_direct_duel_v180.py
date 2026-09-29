from __future__ import annotations

from typing import Any

from app import Colors
from app_direct_duel_v178 import App as DirectDuelDiagnosticsApp


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

    def handle(self, kind: str, payload: Any) -> None:
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
