from __future__ import annotations

import json
from typing import Any

from app_direct_duel import App as DirectDuelApp
from utils import SESSIONS_DIR, utc_now


class App(DirectDuelApp):
    """Direct Duel 1.7.8 diagnostics layered onto the existing lab UI.

    The request injector now follows the proven Last Z Gambler main-thread route.
    This wrapper persists every Direct Duel lifecycle event plus periodic RPC status
    snapshots inside the session ZIP so a failed live test identifies the exact
    stage instead of ending as an opaque timeout.
    """

    def __init__(self) -> None:
        self._direct_status_fingerprint = ""
        super().__init__()

    def _write_direct_diagnostic(self, kind: str, payload: Any) -> None:
        session_id = str(self.session_id or self.direct_duel_session_id or "")
        if not session_id:
            return
        try:
            raw_dir = SESSIONS_DIR / session_id / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            path = raw_dir / "direct-duel-diagnostics.jsonl"
            row = {
                "observedAt": utc_now(),
                "kind": str(kind or "direct-duel-status"),
                "payload": payload,
            }
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
        except Exception as exc:
            self.write(f"Direct Duel diagnostic write failed: {exc}")

    def _capture_direct_status(self) -> None:
        if not self.direct_duel_active:
            return
        script = self.capture.state.script
        if script is None:
            return
        try:
            status = dict(script.exports_sync.get_direct_duel_status() or {})
        except Exception as exc:
            status = {"statusReadError": str(exc)}

        fingerprint = json.dumps(status, sort_keys=True, ensure_ascii=False, default=str)
        if fingerprint == self._direct_status_fingerprint:
            return
        self._direct_status_fingerprint = fingerprint
        self._write_direct_diagnostic("direct-duel-status", status)

        if status.get("executed"):
            route = str(status.get("executionRoute") or "game request bridge")
            self._set_direct_status(
                f"Direct request executed through {route}. Waiting for Duel responses…"
            )
        elif status.get("managerReady"):
            self._set_direct_status(
                "XLuaManager found. Preparing the proven SafeDoString request route…"
            )
        elif status.get("lastError"):
            self._set_direct_status(
                "Direct request bridge is still preparing: " + str(status.get("lastError"))
            )

    def _poll_direct_duel(self) -> None:
        self._capture_direct_status()
        super()._poll_direct_duel()

    def handle(self, kind: str, payload: Any) -> None:
        if str(kind).startswith("direct-duel-"):
            self._write_direct_diagnostic(kind, payload)

            if kind == "direct-duel-manager-ready":
                self._set_direct_status(
                    "XLuaManager instance found on the game main thread. Preparing SafeDoString…"
                )
            elif kind == "direct-duel-manager-sweep":
                self._set_direct_status(
                    "XLuaManager located through Unity Resources. Sending read-only Duel requests…"
                )
            elif kind == "direct-duel-route-fallback":
                self._set_direct_status(
                    "SafeDoString failed; trying the LuaEnv.DoString fallback…"
                )
            elif kind == "direct-duel-waiting":
                self._set_direct_status(
                    "Waiting for the live XLuaManager instance on the game main thread…"
                )

        super().handle(kind, payload)
