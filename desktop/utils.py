from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AllianceTracker"
SESSIONS_DIR = APP_DATA_DIR / "sessions"
CONFIG_PATH = APP_DATA_DIR / "local-config.json"
DB_PATH = APP_DATA_DIR / "alliance-tracker.sqlite3"
LOG_PATH = APP_DATA_DIR / "alliance-tracker.log"

for directory in (APP_DATA_DIR, SESSIONS_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def local_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def safe_slug(value: str, max_length: int = 80) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    return (cleaned or "capture")[:max_length]


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_hash(value: Any) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def integer(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9-]", "", value)
        if cleaned and cleaned not in {"-", "--"}:
            try:
                return int(cleaned)
            except ValueError:
                pass
    return 0


def log(message: str) -> None:
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{utc_now()} {message}\n")
