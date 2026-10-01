# Direct scores and sync (Windows app 1.8.5)

The Overview page has **Pull + Sync Duel**, **Pull + Sync Glory War**, **Test State Ruler**, and **Test All Three**. Run Last Z in the city and keep it in the foreground while a request executes. The game does not need to display a score screen.

| Button | Direct requests | Local validation |
| --- | --- | --- |
| Pull + Sync Glory War | `domain.al.his`, followed by bounded `domain.al.war.member.score.his` requests for both sides of the latest finished WDZ battle | Both score lists, state and alliance identities, battle time, and official win/loss must match before upload. The Worker confirms the match and player scores were persisted. |
| Test State Ruler | `server.battle.user.score.rank`, `al.rank` | Existing State Ruler decoder requires scores and same-session WDZ roster/activity data. |
| Test All Three | Seven verified Duel requests plus the three requests above | Duel capture quality and both event decoders are checked separately. |

The app saves a ZIP even when a response does not arrive or validation fails. **Pull + Sync Duel** uploads the complete current week through the current day, including official completed-day outcomes and live current-day player scores. **Pull + Sync Glory War** uploads only after its historical score pair validates. Deploy the corresponding Cloudflare Worker first: an older Worker does not confirm Glory War persistence, and the app will leave the local snapshot unsynced. State Ruler remains a local test for the next active event.

For a failed event, retain the ZIP and inspect `raw/responses.jsonl` for the requested command. The September 30 Glory probe returned `success: true` with no player rows, so the post-war personal ranking is not usable on that inactive screen. If the historical requests return no two-sided score pair, capture one manual Glory War Logs → View navigation with automation tracing to reveal the client's exact request arguments. The app will preserve diagnostics and skip upload.
