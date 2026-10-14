
# Backup plan (day 1). Recommended; implement in Phase 0.

Principles: app container is disposable; all state lives outside it (Postgres, data dir). Backups go to an external data path on Olares (the same kind of mount webOlares uses for articles), behind the pluggable Storage Provider interface so S3/Azure/GCS can be added later (design plan section 6b).

## What is backed up
1. **KB database** (Postgres): nightly `pg_dump -Fc` (custom format) per schema; plain, no encryption (no secrets/PII by design).
2. **Private database** (accounts, chat, secrets/PII): separate schema/dump, encrypted (age or gpg) with a key held outside the backup location. Handled on its own path (plan section 6b).
3. **Data dir** (`ROGUE_DATA_DIR`): sheets, snapshots metadata, user media if any. Incremental via `rsync --link-dest` style daily snapshots or restic.
4. **Config**: instance profile, policy pack versions, agent playbooks (these are in git; the dump records the commit SHA).

## Schedule and retention
- Nightly 03:00 local: dump + manifest (file list, sizes, sha256, app version, schema version).
- Keep 7 daily, 4 weekly, 6 monthly. Pruning deletes only after the newest backup verifies.
- Day 1 target: external path `.../Data/rogue-backups/{kb,private,files}/YYYY-MM-DD/` (exact path = open item, RGE-A07 default).

## Verification (what makes it real)
- After each backup: checksum verify against manifest.
- Weekly: automated restore of the latest dump into a scratch database; run schema + row-count + rights-log replay checks; report pass/fail to Discord.
- Alert on: missed run, size drop >30%, verify fail, free space <15%.

## Recovery
- Runbook: `rogue restore --from <date> --target scratch|prod`. Prod restore needs human approval (Operator agent proposes, Cory approves).
- RPO 24h, RTO < 1h for a single-node instance. Level 2 (WAL archiving/PITR with pgBackRest) is optional later.

## Off-box
Second copy to a different physical location is strongly recommended before relying on this data (cloud bucket via Storage Provider, Phase 7b). Until then the risk is "single disk" and is logged as R24 in the review log.
