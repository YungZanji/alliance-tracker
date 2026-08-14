# Architecture

Alliance Tracker has two main pieces: a Windows collector and a hosted portal.

```text
Last Z PC client (Survival.exe)
        |
        | decoded responses + trained Unity control replay
        v
Windows desktop app
        |
        +--> raw JSONL / normalized JSON / CSV
        +--> roster/activity JSON exports
        +--> local SQLite history
        +--> packaged session ZIPs
        |
        | verified snapshot sync
        v
Cloudflare Worker
        |
        v
D1 database
        |
        v
Alliance Tracker web portal
```

## Windows app

The desktop app handles collection, local history and repeatable capture workflows. It attaches to the running game client, observes decoded responses, normalizes known datasets and keeps the source session evidence locally.

Sequence Studio records and replays Unity controls through the game client's normal UI path. The production Alliance Duel flow uses trained controls while response capture stays tied to the data the client actually receives.

Roster Export joins `al.rank` and `al.arena.power` by player UID to produce a reusable snapshot containing Total Power, Arena Power, current online state and Last Seen activity for the full alliance.

## Local storage

Desktop data lives under `%LOCALAPPDATA%\AllianceTracker` and includes:

- local configuration
- SQLite capture history
- raw response streams
- normalized snapshots
- roster/activity exports
- packaged session ZIPs
- saved control sequences
- background-run status/history

Captured player data is intentionally excluded from the repository.

## Cloud API

The hosted API is a Cloudflare Worker. The desktop app syncs verified snapshots to `/api/sync` using a private upload token.

The Worker handles authentication, event data, roster state, season/scoring rules, polls, guest access and the portal's read APIs. D1 is the persistent store.

## Portal

The frontend is served with the Worker and provides member and leadership views for:

- combined alliance contribution
- Alliance Duel
- State Ruler/SVS
- Glory War
- polls
- activity and audit history
- scoring guide
- season history
- administrator controls

A public preview at `/#preview` uses fictional data and does not expose authenticated alliance data or write controls.

## Identity and deduplication

Game UIDs are the stable player identity. Display names are treated as aliases because players can rename themselves.

Captured payloads and normalized snapshots carry hashes so repeated collection can be handled idempotently instead of double-counting the same state.
