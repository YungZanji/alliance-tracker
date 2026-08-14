from __future__ import annotations

from app_v120_runtime import App as HardenedRuntimeApp
from app_v124_runtime import App as BaseApp, STARTUP_PCMASK


class App(BaseApp):
    """Final 1.2.4 runtime shim for selectable Sequence Studio JSON automation."""

    def _duel_sequence_tick(self, generation: int | None = None) -> None:
        if self.automation_sequence_mode:
            # Bypass the Sunday Early/Late branch overrides entirely. Saved Sequence
            # Studio JSONs use the generic serialized timer engine and their own
            # recorded/fixed pacing instead of Duel-specific response gates.
            HardenedRuntimeApp._duel_sequence_tick(self, generation)
            return
        super()._duel_sequence_tick(generation)

    def _effective_custom_sequence(self, steps):
        result = [dict(step) for step in steps]
        self.automation_startup_step_count = 0

        # The common startup layer owns the first PCMask. Strip one legacy leading
        # PCMask from older Sequence Studio recordings regardless of the selected
        # startup action, then add it back only when the operator asks for it.
        if result and str(result[0].get("name") or "") == "PCMask":
            result.pop(0)

        startup = self.automation_startup_menu.get() if hasattr(self, "automation_startup_menu") else STARTUP_PCMASK
        if startup == STARTUP_PCMASK:
            result.insert(0, {
                "controlType": "Button",
                "name": "PCMask",
                "replayKey": "PCMask",
                "delayMs": 0,
                "optional": True,
                "startupAction": True,
            })
            self.automation_startup_step_count = 1
        return result

    def _automation_sequence_changed(self, value: str) -> None:
        super()._automation_sequence_changed(value)
        custom = value in self._automation_profiles
        if hasattr(self, "duel_profile_menu"):
            try:
                self.duel_profile_menu.configure(state="disabled" if custom else "normal")
            except Exception:
                pass
        if hasattr(self, "duel_profile_hint"):
            if custom:
                self.duel_profile_hint.configure(
                    text="A saved Sequence Studio JSON is selected above, so the legacy weekday/Sunday Duel profile is ignored for this run."
                )
            else:
                try:
                    self.duel_profile_hint.configure(text=self._profile_hint(self.duel_profile_menu.get()))
                except Exception:
                    pass
