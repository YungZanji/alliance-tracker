from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any

from app import Colors
from app_v142_import_runtime import App as BaseApp
from cloud import USER_AGENT

POLL_CLIENT_VERSION = "1.4.3-review"


class App(BaseApp):
    """1.4.3 review: Poll Archive sync uses the same Cloudflare-safe HTTP identity as normal sync."""

    def _poll_sync_worker(self, endpoint: str, token: str, payload: dict[str, Any]) -> None:
        try:
            request = urllib.request.Request(
                endpoint,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "Accept": "application/json",
                    "User-Agent": USER_AGENT,
                    "Authorization": f"Bearer {token}",
                    "X-Alliance-Tracker-Client": f"desktop/{POLL_CLIENT_VERSION}",
                    "Cache-Control": "no-cache",
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode("utf-8", errors="replace")
            try:
                result = json.loads(text)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Cloudflare returned non-JSON content: {text[:300]}") from exc
            if result.get("ok") is not True:
                raise RuntimeError(str(result.get("error") or "Cloudflare returned ok=false"))
            self.after(0, lambda r=result: self._poll_sync_done(r))
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = str(exc)
            lowered = detail.lower()
            if exc.code == 403 and ("error code: 1010" in lowered or "error 1010" in lowered):
                detail = (
                    "Cloudflare Browser Integrity Check rejected the desktop HTTP signature (Error 1010). "
                    "This 1.4.3 build uses the same browser-shaped headers as the working Alliance Duel uploader. "
                    "Confirm you rebuilt 1.4.3 and that Cloud Endpoint still points to https://wdz.state305.cc/api/sync."
                )
            else:
                detail = f"Cloud returned HTTP {exc.code}: {detail[:500]}"
            self.after(0, lambda d=detail: self._poll_sync_failed(d))
        except urllib.error.URLError as exc:
            self.after(0, lambda d=f"Could not reach the Poll Archive endpoint: {exc.reason}": self._poll_sync_failed(d))
        except (TimeoutError, socket.timeout):
            self.after(0, lambda: self._poll_sync_failed("Poll Archive sync timed out after 60 seconds. Retrying is safe because poll IDs are upserted, not duplicated."))
        except Exception as exc:
            self.after(0, lambda d=str(exc): self._poll_sync_failed(d))
