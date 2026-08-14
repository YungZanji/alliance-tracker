from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from utils import CONFIG_PATH, utc_now


CLIENT_VERSION = "1.7.6"
# Cloudflare Browser Integrity Check can reject Python's default urllib signature.
# Send a standards-shaped browser identity plus an explicit app header instead.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36 AllianceTracker/1.7.6"
)


class Config:
    DEFAULTS = {
        "theme": "dark",
        "uiScale": 1.32,
        "uiScaleVersion": 2,
        "cloudEndpoint": "https://wdz.state305.cc/api/sync",
        "uploadToken": "",
        "gameExecutable": "",
        "autoSyncAfterDuel": True,
    }

    def __init__(self, path: Path = CONFIG_PATH) -> None:
        self.path = path
        self.values = dict(self.DEFAULTS)
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self.values.update(loaded)
            except (OSError, json.JSONDecodeError):
                pass

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.values, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class CloudClient:
    def __init__(self, endpoint: str, token: str) -> None:
        self.endpoint, self.token = endpoint.strip(), token.strip()

    def upload(self, snapshots: list[dict[str, Any]]) -> dict[str, Any]:
        if not self.endpoint or not self.token:
            raise RuntimeError("Cloud sync is not configured yet.")
        data = json.dumps(
            {
                "schemaVersion": 1,
                "uploadToken": self.token,
                "sentAt": utc_now(),
                "snapshots": snapshots,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
                "X-Alliance-Tracker-Client": f"desktop/{CLIENT_VERSION}",
                "Cache-Control": "no-cache",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                text = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            lowered = detail.lower()
            if exc.code == 403 and ("error code: 1010" in lowered or "error 1010" in lowered):
                raise RuntimeError(
                    "Cloudflare rejected the desktop HTTP signature (Error 1010). "
                    "Update Alliance Tracker to the latest build and retry."
                ) from exc
            raise RuntimeError(f"Cloud returned HTTP {exc.code}: {detail[:500]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not reach the cloud endpoint: {exc.reason}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise RuntimeError(
                "The cloud upload took longer than 3 minutes. The server may still be finishing "
                "the request. Retrying is safe because uploaded snapshots are deduplicated."
            ) from exc
        try:
            result = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Cloud returned non-JSON content: {text[:300]}") from exc
        if not result.get("ok"):
            raise RuntimeError(str(result.get("error") or "Cloud upload was rejected."))
        return result
