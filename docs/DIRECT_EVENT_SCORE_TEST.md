# Direct score test (Windows app 1.8.4)

The Overview page has **Test Glory War**, **Test State Ruler**, and **Test All Three**. Run Last Z in the city and keep it in the foreground while a test executes. Each button sends only the listed read-only game requests through the same `XLuaManager.SafeDoString` path used by the verified Alliance Duel pull. The game does not need to display a score screen.

| Button | Direct requests | Local validation |
| --- | --- | --- |
| Test Glory War | `alliance.declare.war.personal.rank` | Existing Glory War decoder requires WDZ player scores, both state IDs, and opponent identity. |
| Test State Ruler | `server.battle.user.score.rank`, `al.rank` | Existing State Ruler decoder requires scores and same-session WDZ roster/activity data. |
| Test All Three | Seven verified Duel requests plus the three requests above | Duel capture quality and both event decoders are checked separately. |

The app saves a ZIP even when a response does not arrive or validation fails. The summary says **VERIFIED** or **UNVERIFIED** for each event. The new event test buttons do not upload unproven data; **Pull + Sync Duel** retains its existing validated upload behavior. A successful local event test establishes the direct request and decoding path on the current live game client; a subsequent cloud sync integration still needs to be validated before unattended event sync is enabled.

For a failed event, retain the ZIP and inspect `raw/responses.jsonl` for the requested command. A missing response suggests the command requires a game-specific argument or an active event state. A response with unrecognized rows points to decoder adaptation. The historical Glory War path (`domain.al.his` and `domain.al.war.member.score.his`) needs a battle identifier from a live response; this version tests the active personal ranking and does not guess a historical identifier.
