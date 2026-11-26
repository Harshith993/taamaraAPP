# Operations: backups, restores and checks

## Backups

```bash
scripts/backup.sh                    # writes ./backups/<date-time>/ (git-ignored)
scripts/backup.sh /path/to/folder    # or a folder of your choice
```

Each backup holds:

| File | What |
|---|---|
| `db.dump` | the whole database (pg_dump custom format), including the guard triggers that protect money and the audit log |
| `files.tar.gz` | every stored file: originals, viewing copies and thumbnails (not unfinished uploads) |
| `manifest.txt` | when it was taken, row counts of the main tables, the trigger count, the file count, and SHA-256 of both archives |

In production (Phase 10) the plan is: a nightly backup by cron to an S3 bucket in Mumbai with versioning and 30-day retention, plus RDS/PostgreSQL point-in-time recovery if the database is managed. Files will live in S3 with versioning, so `files.tar.gz` is then only needed for local storage.

## Restoring

Always into a **new, empty** database and storage folder. The guard triggers stop records being deleted, so restoring over live data is refused on purpose (`restore.sh` checks this first).

```bash
createdb -O taamara taamara_restore          # as the postgres user
scripts/restore.sh backups/<date-time> \
  "postgresql://taamara:<password>@localhost:5432/taamara_restore" \
  /srv/taamara/storage-restore
```

`restore.sh` checks both archives against their SHA-256, restores, then compares row counts, the trigger count and the file count with the manifest, and checks every ready file has its bytes. It ends with `RESTORE CHECK PASSED` or fails.

To switch the app to the restored copy, point `DATABASE_URL` and `STORAGE_DIR` at it and restart. `BETTER_AUTH_URL` must be the address people use, or sign-in refuses the request ("invalid origin").

## Drill log

| Date | What | Result |
|---|---|---|
| 26 Nov 2026 | Backed up the development database after a full round of browser checks (7 bookings, 15 payments, 73 audit entries, 10 files, 24 stored file copies). Restored into a new database and folder. | Backup 0.4 s, restore and check 1.3 s. Row counts, 19 triggers and 24 stored files all matched; no ready file missing its bytes. Restoring over a non-empty database was refused. The production build ran on the restored copy: the `proof` browser check passed 12/12 (photos and videos open from restored files); `smoke` passed 20/23, the 3 differences being counts the other browser checks had changed in the source data (a booking they added, an extra they approved), not restore errors. |

Repeat the drill after Phase 10 against the real servers, and then every three months.
