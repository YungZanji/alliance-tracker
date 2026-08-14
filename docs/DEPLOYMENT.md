# Deployment

The hosted Alliance Tracker runs on Cloudflare Workers with D1. The public site is served from:

```text
https://wdz.state305.cc
```

The desktop sync endpoint is:

```text
https://wdz.state305.cc/api/sync
```

## GitHub deployment

The **Cloudflare deploy** workflow is manually dispatched from GitHub Actions. It:

1. checks the required repository secrets
2. installs the Cloudflare/Wrangler dependencies and validates the Worker source
3. resolves the existing `alliance-tracker-db` D1 database, or creates it on a new environment
4. renders the Wrangler configuration with the D1 database ID
5. applies pending D1 migrations
6. stores the desktop upload token as the Worker `UPLOAD_TOKEN` secret
7. deploys the Worker and static portal assets
8. attaches `wdz.state305.cc`
9. checks the public health endpoint

Required Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ALLIANCE_UPLOAD_TOKEN`

None of those values belong in the repository.

## Local deployment

`DEPLOY_CLOUDFLARE_LOCAL.bat` is available when I want to deploy from the Windows checkout instead of GitHub Actions. It uses the same Cloudflare project and D1 database.

## Windows builds

The **Windows build** workflow runs the desktop verifier, packages `AllianceTracker.exe` with PyInstaller and uploads the finished executable as the `AllianceTracker-Windows` workflow artifact.

For local builds I use `BUILD_WINDOWS_APP.bat`.

## Public preview

The portal includes a read-only public preview at:

```text
https://wdz.state305.cc/#preview
```

The preview uses fictional data and does not expose private alliance APIs or write controls.
