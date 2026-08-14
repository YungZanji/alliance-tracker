# Data model

The hosted data model lives in Cloudflare D1. It started around Alliance Duel and now also covers seasons, event participation, polls, guest access and activity history.

## Player identity

The game UID is the stable internal identity. Display names are mutable.

The database keeps a current player record plus observed aliases so a rename does not split one player into multiple histories. Public/member-facing views use the appropriate public identity instead of exposing raw game UIDs unnecessarily.

## Captures

Each synchronized snapshot keeps enough source context to be handled idempotently. Dataset/source hashes prevent a repeated upload from being added twice.

A later authoritative capture can update current state while historical and audit records preserve meaningful changes.

## Alliance Duel

Duel data is stored at several levels:

- daily player scores
- authoritative weekly player scores
- Duel League cumulative totals
- alliance/opponent day results
- season and cycle context

The game week follows the Last Z Pacific reset boundary. A four-week Duel League can sit inside a longer season.

Current-week and league-cumulative ranking feeds are kept separate because they represent different scopes.

## Seasons

A season can contain multiple Duel Leagues and has an explicit scoring window. Completed seasons can be archived/frozen so later imports or settings changes do not rewrite the final historical leaderboard.

The event calendar distinguishes normal event weeks, Bye weeks, No Event weeks, approved player leave and missed events because those states should not all collapse into the same zero.

## Cross-event contribution

Alliance Duel and State Ruler are converted into comparable contribution indexes using configurable baselines and weights. Event-specific raw/credited values remain available instead of storing only one combined score.

## Roster and activity context

Roster exports use player UID to join Total Power, Arena Power and activity information. Literal Last Online values are kept when the game provides `offLineTime`; players who are online during capture are recorded as confirmed online at that capture time rather than being assigned a made-up offline timestamp.

That activity evidence stays separate from event scores so a missing score is not automatically treated as proof that somebody did or did not participate.

## Poll archive

Poll records preserve questions, options, vote totals and player responses so alliance decisions can still be reviewed after an in-game notice is gone. Archived answers can also be used as attendance evidence where that workflow is explicitly configured.

## Authentication and audit data

The portal stores player sessions, temporary read-only guest access, login history and administrative/audit timestamps separately from event score data.
