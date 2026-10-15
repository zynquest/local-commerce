#!/usr/bin/env bash
# Quick health report:  sudo /opt/vfl/app/deploy/healthcheck.sh
ok() { printf '  \e[32m✓\e[0m %s\n' "$1"; }
bad() { printf '  \e[31m✗\e[0m %s\n' "$1"; FAIL=1; }
FAIL=0
curl -fsS http://127.0.0.1:4000/api/health >/dev/null && ok "API (Node) responding" || bad "API not responding — journalctl -u vfl-api -n 50"
systemctl is-active --quiet vfl-api && ok "vfl-api service active" || bad "vfl-api service not active"
pg_isready -q -h 127.0.0.1 && ok "PostgreSQL accepting connections" || bad "PostgreSQL down — systemctl status postgresql"
systemctl is-active --quiet nginx && ok "Nginx active" || bad "Nginx down — nginx -t; systemctl status nginx"
curl -fsS -o /dev/null https://sonsari.in/api/health && ok "https://sonsari.in reachable" || bad "Public HTTPS check failed"
DISK=$(df / --output=pcent | tail -1 | tr -dc 0-9); [ "$DISK" -lt 85 ] && ok "Disk ${DISK}% used" || bad "Disk ${DISK}% used"
MEM=$(free -m | awk '/Mem:/ {printf "%d", $3*100/$2}'); ok "Memory ${MEM}% used (swap: $(free -m | awk '/Swap:/ {print $3}') MB)"
CERT=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/sonsari.in/fullchain.pem 2>/dev/null | cut -d= -f2)
[ -n "$CERT" ] && ok "TLS certificate valid until $CERT" || bad "No TLS certificate found"
exit $FAIL
