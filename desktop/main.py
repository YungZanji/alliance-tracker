from __future__ import annotations

import app_v170_runtime
from app_current import App as CurrentApp

# The current UI extends the tested capture/automation stack underneath it.
app_v170_runtime.App = CurrentApp

import startup as base_startup

base_startup.APP_VERSION = "1.7.6"


if __name__ == "__main__":
    raise SystemExit(base_startup.main())
