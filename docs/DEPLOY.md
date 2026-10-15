# Deploy runbook (GitHub -> Docker Hub -> Olares)

Pattern copied from Cory's `web-olares` project.

1. **Develop** on a branch; `npm run check` must pass.
2. **Bump** `scripts/bump-version.sh patch` (keeps `package.json`, `deploy/olares/rogue/Chart.yaml`, `OlaresManifest.yaml` in sync; CI fails on drift). Commit.
3. **Push** `main`. The remote has no stored credential on the Hermes host: push with `GITHUB_TOKEN` from `/opt/data/.env` using an `Authorization` header (do not embed the token in remote URLs or print it).
4. **CI**: `ci.yml` (typecheck/test/build/version check) and `build-image.yml` (pushes `cisakson/rogue:<version>` + `:latest`; needs repo secrets `DOCKER_USERNAME`, `DOCKER_PASSWORD` = Docker Hub PAT with read/write). Watch with `python3 scripts/monitor-actions.py` (keyed to the commit SHA).
5. **Deploy** on a host with `olares-cli` logged in: `scripts/deploy.sh` (lint, package, upload, in-place upgrade or first install, wait for `running`, set route `rogue` -> `https://rogue.cisakson.olares.com`, set auth level). Rollback: `scripts/deploy.sh --version X.Y.Z`.
6. **Monitor**: `scripts/verify.sh` (market status + `/healthz` reports the deployed version). Entrance is `private` by default (Olares login); set `ROGUE_AUTH_LEVEL=public` only on purpose.
7. **Tag** a release `vX.Y.Z` after a verified deploy.

Pitfalls (inherited): never uninstall to upgrade; chart folder name must be lowercase alnum; set `metadata.appid`; amd64-only builds (QEMU arm64 crashes); mirror pull errors are transient, retry the upgrade; pod rollout takes minutes.


## Restore (runbook)
Backups: `Data/rogue/backups/backups/kb/<date>/` = `kb.dump.enc` (database) + `files.tar.enc` (data dir: private rulebook copies, oauth.json, admin token) + `manifest.json`. AES-256-GCM; key = `Data/rogue/files/backup-key` (or env ROGUE_BACKUP_KEY). `scripts/restore.mjs` needs only Node (plus pg_restore/tar):
- `node scripts/restore.mjs list <dir>` / `verify <dir> <date>` (checksums + decrypt, writes nothing)
- `node scripts/restore.mjs db <dir> <date> <targetDatabaseUrl>`: into a scratch DB first. Restoring over the live DATABASE_URL is refused without `--force-prod`, which needs Cory's approval.
- `node scripts/restore.mjs files <dir> <date> <targetDir>`
The app runs a restore test on Sundays and from /admin/backups. Failures post to Discord (RGE-A14).
