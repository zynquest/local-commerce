#!/usr/bin/env bash
# Pull the latest code from GitHub, build, and restart. Run ON THE VM:
#   sudo /opt/vfl/app/deploy/deploy.sh            # deploys the current branch (main)
#   sudo BRANCH=release /opt/vfl/app/deploy/deploy.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
APP=/opt/vfl/app
BRANCH="${BRANCH:-main}"
as_vfl() { sudo -u vfl -H bash -lc "cd $APP && $*"; }

echo "==> git pull ($BRANCH)"
as_vfl "git fetch --prune origin && git checkout $BRANCH && git pull --ff-only origin $BRANCH"
as_vfl "git log -1 --format='    %h %s (%an, %ar)'"

echo "==> npm ci (workspaces: client + server)"
as_vfl "npm ci --no-audit --no-fund"

echo "==> Build PWA (client/dist)"
as_vfl "npm run build"

echo "==> Install/refresh systemd unit + restart API (runs DB migrations on start)"
install -m 644 $APP/deploy/systemd/vfl-api.service /etc/systemd/system/vfl-api.service
systemctl daemon-reload
systemctl enable vfl-api >/dev/null
systemctl restart vfl-api

for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "    API healthy"
    break
  fi
  [ "$i" = 20 ] && { echo "API did not become healthy:"; journalctl -u vfl-api -n 40 --no-pager; exit 1; }
  sleep 1
done

if [ -e /etc/letsencrypt/live/sonsari.in/fullchain.pem ]; then
  echo "==> Nginx config"
  install -m 644 $APP/deploy/nginx/sonsari.in.conf /etc/nginx/sites-available/sonsari.in
  ln -sf /etc/nginx/sites-available/sonsari.in /etc/nginx/sites-enabled/sonsari.in
  nginx -t && systemctl reload nginx
fi

echo "==> Deployed. https://sonsari.in"
