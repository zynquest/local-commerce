#!/usr/bin/env bash
# One-time VM bootstrap for a GCP e2-micro (1 GB RAM, free tier). Works on Ubuntu 22.04/24.04 and Debian 11/12
# (PostgreSQL 16 comes from the official apt.postgresql.org repo when the OS doesn't ship it).
# Installs PostgreSQL 16, Node.js 20, Nginx and Certbot natively (no Docker) and prepares
# a dedicated "vfl" user, directories and /etc/vfl/env.
#
#   sudo bash setup-vm.sh
# Safe to re-run.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) echo "==> OS: ${PRETTY_NAME}" ;;
  *) echo "Unsupported OS '${PRETTY_NAME:-unknown}'. Create the VM from an Ubuntu 24.04 LTS or Debian 12 image."; exit 1 ;;
esac

echo "==> 2 GB swap (npm install + Vite build need more than 1 GB RAM)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf && sysctl -p /etc/sysctl.d/99-swappiness.conf
fi

echo "==> Base packages"
apt-get update
apt-get -y upgrade
apt-get install -y git curl ca-certificates gnupg openssl nginx certbot unattended-upgrades

echo "==> PostgreSQL 16"
if ! apt-cache show postgresql-16 >/dev/null 2>&1; then
  # Debian 12 ships 15, Ubuntu 22.04 ships 14: use PostgreSQL's official repository.
  echo "    postgresql-16 is not in ${PRETTY_NAME}'s repositories, so adding apt.postgresql.org"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update
fi
apt-get install -y postgresql-16
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Keep logs small (30 GB disk)"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald

echo "==> Node.js 20"
if ! command -v node >/dev/null || ! node -v | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> PostgreSQL tuned for 1 GB RAM, local connections only"
mkdir -p /etc/postgresql/16/main/conf.d
cat > /etc/postgresql/16/main/conf.d/vfl.conf <<'PG'
listen_addresses = 'localhost'
shared_buffers = 64MB
effective_cache_size = 192MB
work_mem = 2MB
maintenance_work_mem = 32MB
max_connections = 30
PG
systemctl enable --now postgresql
systemctl restart postgresql

echo "==> App user and directories"
id vfl >/dev/null 2>&1 || useradd --system --home-dir /opt/vfl --create-home --shell /bin/bash vfl
mkdir -p /opt/vfl /var/lib/vfl/uploads /var/lib/vfl/backups /etc/vfl /var/www/certbot
chown -R vfl:vfl /opt/vfl /var/lib/vfl
chmod 750 /var/lib/vfl/backups

echo "==> Database + /etc/vfl/env"
if [ ! -f /etc/vfl/env ]; then
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=')"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vfl') THEN
    CREATE ROLE vfl LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE vfl PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'vocal_for_local'" | grep -q 1 \
    || sudo -u postgres createdb -O vfl vocal_for_local
  cat > /etc/vfl/env <<ENV
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://vfl:${DB_PASSWORD}@127.0.0.1:5432/vocal_for_local
PUBLIC_URL=https://sonsari.in
APP_ORIGINS=https://sonsari.in,https://www.sonsari.in
PLATFORM_HOSTS=sonsari.in,www.sonsari.in
UPLOAD_DIR=/var/lib/vfl/uploads
# Login OTPs are emailed to OTP_EMAIL_TO until an SMS gateway exists (Deployment.md §B14).
# Fill SMTP_USER / SMTP_PASS (Gmail App Password) before the first deploy — the API refuses to start without them.
OTP_PROVIDER=email
OTP_EMAIL_TO=creativebunnyofficial@gmail.com
OTP_HELP_WHATSAPP=919353095481
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Vocal For Local OTP <creativebunnyofficial@gmail.com>"
ENV
  chown root:vfl /etc/vfl/env
  chmod 640 /etc/vfl/env
  echo "    Created /etc/vfl/env (database password generated and stored there)."
else
  echo "    /etc/vfl/env already exists — left unchanged."
fi

echo
echo "Done. Next: clone the repo into /opt/vfl/app as the vfl user (see Deployment.md §4)."
