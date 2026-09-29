from __future__ import annotations

from app import Colors
from app_direct_duel_v180 import App as HistoricalExplorerApp


class App(HistoricalExplorerApp):
    """Direct Duel 1.8.1: current-week full sync without Duel UI rendering."""

    def __init__(self) -> None:
        super().__init__()

        self.direct_previous_button.configure(
            text="DIRECT FULL SYNC",
            command=lambda: self._start_direct_duel("sync"),
        )
        self.direct_current_button.configure(
            text="CURRENT DAY ONLY",
            command=lambda: self._start_direct_duel("current"),
        )
        self.direct_context_button.configure(
            text="HISTORICAL EXPLORER",
            command=lambda: self._start_direct_duel("explore"),
        )

        self.direct_duel_status.configure(
            text=(
                "Direct Full Sync pulls the current Duel context, official day results, current-day leaderboard, "
                "weekly combined leaderboard, own-alliance weekly leaderboard, and completed-day history directly "
                "from Last Z without opening the Duel screens."
            ),
            text_color=Colors.MUTED,
        )
        self._set_direct_summary(
            "DIRECT FULL SYNC sends 7 verified read-only requests:\n"
            "  get.alliance.duel.season.info\n"
            "  get.alliance.duel.group.info\n"
            "  al.battle.week.result.info\n"
            "  al.battle.rank.info, type=0   (current day combined)\n"
            "  al.battle.rank.info, type=1   (weekly combined)\n"
            "  al.battle.rank.info, type=2   (weekly own alliance)\n"
            "  al.battle.rank.info, type=3   (completed days)\n\n"
            "The resulting ZIP uses the same normalized datasets as the existing UI-driven capture."
        )
