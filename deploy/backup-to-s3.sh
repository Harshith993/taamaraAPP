#!/usr/bin/env bash
# Nightly backup to S3 Mumbai (Phase 10, D50). Run on the server from cron, as the user that runs
# docker compose:
#   15 2 * * *  /srv/taamara/deploy/backup-to-s3.sh >> /var/log/taamara-backup.log 2>&1
# Needs the AWS CLI and the server's IAM role (deploy/iam-policy.json). BACKUP_BUCKET is set in
# deploy/.env. The bucket keeps 30 days (a lifecycle rule; docs/DEPLOYMENT.md). Uploaded files
# themselves live in the S3 files bucket with versioning, so a backup here is mainly the database.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${BACKUP_BUCKET:?set BACKUP_BUCKET in deploy/.env}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose exec -T app scripts/backup.sh "/app/data/backups/$STAMP"
LOCAL="/var/backups/taamara/$STAMP"
mkdir -p "$(dirname "$LOCAL")"
docker compose cp "app:/app/data/backups/$STAMP" "$LOCAL"
docker compose exec -T app rm -rf "/app/data/backups/$STAMP"
aws s3 cp --recursive --sse AES256 --region "${AWS_REGION:-ap-south-1}" "$LOCAL" "s3://$BACKUP_BUCKET/$STAMP/"
# Keep a week on the server as well, for a quick restore.
find /var/backups/taamara -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
echo "$(date -u +%FT%TZ) backup $STAMP uploaded to s3://$BACKUP_BUCKET/$STAMP/"
