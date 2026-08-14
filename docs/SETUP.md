# Local setup

Alliance Tracker's desktop app runs on Windows because it attaches to the Last Z PC client.

## Requirements

- Windows 11 or another current 64-bit Windows installation
- 64-bit Python 3.11, 3.12, 3.13 or 3.14
- Last Z installed and able to reach the normal city screen
- Git or GitHub Desktop if you want to pull updates directly

## Run from source

From the repository root, run:

```text
RUN_FROM_SOURCE.bat
```

The launcher creates `desktop/.venv` when needed, installs the desktop dependencies, and starts the current `desktop/main.py` entrypoint.

## Build the Windows app

From the repository root, run:

```text
BUILD_WINDOWS_APP.bat
```

The builder finds a supported 64-bit Python runtime, updates the private build environment, runs the desktop checks, prepares the font/icon assets and packages the app with PyInstaller.

Build output:

```text
desktop\dist\AllianceTracker.exe
desktop\dist\AllianceTracker_1.7.6.exe
```

## First run

1. Start Last Z and reach the city screen.
2. Open Alliance Tracker.
3. Set the Last Z executable path in Settings if it is not already saved.
4. Attach to `Survival.exe` when you want to capture game data.
5. Use the capture, roster, poll or sequence tools you need and package the session when finished.

Local application data is stored under:

```text
%LOCALAPPDATA%\AllianceTracker
```

The local configuration file is:

```text
%LOCALAPPDATA%\AllianceTracker\local-config.json
```

That file can contain the Cloudflare upload token and should never be committed.

## Cloud sync

The production sync endpoint is:

```text
https://wdz.state305.cc/api/sync
```

The desktop endpoint and upload token are saved locally through the app's Settings/Cloud Sync controls.

## Scheduled Duel helpers

Optional Windows automation helpers live under `scripts/windows/`:

- `RUN_WEEKDAY_DUEL_SYNC.bat`
- `RUN_SUNDAY_DUEL_SYNC.bat`
- `INSTALL_SCHEDULED_DUEL_TASK.bat`

The weekday runner uses the saved production sequence. Sunday remains a visible/manual launch until a stable Sunday route is trained and tested.

## Pulling updates

If the repository is cloned with GitHub Desktop or Git, pull `main` and run `BUILD_WINDOWS_APP.bat` when you want a fresh executable.
