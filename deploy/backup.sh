#!/usr/bin/env bash
# Nightly backup (root cron): Postgres dump + uploaded photos. Keeps 7 days locally and optionally
# copies to a Cloud Storage bucket (5 GB/month free in us-central1/us-east1/us-west1).
#   0 21 * * * BACKUP_BUCKET=gs://your-bucket /opt/vfl/app/deploy/backup.sh >> /var/log/vfl-backup.log 2>&1
set -euo pipefail
umask 077  # backups contain customer data: root-only
DIR=/var/lib/vfl/backups
STAMP="$(date +%Y%m%d-%H%M)"
sudo -u postgres pg_dump -Fc vocal_for_local > "$DIR/vfl-$STAMP.dump"
tar czf "$DIR/uploads-$STAMP.tgz" -C /var/lib/vfl uploads
ls -1t "$DIR"/vfl-*.dump | tail -n +8 | xargs -r rm --
ls -1t "$DIR"/uploads-*.tgz | tail -n +8 | xargs -r rm --
if [ -n "${BACKUP_BUCKET:-}" ]; then
  gcloud storage cp "$DIR/vfl-$STAMP.dump" "$DIR/uploads-$STAMP.tgz" "$BACKUP_BUCKET/" --quiet
fi
echo "$(date -Is) backup ok: vfl-$STAMP.dump"
