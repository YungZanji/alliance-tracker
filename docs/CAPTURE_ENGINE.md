# Capture engine

The capture side started as a way to stop rebuilding Alliance Duel scores from screenshots. It now handles both targeted event collection and broader discovery sessions.

## Response capture

Alliance Tracker attaches to `Survival.exe` and observes decoded Lua responses after the game client has received them. Known response shapes are normalized into datasets while the original response stream is kept in the session package.

A normal session can include:

- raw response JSONL
- normalized JSON snapshots
- CSV exports
- capture/session metadata
- automation trace data
- the saved control sequence used for the run

## Sequence Studio

Sequence Studio records Unity Button/Toggle controls while I navigate the game normally. A saved sequence keeps the control name, component type and timing information needed to replay the same UI path later.

Fresh-session replay resolves controls by component type plus GameObject name. That avoids relying on a name alone when the client has multiple runtime objects with the same name.

The production Alliance Duel automation uses trained UI controls and waits for expected decoded responses before moving through data-sensitive steps.

## Discovery capture

Targeted captures keep the response set small when the dataset is already known. Full-data discovery is used when I am trying to identify a new feed such as roster activity, Arena Power or another event.

Discovery packages add command/timeline indexes and manual screen markers so an unfamiliar response can be correlated with what was open in the game when it arrived.

## Safety boundaries

The collector does not rewrite responses or manufacture score values. Automation follows trained client-side UI controls rather than constructing guessed SmartFox requests.

The raw session remains available alongside normalized data so a result can be traced back to the response that produced it.

## Local-only data

Capture packages can contain alliance/player information and are not committed to GitHub. They stay under `%LOCALAPPDATA%\AllianceTracker` unless I deliberately export one for debugging.
