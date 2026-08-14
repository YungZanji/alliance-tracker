# Alliance Tracker

I built Alliance Tracker because keeping track of a large Last Z alliance through screenshots and spreadsheets got old quickly.

It started as a small Windows utility for Alliance Duel scores and grew into a desktop capture app plus a Cloudflare-backed portal for event performance, participation, polls, player activity, roster context and season history.

**Public demo:** https://wdz.state305.cc/#preview  
The demo is read-only and uses fictional data.

## What it does

- captures decoded game responses from the running Last Z PC client
- keeps raw responses and normalized snapshots locally so results can be audited
- tracks Alliance Duel performance across days, weeks and seasons
- stores State Ruler/SVS context and participation data
- exports a full alliance roster with Total Power, Arena Power and Last Seen activity
- archives alliance polls and response coverage
- keeps player identity stable when display names change
- replays trained Unity UI control sequences for repeatable collection runs
- syncs verified snapshots to a Cloudflare Worker and D1 database
- serves a responsive member and leadership portal with historical views and admin tools

## Why I built it

Alliance leadership involved a lot of screenshots, manual comparisons and spreadsheet work. That was manageable for a few players, but not for a roster close to 100 people across several recurring events.

I wanted one system that could collect the data I was already looking at in the game, keep the original evidence, turn it into useful history, and still let me trace a number back to the capture that produced it.

## Tech

- **Python + CustomTkinter** — Windows desktop app
- **Frida + JavaScript** — decoded-response capture and trained Unity control replay
- **SQLite** — local session history
- **Cloudflare Workers + D1** — hosted API and database
- **JavaScript / HTML / CSS** — member and leadership portal
- **PyInstaller** — one-file Windows build
- **GitHub Actions** — CI, Windows packaging and deployment

## Current desktop features

The current Windows build is **Alliance Tracker 1.7.6**. The desktop workspace includes dedicated pages for capture, polls, roster export, discovery, sessions, sequence recording/replay, SVS inspection, Auto Sync, Cloud Sync and settings.

Roster Export joins the game's alliance roster and Arena Power feeds by UID and produces reusable JSON containing Total Power, Arena Power, online state and Last Seen activity for the whole alliance.

A global workspace control can launch Last Z and arrange the tracker and game side-by-side on Windows.

## A few engineering details

Some of the parts that ended up mattering most were not the obvious UI pieces:

- player UIDs are treated as the stable identity so name changes do not split somebody's history
- captures keep source hashes so retrying a sync does not double-count the same dataset
- Last Z's game day is resolved around the 7 p.m. Pacific reset instead of assuming UTC calendar days
- roster activity distinguishes a real game-provided offline timestamp from somebody who was confirmed online at capture time
- trained UI replay resolves Unity controls by component type and object name, which is more reliable than matching a name alone
- the public preview is intentionally isolated from authenticated alliance APIs and uses fictional data

## Project layout

```text
desktop/       Windows app, capture pipeline and Frida agent
cloudflare/    Worker API, D1 migrations and portal assets
config/        capture and metric configuration
docs/          architecture, setup and deployment notes
scripts/       optional Windows automation helpers
tests/         regression and integration tests
tools/         local development helpers
```

## Run it locally

Run the desktop app from source:

```text
RUN_FROM_SOURCE.bat
```

Build the Windows executable:

```text
BUILD_WINDOWS_APP.bat
```

The build output is `desktop/dist/AllianceTracker.exe`.

Optional scheduled/headless Duel helpers are under `scripts/windows/` rather than mixed into the repository root.

See [docs/SETUP.md](docs/SETUP.md) for setup details and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow.

## Data and secrets

Local captures, databases, tokens and generated deployment configuration are intentionally excluded from Git. Desktop data is stored under:

```text
%LOCALAPPDATA%\AllianceTracker
```

The hosted deployment uses GitHub Actions secrets for Cloudflare credentials and the private upload token; those values are never stored in this repository.
