from __future__ import annotations

import customtkinter as ctk

from app import CLOUDFLARE_ENDPOINT, Colors
from app_v140_runtime import App as BaseApp, EVENTS


class App(BaseApp):
    """Final 1.4.0 review hardening without touching the proven replay engine."""

    def _extend_settings_for_automation(self) -> None:
        super()._extend_settings_for_automation()
        page = self.pages.get("settings")
        if not page:
            return

        panel = ctk.CTkFrame(
            page,
            fg_color=Colors.PANEL,
            corner_radius=14,
            border_width=1,
            border_color=Colors.BORDER,
        )
        panel.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(
            panel,
            text="Cloud Sync",
            text_color=Colors.TEXT,
            font=(self.font, 14, "bold"),
        ).pack(anchor="w", padx=15, pady=(13, 3))
        ctk.CTkLabel(
            panel,
            text="Auto Sync uses these saved credentials after a capture is verified.",
            text_color=Colors.MUTED,
            font=(self.font, 9),
        ).pack(anchor="w", padx=15, pady=(0, 8))

        endpoint_row = ctk.CTkFrame(panel, fg_color="transparent")
        endpoint_row.pack(fill="x", padx=15, pady=(0, 7))
        self.settings_cloud_endpoint = ctk.CTkEntry(
            endpoint_row,
            height=36,
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 9),
            placeholder_text=CLOUDFLARE_ENDPOINT,
        )
        self.settings_cloud_endpoint.pack(side="left", fill="x", expand=True)
        self.settings_cloud_endpoint.insert(0, str(self.config.values.get("cloudEndpoint") or CLOUDFLARE_ENDPOINT))
        ctk.CTkButton(
            endpoint_row,
            text="Use WDZ",
            width=82,
            height=36,
            fg_color=Colors.PANEL2,
            hover_color=Colors.BORDER,
            text_color=Colors.TEXT,
            font=(self.font, 8, "bold"),
            command=self._use_default_cloud_endpoint,
        ).pack(side="left", padx=(6, 0))

        token_row = ctk.CTkFrame(panel, fg_color="transparent")
        token_row.pack(fill="x", padx=15, pady=(0, 12))
        self.settings_cloud_token = ctk.CTkEntry(
            token_row,
            height=36,
            show="•",
            fg_color=Colors.PANEL2,
            border_color=Colors.BORDER,
            font=(self.font, 9),
            placeholder_text="Upload token",
        )
        self.settings_cloud_token.pack(side="left", fill="x", expand=True)
        self.settings_cloud_token.insert(0, str(self.config.values.get("uploadToken") or ""))
        ctk.CTkButton(
            token_row,
            text="Save Cloud",
            width=96,
            height=36,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=(self.font, 8, "bold"),
            command=self._save_cloud_settings,
        ).pack(side="left", padx=(6, 0))

    def _use_default_cloud_endpoint(self) -> None:
        if not hasattr(self, "settings_cloud_endpoint"):
            return
        self.settings_cloud_endpoint.delete(0, "end")
        self.settings_cloud_endpoint.insert(0, CLOUDFLARE_ENDPOINT)
        self._save_cloud_settings()

    def _save_cloud_settings(self) -> None:
        endpoint = self.settings_cloud_endpoint.get().strip()
        token = self.settings_cloud_token.get().strip()
        self.config.values["cloudEndpoint"] = endpoint
        self.config.values["uploadToken"] = token
        self.config.save()
        # Keep the hidden legacy Cloud page synchronized for code paths that still
        # reference its widgets internally.
        try:
            self.endpoint.delete(0, "end")
            self.endpoint.insert(0, endpoint)
            self.token.delete(0, "end")
            self.token.insert(0, token)
        except Exception:
            pass
        self.write("Cloud Sync settings saved locally.")

    def run_event_now(self, event_type: str) -> None:
        """Run exactly what is visible in a tab, without requiring it to be saved first.

        The persistent Today's Plan remains the production path. This button is an
        immediate testing/training action and therefore uses the generic JSON runner,
        even for Alliance Duel, instead of reloading today's saved Duel profile.
        """
        if self.duel_running or self.sync_plan_running:
            return
        job = self._job_from_controls(event_type)
        if not job:
            self._set_duel_status(
                f"Choose a saved Sequence Studio JSON for {EVENTS[event_type]} first.",
                Colors.DANGER,
            )
            return
        try:
            self._apply_job(job)
        except Exception as exc:
            self._set_duel_status(str(exc), Colors.DANGER)
            return

        self.sync_plan_running = True
        self.sync_plan_day = self._utc_day()
        self.sync_plan_queue = []
        self.sync_plan_current = dict(job)
        self.sync_plan_results = []
        self._auto_progress_value = 0.0
        self.auto_progress_bar.set(0)
        self.auto_run_button.configure(state="disabled")
        self.auto_progress_text.configure(
            text=f"Running unsaved {EVENTS[event_type]} tab settings · {job.get('sequence')}",
            text_color=Colors.ACCENT,
        )
        super().run_selected_json_manually()
        if not self.duel_running:
            self._sync_plan_abort(
                f"{EVENTS[event_type]} did not start. Check the status message above."
            )
