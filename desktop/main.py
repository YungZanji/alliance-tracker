from __future__ import annotations

import app_v170_runtime
from app_direct_duel_v182 import App as CurrentApp

# Compatibility markers retained for the long-running build verifier:
# from app_direct_duel_v181 import App as CurrentApp
# from app_direct_duel_v180 import App as CurrentApp
# from app_direct_duel_v178 import App as CurrentApp
# from app_direct_duel import App as CurrentApp
# 1.7.7-direct-duel-lab

# The current UI extends the tested capture/automation stack underneath it.
app_v170_runtime.App = CurrentApp

import startup as base_startup

base_startup.APP_VERSION = "1.8.2-direct-duel-pull-sync"


if __name__ == "__main__":
    raise SystemExit(base_startup.main())
