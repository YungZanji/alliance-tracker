# 36C / State 261 initial deployment

Domain: https://36c.state261.app
Worker: alliance-tracker-36c
D1: alliance-tracker-36c-db
Branch: feature/36c-state261

## This first stage
A separate branded build of the latest portal and its schema. WDZ sources,
deployment workflow, D1 and desktop settings remain unchanged. Public preview is
available at /#preview. The production database starts without player records,
history, credentials, or sessions. Only the three default event weights are seeded.
Captures and admin writes are explicitly disabled until identity setup is complete.
The website is not ready for normal tracking yet; the preview can be reviewed.

## Deploy
1. Merge this branch, or run its workflow on this branch if GitHub exposes it.
   GitHub exposes new manual workflows once they exist on the default branch.
2. Existing CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets must authorize
   Workers, D1, and Workers custom domains for the account containing state261.app.
   Do not paste secrets into chat. A token without access to state261.app must be
   adjusted in GitHub/Cloudflare before attachment can succeed.
3. Run Deploy 36C tracker. Enable create_database only for initial provisioning.
   If the database exists already, inspect it before running; this is not a reset.
4. Verify /api/health identifies 36c-261 and uploadsEnabled is false.
5. Open /#preview. Do not point an unchanged desktop uploader at this site.

## Next stage before first capture
Confirm the 36C alliance game ID, administrator UID, first tracking date and Duel
cycle anchor using a new game capture. Add per-profile desktop storage and token,
configure server identity checks, provision a unique admin credential, and create
the new active season. Enable uploads only after WDZ-session rejection and 36C
Duel/Glory War/SVS tests pass. The URL alone is insufficient to repurpose the
existing WDZ capture app.

## Schema provenance
build-clean-baseline.py executes only CREATE/ALTER/DROP statements from legacy
migrations against an in-memory SQLite database, exports final schema, and
asserts every table is empty. It never runs WDZ data backfills. The clean migration
directory is separate from the WDZ migration chain. Future shared migrations
must be deliberately ported; do not point 36C at the legacy directory.
