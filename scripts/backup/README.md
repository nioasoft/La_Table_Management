# Daily Database Backup

Automated daily backup of the production Neon Postgres database. Triggered by GitHub Actions, uploads to Vercel Blob, and emails a download link to admins.

## Architecture

```
GitHub Actions (daily 00:00 UTC)
  → pg_dump (PostgreSQL 17 client) → backup-YYYY-MM-DD.dump
  → npm run backup:run
      → upload to Vercel Blob (database-backups/ prefix)
      → email download link via Resend
      → delete blobs older than retention window
```

## Files

- `run-backup.ts` - orchestration: upload, email, cleanup
- `email-template.ts` - Hebrew RTL HTML/text email template

The GitHub Actions workflow lives at `.github/workflows/database-backup.yml`.

## Required GitHub Secrets

Configure under `Settings → Secrets and variables → Actions` in the repository:

| Secret                     | Purpose                                                  |
| -------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`             | Production Neon Postgres connection string               |
| `BLOB_READ_WRITE_TOKEN`    | Vercel Blob write token (Vercel project → Storage → Blob)|
| `RESEND_API_KEY`           | Resend API key for sending the notification email        |
| `EMAIL_FROM`               | Sender address (e.g. `office@latable.co.il`)             |
| `EMAIL_FROM_NAME`          | Sender display name (e.g. `La Table Management`)         |
| `BACKUP_NOTIFICATION_TO`   | Primary recipient (e.g. `reutl@latableg.com`)            |
| `BACKUP_NOTIFICATION_CC`   | Optional CC recipient (e.g. `asaf@giggsi.co.il`)         |
| `BACKUP_RETENTION_DAYS`    | Optional, defaults to `30`                               |

`DATABASE_URL` must point at the production Neon database (not pooler) for `pg_dump` compatibility - prefer the direct (non-pooled) connection string from the Neon dashboard.

## Manual Run

From GitHub UI: `Actions → Daily Database Backup → Run workflow`.

## Local Smoke Test

The script can be run locally against a test database:

```bash
# 1. Create a small test dump
pg_dump "$DATABASE_URL" --format=custom --file=test-backup.dump

# 2. Set env vars
export DUMP_FILE=test-backup.dump
export BACKUP_DATE=$(date +%Y-%m-%d)
export BLOB_READ_WRITE_TOKEN=...
export RESEND_API_KEY=...
export EMAIL_FROM=office@latable.co.il
export EMAIL_FROM_NAME="La Table Management"
export BACKUP_NOTIFICATION_TO=your-test-email@example.com
export BACKUP_RETENTION_DAYS=30

# 3. Run
npm run backup:run
```

Sends a real email and uploads a real blob - use a test recipient.

## Restore Procedure

To restore from a downloaded dump file:

```bash
# Restore into a fresh database
createdb restore_test
pg_restore --dbname=restore_test --no-owner --no-privileges backup-YYYY-MM-DD.dump

# Or restore over existing (DESTRUCTIVE)
pg_restore --dbname="$DATABASE_URL" --clean --no-owner --no-privileges backup-YYYY-MM-DD.dump
```

The dump uses `--format=custom` which is compressed and supports selective restore via `pg_restore -l` to list contents.

## Retention & Cost

- Default retention: 30 days. Old blobs auto-deleted on each successful run.
- Vercel Blob cost (~$0.023/GB-month): for ~100MB dumps × 30 days ≈ $0.07/month.
- GitHub Actions minutes (~5 min/run × 30 = 150 min/month) - well within the 2000-min free tier.

## Time Zone Note

Cron schedule is `0 0 * * *` UTC, which translates to:

- 02:00 Israel Standard Time (winter)
- 03:00 Israel Daylight Time (summer)

If the exact local hour matters, switch to two cron expressions with `if:` conditionals based on the date range.
