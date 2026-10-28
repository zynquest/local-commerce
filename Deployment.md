# Vocal For Local — Deployment Guide

This guide has two parts:

- **Part A — Local development** on your Mac.
- **Part B — Production on Google Cloud.** One free-tier VM runs **Nginx + Node.js + PostgreSQL** natively (no Docker, no Cloudflare). Code is deployed from **GitHub** with `git pull` and served at **https://sonsari.in** (domain at GoDaddy).

---

# Part A — Local development

## A1. Prerequisites (macOS)

- **Node.js 20+:** `brew install node@20`
- **Docker Desktop**, used only for the local Postgres. Start it once so `docker info` works.
- **Google Cloud CLI**, used for SSH to the VM: `brew install --cask google-cloud-sdk`

## A2. Run the app

```bash
cd ~/workspace/local-commerce
cp .env.example .env          # local settings (DB on localhost:5433)
npm install
npm run db:up                 # Postgres 16 in Docker
npm run db:seed               # optional demo store → owner mobile 9000000001
npm run admin:create          # the single platform admin (prompts for a strong password)
npm run dev                   # API on :4000, PWA on http://localhost:5173
```

| URL | What |
|---|---|
| http://localhost:5173 | Landing page and store directory |
| http://localhost:5173/register | Register a store |
| http://localhost:5173/merchant | Store owner dashboard |
| http://localhost:5173/admin/login | Platform admin |
| http://localhost:5173/s/demo | Demo storefront |

## A3. Tests

```bash
npm test                      # API integration tests against the local Postgres
```

## A4. Production build locally (optional)

```bash
npm run build                 # builds client/dist
npm start                     # Node serves API + PWA + SEO-rendered HTML on http://localhost:4000
curl -s http://localhost:4000/s/demo | grep '<title>'
```

`npm start` uses your `.env`. With `NODE_ENV=production`, cookies become `Secure` and logins won't stick over plain http, so use `npm run dev` for normal work.

---

# Part B — Production on GCP

## B0. Architecture and cost

```
                      ┌─────────────────────────────────────────────────┐
                      │   GCP Compute Engine — e2-micro (Always Free)   │
                      │   Ubuntu 24.04 · 30 GB standard disk · 2 GB swap │
 Shoppers ──HTTPS──►  │                                                 │
 (sonsari.in →        │   Nginx :80/:443  (Let's Encrypt TLS, gzip)     │
  static IPv4)        │     ├─ /assets/*, icons    → client/dist         │
                      │     ├─ /uploads/*          → /var/lib/vfl/uploads│
                      │     ├─ /api/*              → Node :4000          │
                      │     └─ all other pages     → Node :4000 (SEO HTML)│
                      │                                                 │
                      │   Node.js 20  (systemd: vfl-api, user "vfl")     │
                      │     Express API · runs DB migrations on start   │
                      │                                                 │
                      │   PostgreSQL 16  (localhost only)               │
                      └─────────────────────────────────────────────────┘
        GitHub ──git pull──► /opt/vfl/app        nightly backups ──► /var/lib/vfl/backups (+ optional GCS)
```

| Item | Choice | Monthly cost |
|---|---|---|
| VM | 1 × `e2-micro` in `us-central1`, `us-east1` or `us-west1` | **Free** (Always Free) |
| Disk | 30 GB **`pd-standard`** (the default `pd-balanced` is *not* free) | **Free** |
| Outbound data | **Standard network tier**: first 200 GiB/month free (Premium tier only gives 1 GB) | **Free** at normal traffic |
| Public IPv4 (static) | Required so visitors can reach the VM without a proxy | **≈ $3.65 (≈ ₹310)**. Google charges $0.005/hour for an external IPv4, even on the free e2-micro. |
| TLS certificate | Let's Encrypt via Certbot | Free |
| Backups (optional) | Cloud Storage bucket in the same US region, ≤ 5 GB | Free |
| Domain | `sonsari.in` at GoDaddy | Your renewal only |

**The only charge is the IPv4 address, about ₹310/month.** There's no way around it without a proxy such as Cloudflare. New Google Cloud accounts get **$300 of free-trial credit for 90 days**, which covers it at first. Set the budget alert in B3 regardless.

**Things to know:**
- **Speed:** the free VMs exist only in US regions, so pages take about 250 ms longer to respond from India. The PWA caches the app on phones after the first visit.
- **Capacity:** an e2-micro (2 shared vCPUs, 1 GB RAM) comfortably runs many small stores. In tests, Node and Postgres used about 50 MB at idle.

---

## B1. Prerequisites

- A Google Cloud account with billing enabled. Free-tier use still needs a billing account with a card.
- The `gcloud` CLI (A1), authenticated:

  ```bash
  gcloud auth login
  ```

- A GitHub account; a **private** repository is recommended.
- Access to the GoDaddy DNS settings for `sonsari.in`.

---

## B2. Push the code to GitHub

On your Mac:

```bash
cd ~/workspace/local-commerce
git init -b main
git status --ignored | head -40     # check: .env, node_modules/, server/uploads/, client/dist/ are ignored
git add -A
git commit -m "Vocal For Local: initial commit"
```

1. Create an **empty** repository on GitHub (no README), e.g. `vocal-for-local`.
2. Push to it:

   ```bash
   git remote add origin git@github.com:<your-github-user>/vocal-for-local.git
   git push -u origin main
   ```

**Never commit `.env` or anything from `/etc/vfl/env`.** The repository's `.gitignore` already excludes `.env`, `server/uploads`, `client/dist` and `deploy/env.production`.

---

## B3. GCP project, APIs and budget alert

```bash
gcloud projects create vfl-sonsari --name="Vocal For Local"     # any globally unique ID
gcloud config set project vfl-sonsari
```

1. Link billing to the project:
   - Open https://console.cloud.google.com/billing/linkedaccount?project=vfl-sonsari.
   - Choose your billing account and click **Set account**.
2. Enable Compute Engine:

   ```bash
   gcloud services enable compute.googleapis.com
   ```

3. Create a budget alert:
   - Go to **Billing → Budgets & alerts → Create budget**.
   - Scope it to project `vfl-sonsari`.
   - Set the amount to **₹500**, with alerts at 50%, 90% and 100%.
   - Expected spend is about ₹310/month (the IPv4 address); anything more means something isn't free.

---

## B4. Static IP, firewall and the free VM

```bash
REGION=us-central1
ZONE=us-central1-a

# 1. Reserve a static IPv4 on the STANDARD network tier (200 GiB/month free egress)
gcloud compute addresses create vfl-ip --region=$REGION --network-tier=STANDARD
gcloud compute addresses describe vfl-ip --region=$REGION --format='get(address)'
#    → note this IP (e.g. 34.1.2.3) — it goes into GoDaddy DNS

# 2. Firewall: HTTP + HTTPS from anywhere (the default network already allows SSH on 22)
gcloud compute firewall-rules create vfl-allow-http  --network=default --direction=INGRESS --allow=tcp:80  --target-tags=http-server
gcloud compute firewall-rules create vfl-allow-https --network=default --direction=INGRESS --allow=tcp:443 --target-tags=https-server

# 3. The VM — every flag below matters for staying in the free tier
gcloud compute instances create vfl-vm \
  --zone=$ZONE \
  --machine-type=e2-micro \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --network-tier=STANDARD --address=vfl-ip \
  --scopes=storage-rw,logging-write,monitoring-write \
  --tags=http-server,https-server
```

**Free-tier rules:**
- `e2-micro` in `us-central1`, `us-east1` or `us-west1`
- `pd-standard` disk of at most 30 GB
- only **one** such VM per billing account

**Optional SSH hardening:** the `default-allow-ssh` rule allows port 22 from anywhere. To accept SSH only through Google's IAP proxy, restrict it and then add `--tunnel-through-iap` to every `gcloud compute ssh` / `scp` command:

```bash
gcloud services enable iap.googleapis.com
gcloud compute firewall-rules update default-allow-ssh --source-ranges=35.235.240.0/20
```

---

## B5. Point sonsari.in at the VM (GoDaddy DNS)

1. In GoDaddy, go to **My Products → Domains → sonsari.in → DNS**.
2. **Nameservers** should be GoDaddy's ("Default"). If you switched them to Cloudflare earlier, choose **Change Nameservers → GoDaddy Nameservers (recommended)**.
3. Under **DNS Records**:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | `A` | `@` | *your static IP from B4* | 600 seconds |
   | `CNAME` | `www` | `sonsari.in` | 1 hour |

   - Delete any other `A` record on `@` (GoDaddy's "Parked" record) and any `AAAA` records.
   - Turn off **Forwarding** if it's on.
   - Keep `MX`/`TXT` records if you use email on this domain.
4. Wait until both names resolve to your IP. Certbot (B9) needs this.

   ```bash
   dig +short sonsari.in
   dig +short www.sonsari.in
   ```

   Usually this takes minutes; occasionally up to an hour.

---

## B6. Bootstrap the VM

From your Mac, in the project folder:

```bash
gcloud compute scp --zone=$ZONE deploy/setup-vm.sh vfl-vm:~/
gcloud compute ssh --zone=$ZONE vfl-vm
# ── now on the VM ──
sudo bash setup-vm.sh
```

What `setup-vm.sh` does (safe to re-run):
- adds a **2 GB swap** file (needed for `npm ci` and the build on 1 GB RAM);
- installs Git, **Nginx**, **Certbot**, **PostgreSQL 16** and **Node.js 20**, and turns on automatic security updates. It works on Ubuntu 24.04/22.04 and Debian 12/11; if the OS doesn't ship PostgreSQL 16, it adds PostgreSQL's official apt repository;
- tunes Postgres for 1 GB RAM and makes it listen on `localhost` only;
- creates the system user **`vfl`** and these directories:
  - `/opt/vfl` — the code
  - `/var/lib/vfl/uploads` — product photos
  - `/var/lib/vfl/backups`
- creates the database `vocal_for_local`, owned by role `vfl`, with a **generated password**;
- writes **`/etc/vfl/env`** (mode 640, `root:vfl`):

```bash
sudo cat /etc/vfl/env
# NODE_ENV=production
# PORT=4000
# DATABASE_URL=postgres://vfl:<generated>@127.0.0.1:5432/vocal_for_local
# PUBLIC_URL=https://sonsari.in
# APP_ORIGINS=https://sonsari.in,https://www.sonsari.in
# PLATFORM_HOSTS=sonsari.in,www.sonsari.in
# UPLOAD_DIR=/var/lib/vfl/uploads
# OTP_PROVIDER=email
# OTP_EMAIL_TO=creativebunnyofficial@gmail.com
# OTP_HELP_WHATSAPP=919353095481
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=465
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM="Vocal For Local OTP <creativebunnyofficial@gmail.com>"
```

Save the database password from `DATABASE_URL` in your password manager.

**Before the first deploy, fill in `SMTP_USER` and `SMTP_PASS`** (see [B14](#b14-login-otps-email-relay-whatsapp-or-sms-via-fast2sms)). The API refuses to start in production without them:

```bash
sudo nano /etc/vfl/env
```

---

## B7. Clone the repository from GitHub

The code lives in `/opt/vfl/app`, owned by the `vfl` user.

**Private repository (recommended): read-only deploy key**

```bash
sudo -u vfl mkdir -p -m 700 /opt/vfl/.ssh
sudo -u vfl -H ssh-keygen -t ed25519 -N "" -f /opt/vfl/.ssh/id_ed25519 -C "vfl-vm deploy key"
sudo -u vfl -H bash -c 'ssh-keyscan github.com >> ~/.ssh/known_hosts'
sudo cat /opt/vfl/.ssh/id_ed25519.pub
```

1. In GitHub, open **your repository → Settings → Deploy keys → Add deploy key**.
2. Paste the public key and leave **Allow write access unticked**.
3. Clone:

   ```bash
   sudo -u vfl -H git clone git@github.com:<your-github-user>/vocal-for-local.git /opt/vfl/app
   ```

**Public repository**

```bash
sudo -u vfl -H git clone https://github.com/<your-github-user>/vocal-for-local.git /opt/vfl/app
```

---

## B8. First deploy (Node + database)

```bash
sudo /opt/vfl/app/deploy/deploy.sh
```

The deploy script:
1. runs `git pull`;
2. runs `npm ci` for the client and server;
3. builds the PWA into `client/dist`;
4. sets `/opt/vfl` to `711` and checks that Nginx (`www-data`) can read `client/dist`. If it can't, the deploy stops instead of putting live a page whose CSS and JS return 404 ([fix](#unstyled-page-cssjs-404));
5. installs the **systemd** unit `vfl-api` (`deploy/systemd/vfl-api.service`), restarts it, and waits for `/api/health`.

The API applies **database migrations automatically on start**. The first run takes about 2 minutes on the e2-micro.

```bash
sudo systemctl status vfl-api --no-pager
curl -s http://127.0.0.1:4000/api/health          # {"ok":true}
sudo journalctl -u vfl-api -n 20 --no-pager        # "[db] applied 001_init.sql" … "[api] listening on http://localhost:4000"
```

The service runs as user `vfl` with a read-only filesystem, except for `/var/lib/vfl`. It restarts automatically if it crashes or the VM reboots.

**File permissions:** `/opt/vfl` is the home folder of the `vfl` user. It must be `drwx--x--x` (711): other users, including Nginx, can pass through to `app/client/dist` but can't list the folder, and the deploy key in `/opt/vfl/.ssh` stays private. Check it:

```bash
sudo namei -l /opt/vfl/app/client/dist/index.html      # vfl line: drwx--x--x vfl vfl vfl
sudo -u www-data test -r /opt/vfl/app/client/dist/index.html && echo "nginx can read the build"
```

---

## B9. Nginx + HTTPS (Let's Encrypt)

Certificates are issued with Certbot's **webroot** method, so the Nginx config stays exactly as committed in `deploy/nginx/`.

```bash
# 1. Temporary HTTP-only config (serves the ACME challenge, proxies the rest to Node)
sudo cp /opt/vfl/app/deploy/nginx/sonsari.in.bootstrap.conf /etc/nginx/sites-available/sonsari.in
sudo ln -sf /etc/nginx/sites-available/sonsari.in /etc/nginx/sites-enabled/sonsari.in
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://sonsari.in | head -1               # HTTP/1.1 200 OK (from the VM)

# 2. Certificate for both names; Nginx reloads automatically on every renewal
sudo certbot certonly --webroot -w /var/www/certbot \
  -d sonsari.in -d www.sonsari.in \
  --agree-tos -m you@example.com --no-eff-email \
  --deploy-hook "systemctl reload nginx"

# 3. Final config: HTTPS, http→https and www→apex redirects, static files, caching, gzip
sudo cp /opt/vfl/app/deploy/nginx/sonsari.in.conf /etc/nginx/sites-available/sonsari.in
sudo nginx -t && sudo systemctl reload nginx

# 4. Renewals run automatically (certbot.timer); check it works
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

Check the result:

```bash
curl -sI http://sonsari.in | grep -i location         # → https://sonsari.in/
curl -sI https://www.sonsari.in | grep -i location    # → https://sonsari.in/
curl -s https://sonsari.in/api/health                 # {"ok":true}
curl -s https://sonsari.in/s/demo | grep '<title>'    # SEO-rendered title (once a store exists)
```

From now on, `deploy.sh` also re-installs `deploy/nginx/sonsari.in.conf` and reloads Nginx on every deploy. Commit any Nginx changes to the repository.

**What Nginx does:**

| Path | Served by | Cache |
|---|---|---|
| `/assets/*` (hashed JS/CSS) | Nginx from `client/dist` | 1 year, immutable |
| `/uploads/*` (product/store photos) | Nginx from `/var/lib/vfl/uploads` | 1 year, immutable |
| `/sw.js`, `/manifest.webmanifest` | Nginx | `no-cache`, so app updates roll out |
| `/api/*` | → Node :4000 | none |
| every other page (`/`, `/stores`, `/s/…`) | → Node, which adds per-page SEO tags, then the SPA takes over | `no-cache` |

Uploads are limited to 10 MB in Nginx; the app limits photos to 8 MB and resizes them to WebP.

---

## B10. Create the platform admin and the first store

There is no UI or API for creating an admin, and the database allows only one.

`/opt/vfl` is the private home folder of the `vfl` service user, so your own login can't `cd` into it. Run app commands **as `vfl`**, as below. To browse the code, use `sudo -iu vfl`, which opens a shell as `vfl` in `/opt/vfl`; `exit` returns to your own user.

```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/admin.js create'
# Username: 8–32 characters, not "admin".
# Password (hidden): 16+ characters with upper, lower, digit and symbol; no common words; must not contain the username.
```

Then:
1. Sign in at **https://sonsari.in/admin/login**. This URL isn't linked from any page, and sessions expire after 12 hours.
2. Register a store at **https://sonsari.in/register**, add products and submit it for review.
3. Approve it in `/admin`. Only approved stores are public.

To rotate the admin password (this signs the admin out everywhere), run the same command with `reset-password` instead of `create`.

### Demo stores (optional)

Eight ready-made demo businesses (all in Bengaluru) show visitors how the platform works. The home page's "Built for every local business" cards link to them:

| Business | Link | Catalog |
|---|---|---|
| Shree Shivam Groceries | `/s/demo` | 19 |
| Hari Bhari Sabzi Mandi (vegetables & fruits) | `/s/demo-vegetables` | 12 |
| Malligai Flower Stall | `/s/demo-flowers` | 12 |
| Sri Ganesh Electricals | `/s/demo-electricals` | 12 |
| Iyengar Fresh Bakery | `/s/demo-bakery` | 11 |
| Annapoorna Family Restaurant (pure-veg food delivery) | `/s/demo-restaurant` | 19 |
| Glow Hair & Beauty Studio (appointments) | `/s/demo-salon` | 8 services, 3 specialists |
| SmileCare Dental & Physio Clinic (appointments) | `/s/demo-clinic` | 6 services, 2 specialists |

Create them (deploy this version first, so the `is_demo` migration exists). It's safe to re-run:

```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/demo-stores.js create'
```

What makes them different from real stores:
- They're **approved and orderable**, but every order goes to the platform WhatsApp (`OTP_HELP_WHATSAPP`, +91 93530 95481).
- Each one shows a **"Demo store"** notice and a **Demo** badge, and the directory lists them **after** real stores.
- They're **`noindex`** and **not in the sitemap**, so made-up shops never compete with real merchants in Google.
- The owners have **no mobile**, so nobody can log in to them. To edit one in the dashboard, attach your number (one store per mobile):
  ```bash
  sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/owner.js set-phone demo-bakery <10-digit mobile>'
  ```

Remove them all once you have enough real stores. This deletes their products, orders and images:

```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/demo-stores.js remove --yes'
```

---

## B11. Deploying code changes

On your Mac:

```bash
git add -A && git commit -m "…" && git push
```

On the VM:

```bash
gcloud compute ssh --zone=$ZONE vfl-vm
sudo /opt/vfl/app/deploy/deploy.sh        # git pull → npm ci → build → restart → health check → reload nginx
```

The same command covers backend changes, frontend changes, new npm packages, schema migrations and Nginx config changes. A deploy restarts the API, which takes 2–3 seconds; Nginx keeps serving static files during the restart.

Phones that already have the app cached (the service worker precaches the shell) open the **previous** build once more after a deploy, then the app notices the new build and reloads itself (unless the person is typing, in which case it reloads when they leave the field or the tab). Installed apps also check for updates every hour. If someone reports "Unknown API route" right after a deploy, a reload fixes it.

| What changed | What to do |
|---|---|
| Any code (client, server, migrations) | `git push` → `sudo /opt/vfl/app/deploy/deploy.sh` |
| Nginx config (`deploy/nginx/sonsari.in.conf`) | Commit → `deploy.sh` (it runs `nginx -t` before reloading) |
| Environment variables | `sudo nano /etc/vfl/env` → `sudo systemctl restart vfl-api` |
| Deploy a different branch | `sudo BRANCH=release /opt/vfl/app/deploy/deploy.sh` |
| Roll back | `sudo -u vfl git -C /opt/vfl/app checkout <commit>` → re-run the build/restart steps from `deploy.sh`, or revert on GitHub and deploy |

### Everyday commands (on the VM)

```bash
sudo journalctl -u vfl-api -f                    # live API logs
sudo systemctl restart vfl-api                   # restart API
sudo systemctl status vfl-api nginx postgresql --no-pager
sudo -u postgres psql vocal_for_local            # database shell
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
sudo /opt/vfl/app/deploy/healthcheck.sh          # one-shot health report
free -m; df -h /                                 # memory / disk
```

### Platform-admin tasks

Everything happens in the console at **/admin**:
- **Approval queue:** approve, or reject with remarks. The owner sees the remarks, fixes the issues and resubmits.
- **Live stores:** suspend with a reason, or reinstate.
- **Plans:** Free is 50 products; Paid is 50 or more, with a limit you set per store.
- **Message owner:** opens WhatsApp to the owner's registered mobile.

---

## B12. Backups

```bash
# Nightly at 02:30 IST (21:00 UTC); keeps 7 days in /var/lib/vfl/backups (root-only)
( sudo crontab -l 2>/dev/null; echo '0 21 * * * /opt/vfl/app/deploy/backup.sh >> /var/log/vfl-backup.log 2>&1' ) | sudo crontab -
sudo /opt/vfl/app/deploy/backup.sh                # run once now
sudo ls -la /var/lib/vfl/backups
```

Each run saves a Postgres dump (`vfl-*.dump`) and the product photos (`uploads-*.tgz`).

**Off-VM copy (recommended; free up to 5 GB in the same region):**

```bash
gcloud storage buckets create gs://vfl-sonsari-backups --location=us-central1 --uniform-bucket-level-access
```

Then:
1. Edit the crontab (`sudo crontab -e`) so the job sets the bucket:

   ```
   0 21 * * * BACKUP_BUCKET=gs://vfl-sonsari-backups /opt/vfl/app/deploy/backup.sh >> /var/log/vfl-backup.log 2>&1
   ```

2. Optionally, delete copies older than 14 days automatically:

   ```bash
   echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}' > /tmp/lc.json
   gcloud storage buckets update gs://vfl-sonsari-backups --lifecycle-file=/tmp/lc.json
   ```

**Restore:**

```bash
sudo systemctl stop vfl-api
sudo -u postgres pg_restore --clean --if-exists -d vocal_for_local /var/lib/vfl/backups/vfl-YYYYMMDD-HHMM.dump
sudo tar xzf /var/lib/vfl/backups/uploads-YYYYMMDD-HHMM.tgz -C /var/lib/vfl && sudo chown -R vfl:vfl /var/lib/vfl/uploads
sudo systemctl start vfl-api
```

To copy a backup to your Mac:

```bash
gcloud compute scp --zone=$ZONE vfl-vm:/var/lib/vfl/backups/<file> .
```

The file is root-only, so on the VM first run `sudo cp` to your home directory and `sudo chown` it to yourself.

---

## B13. Health monitoring

```bash
sudo /opt/vfl/app/deploy/healthcheck.sh
```

It checks the API, the `vfl-api` service, Postgres, Nginx, public HTTPS, disk use, memory and the certificate expiry date. It exits with status 1 if anything fails.

Run it every 5 minutes and log failures:

```bash
( sudo crontab -l; echo '*/5 * * * * /opt/vfl/app/deploy/healthcheck.sh >/dev/null || echo "$(date -Is) HEALTHCHECK FAILED" >> /var/log/vfl-health.log' ) | sudo crontab -
```

**Optional external check:** in Cloud Console, go to **Monitoring → Uptime checks → Create**, for HTTPS `sonsari.in` path `/api/health`, and add an email alert. Check Cloud Monitoring pricing for the current free allowance.

---

## B14. Login OTPs (email relay, WhatsApp, or SMS via Fast2SMS)

Store owners sign up and log in with their **email address** by default (`OWNER_LOGIN=email`): one screen for both, a 6-digit code is emailed to them, and a new email is asked for the store name. They give the WhatsApp number for orders when they **submit the store for approval**, and the app opens a pre-filled WhatsApp message to the platform number from that phone; approving the store marks that number verified (it also becomes the owner's verified mobile). Owners who registered by mobile earlier can be given an email with `npm run owner:set-email -- <store-link> <email>` (on the VM: `node src/cli/owner.js set-email …`). `OWNER_LOGIN=mobile` brings back mobile + OTP for owners, including OTP-verified WhatsApp-number changes. Shoppers (optional accounts, for order history) use one flow for sign-in and sign-up: they enter their **email address** (`CUSTOMER_LOGIN=email`, the default) and always receive a 6-digit code, emailed directly through the Gmail SMTP settings below whatever `OTP_PROVIDER` is set to; once the code is verified an existing account is signed in, otherwise they're asked for a name and the account is created. Set `CUSTOMER_LOGIN=mobile` to have shoppers use a 10-digit mobile number instead, with codes delivered by `OTP_PROVIDER` exactly like owners' codes (do this once SMS is live). There are no passwords; only the platform admin has one.

If shopper emails don't arrive, send a test message from the VM with the same settings and read the SMTP reply:

```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/mail.js you@example.com'
```

Then check the API log for the failure reason: `sudo journalctl -u vfl-api -n 50 --no-pager | grep otp`. Gmail-to-Gmail mail usually lands in the inbox; mail to other providers may land in spam until the sending address has some history.

**Temporary setup (free tier, no SMS gateway yet), `OTP_PROVIDER=email`:**
1. A merchant enters their mobile and taps **Send verification code**.
2. The code is emailed to `OTP_EMAIL_TO` (creativebunnyofficial@gmail.com). The subject is `OTP 123456 · +91 98765 43210 · Store owner login`, and the email has a one-tap **WhatsApp this code** link to that mobile.
3. The app tells the merchant: *"Free tier: we don't send SMS yet. WhatsApp +91 93530 95481 from your number and our team will reply with your code."* The app's WhatsApp button pre-fills that message.
4. When their WhatsApp arrives, open the matching email and send them the code (the link in the email does this). Codes expire after 10 minutes.

**Gmail SMTP setup (one time):**
1. On the Google account that sends the mail, turn on **2-Step Verification**.
2. Go to <https://myaccount.google.com/apppasswords> and create an App Password named `vfl`. Copy the 16-character password.
3. Edit `/etc/vfl/env` with `sudo nano /etc/vfl/env`:
   ```bash
   SMTP_USER=<sending gmail address>
   SMTP_PASS=<16-char app password, no spaces>
   SMTP_FROM="Vocal For Local OTP <sending gmail address>"
   OTP_EMAIL_TO=creativebunnyofficial@gmail.com   # inbox you watch
   ```
4. Run `sudo systemctl restart vfl-api`, then check the log: `sudo journalctl -u vfl-api -n 20 --no-pager` should show `[otp] provider: email`.

GCP blocks outbound port 25 only, so SMTP on 465 (or 587 with `SMTP_PORT=587 SMTP_SECURE=false`) works from the VM.

**Real SMS with Fast2SMS, `OTP_PROVIDER=sms`:**

Fast2SMS's *OTP route* sends `Your OTP: 123456` from Fast2SMS's own DLT-registered template and sender ID, so you do **not** need your own TRAI DLT registration (entity, header and template approval). It is prepaid and charged per SMS: Fast2SMS advertised about ₹0.11 per OTP with a ₹100 minimum top-up in 2026, so ₹100 covers several hundred logins. Check the current price on <https://www.fast2sms.com/otp-sms/> before topping up. There is no free tier; the free alternative is `whatsapp_reply` ([B20](#b20-whatsapp-otp-with-metas-cloud-api-optional)).

1. Sign up at <https://www.fast2sms.com> with your mobile number, complete their KYC if asked, and add balance from the **Wallet**.
2. Open **Dev API** in the left menu and copy the **API Authorization Key**. Test it once from your laptop (the OTP route sends to any Indian mobile; the API accepts a 10-digit number):
   ```bash
   curl -s -H "authorization: <API KEY>" -H "Content-Type: application/json" -d '{"route":"otp","variables_values":"123456","numbers":"98xxxxxxxx"}' https://www.fast2sms.com/dev/bulkV2
   ```
   A working key answers `{"return":true,...}`; `{"return":false,"status_code":412,...}` means a wrong key and other 4xx codes usually mean no balance.
3. Edit `/etc/vfl/env` with `sudo nano /etc/vfl/env`:
   ```bash
   OTP_PROVIDER=sms
   FAST2SMS_API_KEY=<API KEY>
   ```
4. Run `sudo systemctl restart vfl-api`, then check `sudo journalctl -u vfl-api -n 20 --no-pager` for `[otp] provider: sms`. The API refuses to start with `OTP_PROVIDER=sms` and no key.
5. Log in once with your own mobile. The app stops showing the "WhatsApp us for your code" box automatically (`/api/config` reports `otpDelivery: "sms"`) and tells the user the code was sent by SMS.

Delivery failures (no balance, Fast2SMS outage) are logged as `[otp] delivery failed (sms): Fast2SMS <code>: <message>` and the user sees "Could not send the code right now". Switching back to `email` or `whatsapp_reply` is the same env change plus a restart. The code lives in `server/src/otp/fast2sms.js`.

**Existing owners without a mobile** (for example, accounts created before OTP login) can't log in until you attach one:

```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/owner.js set-phone <username|store-link> <10-digit mobile>'
```

---

## B15. SEO launch checklist

**What the server provides for every page** (`server/src/seo.js`; React then takes over):

| Page | Indexed | Languages | Structured data (JSON-LD) |
|---|---|---|---|
| `/` | yes | 23 URLs (`/?lang=hi` …) with `hreflang` + `x-default` | `Organization` (with WhatsApp contact), `WebSite`, `SoftwareApplication` (Free/Paid offers), `FAQPage` |
| `/stores` | yes | 23 URLs with `hreflang` | `ItemList` of approved stores, `BreadcrumbList` |
| `/register` | yes | 23 URLs with `hreflang` | `BreadcrumbList` |
| `/s/<store>` | approved stores only | one canonical URL. `?lang=` variants point to it, because the content is the merchant's own. | `Store` (address, hours, phone, catalog), `BreadcrumbList` |
| `/s/<store>/p/<item>` | approved stores only | one canonical URL | `Product` + `Offer` (price, stock), `BreadcrumbList` |
| `/login`, `/merchant`, `/admin`, `/account`, unknown URLs | no (`noindex`; unknown URLs return 404) | — | — |

Each page also gets a server-rendered HTML snapshot of its content, Open Graph/Twitter tags, `/sitemap.xml` (all of the above, with `hreflang` alternates) and `/robots.txt`.

**Link previews:** WhatsApp/Facebook previews use a JPEG copy of the store banner or product photo, which is saved next to each WebP upload. After deploying this version, create copies for photos uploaded before it, once:
```bash
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/share-images.js'
```

### Launch day
1. **Check the live site**:
   ```bash
   curl -sI https://sonsari.in/ | head -1                      # HTTP/2 200
   curl -sI http://www.sonsari.in/ | grep -i location           # → https://sonsari.in/
   curl -s https://sonsari.in/robots.txt
   curl -s https://sonsari.in/sitemap.xml | head -5
   curl -s https://sonsari.in/register | grep -o '<link rel="canonical"[^>]*>'   # https://sonsari.in/register
   ```
   Every canonical URL must start with `https://sonsari.in` (from `PUBLIC_URL` in `/etc/vfl/env`).
2. **Google Search Console** (https://search.google.com/search-console):
   - Add the **Domain** property `sonsari.in` and verify it with Google's `TXT` record in **GoDaddy → DNS → Add → TXT, Name `@`**. This covers http/https/www.
   - Alternative: the *URL-prefix* property with an HTML tag. Put the `content="…"` value in `/etc/vfl/env` as `GOOGLE_SITE_VERIFICATION=…`, then run `sudo systemctl restart vfl-api`.
   - **Sitemaps** → submit `https://sonsari.in/sitemap.xml`.
   - **URL inspection** → request indexing for `/`, `/register`, `/stores` and your first approved store.
3. **Bing Webmaster Tools** (https://www.bing.com/webmasters): *Import from Google Search Console*, or verify with `BING_SITE_VERIFICATION=…`. Bing also feeds DuckDuckGo and ChatGPT search.
4. **Validate structured data** at https://search.google.com/test/rich-results with `/`, a store URL and a product URL. Expect *Breadcrumbs*, *FAQ*, *Product snippets* / *Merchant listings* and *Local business*. Warnings about optional fields (brand, shipping, returns) are fine.
5. **Preview a link** by pasting a store link into WhatsApp. It should show the store name and banner. To refresh a cached Facebook/WhatsApp preview, use https://developers.facebook.com/tools/debug/.

### First weeks
- **Approve real stores with a city, address, store type, a description and photos.** Store pages rank for "<category> in <city>" and "<store name>". Empty stores don't rank.
- **Google Business Profile:** create one for the platform, and ask every merchant to add their `sonsari.in/s/<store>` link as the *Website* on their own profile. This is the biggest lever for local "near me" searches.
- **Backlinks:** share store links on WhatsApp groups, Instagram bios, local directories (Justdial, IndiaMART) and local news/community pages.
- Check Search Console weekly for **Pages → Not indexed** and **Enhancements**.
- Broad phrases ("free online store", "free business tools") take weeks to months and need content and backlinks. Code alone can't guarantee the top spot.

---

## B16. Custom domains for merchants (Paid plan)

When a merchant's own domain (e.g. `shopname.in`) should show their store:
1. They add an `A` record from `shopname.in` (and `www`) to your static IP.
2. Set the domain on their store:

   ```bash
   sudo -u postgres psql vocal_for_local -c \
     "UPDATE stores SET plan='paid', custom_domain='shopname.in', updated_at=now() WHERE slug='their-store';"
   ```

3. Don't add the merchant's domain to `PLATFORM_HOSTS`, which lists only your own platform domains. Any host not listed there is looked up as a store's custom domain.
4. Get a certificate and add a server block:

   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d shopname.in -d www.shopname.in --deploy-hook "systemctl reload nginx"
   ```

   - Copy the `sonsari.in` HTTPS server block in `deploy/nginx/sonsari.in.conf` into a new file, `deploy/nginx/shopname.in.conf`.
   - Change its `server_name` and certificate paths.
   - Add the domain to the port-80 block's `server_name` so challenges keep working.
   - Commit, then run `sudo cp deploy/nginx/shopname.in.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`.

   Node serves that store at the domain root, with no platform branding.

---

## B17. Troubleshooting

| Symptom | Check | Fix |
|---|---|---|
| `deploy.sh`: API did not become healthy | `sudo journalctl -u vfl-api -n 50` | Usually a typo in `/etc/vfl/env`, or Postgres is down (`sudo systemctl start postgresql`) |
| 502 Bad Gateway | `curl -s 127.0.0.1:4000/api/health` | `sudo systemctl restart vfl-api` |
| Page shows plain unstyled text; console shows 404 for `/assets/*.js`, `.css`, `manifest.webmanifest` | `sudo -u www-data test -r /opt/vfl/app/client/dist/index.html && echo ok` | Nginx can't read the build. See [Unstyled page](#unstyled-page-cssjs-404) below |
| `npm ci` or build killed / very slow | `free -m` | Make sure swap is on (`swapon --show`); re-run `setup-vm.sh` |
| `git pull` asks for a password / permission denied | `sudo -u vfl -H ssh -T git@github.com` | Re-add the deploy key (B7); check `known_hosts` |
| Certbot fails with "unauthorized" / timeout | `dig +short sonsari.in` | DNS must point to the static IP; firewall must allow tcp:80; bootstrap config must be active |
| Browser warns about the certificate | `sudo certbot certificates` | `sudo certbot renew`, then `sudo systemctl reload nginx` |
| Image upload fails (413) | Nginx `client_max_body_size` | It's `10m` in `sonsari.in.conf`; redeploy if you changed it |
| Logins don't stick | Are you on `https://`? | `NODE_ENV=production` sets `Secure` cookies, so http won't keep the session |
| "Too many attempts" for every user | `X-Forwarded-For` in the Nginx proxy blocks | Keep the committed Nginx config (it forwards the real client IP) |
| Store page says not found | Is the store approved? | Approve it in `/admin`; only approved stores are public |
| Disk filling up | `df -h /`, `sudo du -sh /var/lib/vfl/*` | `sudo journalctl --vacuum-size=100M`; check old backups |
| Unexpected charges | **Billing → Reports**, grouped by SKU | See the cost checklist below |

### Unstyled page (CSS/JS 404)

**Symptom:** the site shows plain black-and-white text with no styling. The browser console shows `Failed to load resource: 404` for `/assets/index-….js`, `/assets/index-….css` and `manifest.webmanifest`.

**Cause:** the page text comes from Node (server-side SEO), but CSS, JS and the manifest are served by **Nginx** from `/opt/vfl/app/client/dist`. Nginx runs as `www-data`. `/opt/vfl` is the `vfl` user's home folder, and `useradd` creates it private (`drwxr-x---`, 750), so Nginx can't reach the build and returns 404.

**Diagnose** (use `sudo`; as your own user `namei` stops at the same locked folder):
```bash
sudo namei -l /opt/vfl/app/client/dist/index.html
```
```text
drwxr-xr-x root root /
drwxr-xr-x root root opt
drwxr-x--- vfl  vfl  vfl      ← the problem: no access for others
drwxr-xr-x vfl  vfl  app
...
```

**Fix:**
```bash
sudo chmod 711 /opt/vfl                                  # pass-through only, not listable
sudo namei -l /opt/vfl/app/client/dist/index.html        # vfl line is now drwx--x--x
sudo -u www-data test -r /opt/vfl/app/client/dist/index.html && echo "nginx can read the build"
```
No restart is needed. Hard-refresh the browser (**Cmd+Shift+R** / **Ctrl+Shift+R**).

If the test still fails, a folder deeper in the path is locked too (check the `namei` output). Open the build up for reading:
```bash
sudo chmod -R o+rX /opt/vfl/app/client/dist
```

`setup-vm.sh` and `deploy.sh` now set `711` automatically, and `deploy.sh` stops with the `namei` output if Nginx still can't read the build.

**Related:** for the same reason, `cd /opt/vfl/app/server` as your own user gives *Permission denied*. Run app commands as `vfl` (see [B10](#b10-create-the-platform-admin-and-the-first-store)), or open a shell as it with `sudo -iu vfl`.

---

## B18. Cost checklist

- [ ] VM is `e2-micro` in `us-central1`, `us-east1` or `us-west1`, and it's the only one.
- [ ] Boot disk is **`pd-standard` ≤ 30 GB**.
- [ ] Network tier is **STANDARD** for both the VM and the static IP.
- [ ] Exactly **one** static IP, **attached** to the VM. An unattached reserved IP costs twice as much: `gcloud compute addresses list`.
- [ ] No snapshots, load balancers, Cloud NAT or Cloud SQL.
- [ ] Backup bucket (if any) is in the same US region and under 5 GB.
- [ ] Budget alert is configured; expected spend is about ₹310/month for the IPv4 address.
- [ ] Google Maps (if enabled, [B19](#b19-google-maps-address-search-and-near-me)): key restricted to your domain and the 3 APIs, daily quota caps set.
- [ ] SMS OTPs (if `OTP_PROVIDER=sms`, [B14](#b14-login-otps-email-relay-whatsapp-or-sms-via-fast2sms)): Fast2SMS wallet is prepaid, so the only exposure is the balance you top up. Keep a low-balance alert on in the Fast2SMS panel.

Pricing references:
- https://cloud.google.com/free/docs/free-cloud-features#compute
- https://cloud.google.com/vpc/network-pricing

---

## B19. Google Maps: address search and "near me"

Merchants pick their shop address from **Google Maps search** (India only), or use **"Use my current location"** and drag a pin. Shoppers see only businesses within **5 km** of their location, from GPS or an area search. Without a key, everything still works: merchants type the address and set the pin with their phone's GPS, and shoppers use GPS.

**1. Enable the APIs.** In Cloud Console (same project), go to **APIs & Services → Library** and enable:
- **Maps JavaScript API**
- **Places API (New)**
- **Geocoding API**

Google Maps needs a billing account (the same one as the VM). Each Maps API has a free monthly usage allowance. Check current numbers at https://mapsplatform.google.com/pricing/.

**2. Create a browser key.** Go to **APIs & Services → Credentials → Create credentials → API key**, then **Edit**:
- *Application restrictions* → **Websites**: `https://sonsari.in/*` and `https://www.sonsari.in/*`
- *API restrictions* → **Restrict key** → the 3 APIs above

The key is visible in the browser by design; these restrictions are what protect it. For local testing, use a second key restricted to `http://localhost:5173/*`.

**3. (Recommended) Create a Map ID** for the draggable-pin map: **Google Maps Platform → Map management → Create Map ID** (type *JavaScript*, *Vector*). Without one, the built-in `DEMO_MAP_ID` is used, which is fine for testing.

**4. Cap the spend.** For **APIs & Services → Places API (New) → Quotas**, set a daily limit (e.g. 1,000 requests/day), and do the same for Geocoding. The budget alert from B3 covers the rest.

**5. Configure the VM**:
```bash
sudo nano /etc/vfl/env
# GOOGLE_MAPS_API_KEY=AIza…
# GOOGLE_MAPS_MAP_ID=<your map id>      # optional
# NEARBY_RADIUS_KM=5                    # shoppers see businesses within this distance
sudo systemctl restart vfl-api
```
Check: `curl -s https://sonsari.in/api/config` should show `"mapsKey":"AIza…"` and `"nearbyKm":5`.

**How "near me" works:**
- The store directory and the home page list only approved businesses within the radius, nearest first, with the distance shown.
- Demo stores are always listed, with a Demo label.
- A store's own link (`/s/<store>`) always works, whatever the distance.
- Every business needs a map location before it can be submitted for approval (the checklist shows "Location on the map").

---

## B20. WhatsApp OTP with Meta's Cloud API (optional)

By default login codes are emailed to you and relayed by hand (`OTP_PROVIDER=email`, see B14). Two WhatsApp modes automate this; plain SMS through Fast2SMS is the third option (`OTP_PROVIDER=sms`, [B14](#b14-login-otps-email-relay-whatsapp-or-sms-via-fast2sms)). Switching is just an environment variable, and you can go back to `email` at any time.

| `OTP_PROVIDER` | How it works | Cost (India, 2026) |
|---|---|---|
| `whatsapp_reply` **(recommended, free)** | The user taps **"Open WhatsApp & send"**. WhatsApp opens with a pre-filled message such as *"Hi Vocal For Local, please send my verification code. Request #K7Q2XZ"* to your business number. Our webhook replies immediately with the 6-digit code. | **₹0**: replies inside the 24-hour customer-service window are free. The message also proves the user owns that number. |
| `whatsapp` | The server pushes the code automatically using an approved **Authentication** template (like an SMS). | ≈ ₹0.115 + 18% GST per code (Meta's rate; volume discounts apply). |
| `sms` ([B14](#b14-login-otps-email-relay-whatsapp-or-sms-via-fast2sms)) | Plain SMS *"Your OTP: 123456"* through Fast2SMS's OTP route. No Meta setup, no DLT registration, works on phones without WhatsApp. | ≈ ₹0.11 per SMS, prepaid (₹100 minimum top-up). |
| `msg91_whatsapp` | Same as `whatsapp`, but the WhatsApp number, the Meta onboarding and the template live in the **MSG91** panel and the message goes through MSG91's API. No developer-dashboard, system-user or webhook work; MSG91 support deals with Meta. | Meta's ≈ ₹0.115 + MSG91's margin + 18% GST per code, from the MSG91 wallet. |

The rest is unchanged: 6-digit codes, a 10-minute expiry, 5 attempts, and limits per number. Register and login screens for owners and customers, and the WhatsApp-number change, all use it.

### 1. Set up the WhatsApp Business Platform (one time)
1. **Meta Business portfolio:** create or use one at https://business.facebook.com. **Business verification** (Settings → Security centre) is recommended: it raises messaging limits and lets your display name show.
2. **Create an app** (the 2026 flow uses "use cases", not app types):
   - **Use a personal Facebook login.** The developer dashboard needs a personal Facebook profile that's an admin of your business portfolio (Business Suite → Settings → Users → People → add it with *Full control*). If you sign in with a business-only Meta account, developers.facebook.com redirects to business.facebook.com.
   - Open **https://developers.facebook.com/apps** and register as a developer if asked.
   - **Create app** → enter a name and email → use case **"Connect with customers through WhatsApp"** → pick your business portfolio → **Create app**.
   - On *Customize use case → Connect on WhatsApp → Quickstart*, click **Start using the API**.
   - Alternative start: Business Suite → **Settings → Accounts → Apps → + Add → Create a new app ID**.
3. **Add your number** (*API Setup* → connect or create your WhatsApp Business account → *Add phone number*). You have two options:
   - **Keep using it on your phone (coexistence):** connect your existing **WhatsApp Business app** number (e.g. 93530 95481) through the embedded sign-up. The app and the API then work on the same number, and code-request chats also appear in your app. Coexistence is reported to be available in India since mid-2026; if it isn't offered for your number, use option b.
   - **API only:** register a number that is *not* on any WhatsApp app (or delete it from the app first).
   - Either way, set a display name (e.g. *Sonsari*). Meta reviews it.
4. **Permanent access token:** in Business settings → **Users → System users**, add a system user (Admin). Under *Assign assets*, give it the app and the WhatsApp account. Then *Generate token* with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`, set to **never expire**.
5. **Copy these IDs:**
   - WhatsApp → API Setup → **Phone number ID** (a long number, *not* the phone number)
   - App settings → Basic → **App secret**
6. **Privacy policy:** in App settings → Basic, set:
   - **Privacy Policy URL:** `https://sonsari.in/privacy`
   - **User data deletion URL:** `https://sonsari.in/privacy#data-deletion`

   Then switch **App mode → Live**. The page ships with the app as plain HTML, so Meta's checker can read it.

### 2. Configure the server
```bash
sudo nano /etc/vfl/env
# OTP_PROVIDER=whatsapp_reply            # or: whatsapp (paid template mode)
# CUSTOMER_LOGIN=mobile                  # shoppers too (default "email" keeps shoppers on emailed codes)
# WHATSAPP_PHONE_NUMBER_ID=123456789012345
# WHATSAPP_ACCESS_TOKEN=EAAG…            # system-user token from step 4
# WHATSAPP_APP_SECRET=…                  # from step 5
# WHATSAPP_VERIFY_TOKEN=<any long random string, e.g. from: openssl rand -hex 16>
# WHATSAPP_BUSINESS_NUMBER=919353095481  # the number users message (reply mode)
# WHATSAPP_OTP_TEMPLATE=login_code       # template mode only (step 4 below)
# WHATSAPP_OTP_TEMPLATE_LANG=en          # template mode only
sudo systemctl restart vfl-api
sudo journalctl -u vfl-api -n 5 --no-pager    # "[otp] provider: whatsapp_reply"
```
The API refuses to start if a required WhatsApp setting is missing, and names the missing one.

### 3. Connect the webhook (reply mode)
You can connect the webhook **before** switching `OTP_PROVIDER`. With only `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` set in `/etc/vfl/env` (and `OTP_PROVIDER=email` unchanged), the endpoint answers Meta's verification and ignores messages until you switch to `whatsapp_reply`.

In the app go to **WhatsApp → Configuration → Webhook → Edit**:
- **Callback URL:** `https://sonsari.in/api/whatsapp/webhook`
- **Verify token:** the same `WHATSAPP_VERIFY_TOKEN`

Click **Verify and save**. The server must already be running with the new settings. Then, under **Webhook fields**, subscribe to **messages**.

Webhook calls are checked against the app secret (`X-Hub-Signature-256`); forged calls get 401. Ordinary customer chats on the number are ignored by the server and stay for you to answer.

### 4. Template mode only: create the OTP template
WhatsApp Manager → **Message templates → Create**:
- Category **Authentication**
- Code delivery: **Copy code** button
- Name `login_code`, language English

Optionally add more languages with the same name. Approval is usually quick. Put the name and language in `WHATSAPP_OTP_TEMPLATE` / `WHATSAPP_OTP_TEMPLATE_LANG`.

### MSG91 instead of Meta's dashboard (`OTP_PROVIDER=msg91_whatsapp`)
Skip sections 1–4. In the MSG91 panel: **WhatsApp → Add number** (their wizard runs Meta's embedded signup; the number must not be on a WhatsApp app, or use the "connect WhatsApp Business app" option if offered), then **WhatsApp → Templates → Create** with category **Authentication**, language English, the **Copy code** button, named e.g. `login_code`. Note the number, the template name and, if shown, its namespace; create an auth key under **Settings → API Keys**. Then in `/etc/vfl/env`:
```bash
OTP_PROVIDER=msg91_whatsapp
CUSTOMER_LOGIN=mobile                 # shoppers get WhatsApp codes too; leave "email" to keep emailed codes
MSG91_AUTH_KEY=<auth key>
MSG91_WHATSAPP_NUMBER=91XXXXXXXXXX     # the number connected in the MSG91 panel
MSG91_WHATSAPP_TEMPLATE=login_code
MSG91_WHATSAPP_TEMPLATE_LANG=en
```
Restart and check the log for `[otp] provider: msg91_whatsapp`. Failures are logged as `[otp] delivery failed (whatsapp, <purpose>): MSG91 WhatsApp <status>: <message>` (wrong key, template not approved, account restricted, no balance). The code lives in `server/src/otp/msg91.js`.

### 5. Test it
1. Open https://sonsari.in/register.
2. Enter a mobile that has WhatsApp and tap **Send verification code**, then **Open WhatsApp & send**.
3. Send the pre-filled message. The code should come back within seconds.
4. Shoppers (with `CUSTOMER_LOGIN=mobile`): open https://sonsari.in/account → **Log in or sign up**, enter a mobile, same WhatsApp round trip, then **Continue**. A new number is asked for a name; a known one lands on its orders.
5. If it doesn't, check `sudo journalctl -u vfl-api --since "5 min ago" | grep -i whatsapp`:
   - a `401` means `WHATSAPP_APP_SECRET` is wrong;
   - `WhatsApp API 401/403` means the token or phone number ID is wrong;
   - no log line at all means the webhook isn't subscribed to **messages**.

**Rollback:** set `OTP_PROVIDER=email` and restart.


---

## B21. Seeding local merchants (street onboarding)

Seeded listings let shoppers near a shop find it before the owner signs up, and give the field team a ready store to hand over on a visit: *"Your shop is already listed on Vocal For Local. Log in with your mobile and set your prices."*

**What a seeded listing is**
- `stores.origin = 'seed'` (owner sign-ups are `organic`). It stays `seed` after the hand-over; `claimed_at` records when.
- Approved, with the category's **starter catalog** (indicative Bengaluru prices) and the category logo. No WhatsApp number, so **it cannot take orders** until claimed.
- Shown to shoppers **only within `NEARBY_RADIUS_KM`** (5 km) of their location, after real stores, with a *"Not taking orders yet"* badge. Never in search results without a location, never indexed, not in the sitemap.
- The store page explains it was listed from public information and offers *"Own this shop? Claim it free, or ask us to remove it"* (a WhatsApp message to the platform number).
- The listing's phone from the source is kept for the field team only; it is never shown to shoppers.
- Seeded: grocery/kirana, vegetables and fruits, bakery, sweets, milk and dairy, flowers, hardware and electricals, mobiles and electronics, stationery, restaurants. **Not seeded:** salons, clinics (appointments) and pharmacies.

**Sources**
- **OpenStreetMap** (free, no key): names and locations are good in Bengaluru; phones are rare. The data is © OpenStreetMap contributors (ODbL); OSM-sourced listings show that credit in their footer.
- **Google Places API** (optional, paid): adds phone numbers. Needs a *server* key with "Places API (New)" enabled in `GOOGLE_PLACES_API_KEY` (the browser Maps key won't work). Requests with phones are billed as Nearby Search Enterprise; the tool caps spend with `--max-requests`, caches every response, and prints an estimate before spending. Google's terms limit how long Places content may be stored, so treat it as the field team's visit list and let the owner's own details replace it on hand-over.
- **Your own rows**: any shop you add to the CSV by hand (`source` = `manual`). JustDial and Google Maps pages are not scraped: both forbid it and block automated access.

**Build the list (on your laptop)**
```bash
npm run seed:merchants -- fetch-osm --city bengaluru --out ../data/seed/blr-osm.csv
# optional, costs money: phones from Google Places for one area first, e.g. 3 km around Indiranagar
GOOGLE_PLACES_API_KEY=... npm run seed:merchants -- fetch-places --near 12.9719,77.6412 --radius-km 3 --out ../data/seed/blr-places.csv --max-requests 150 --yes
npm run seed:merchants -- merge --out ../data/seed/blr.csv ../data/seed/blr-osm.csv ../data/seed/blr-places.csv
```
Open `data/seed/blr.csv` in a spreadsheet: delete rows you don't want, fix names, add shops (keep the columns). `data/seed/` is git-ignored.

**Import (on the VM)**
```bash
gcloud compute scp --zone=$ZONE data/seed/blr.csv vfl-vm:/tmp/blr.csv
gcloud compute ssh --zone=$ZONE vfl-vm
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/seed-merchants.js import /tmp/blr.csv --dry-run'
sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/seed-merchants.js import /tmp/blr.csv'
```
Re-importing is safe: the same source row updates its listing (until claimed), a shop already on the platform within 60 m under the same name is skipped, and listings removed on request never come back.

**Field visits**
1. Export a walking list for an area (sorted by locality, with directions and store links):
   ```bash
   sudo -u vfl -H bash -c 'cd /opt/vfl/app/server && set -a && . /etc/vfl/env && set +a && node src/cli/seed-merchants.js export --near 12.9719,77.6412 --radius-km 1.5 --out /tmp/field.csv'
   ```
2. At the shop, open the admin console on your phone → **Seeded (unclaimed)** → search the name → **Hand over to owner** with the owner's mobile.
3. The owner opens sonsari.in/login, enters that mobile and the OTP, and lands in their dashboard with the catalog; they adjust prices and products. Orders now reach their WhatsApp.
4. If the listing already has the owner's mobile, they can also just **register** with it: the OTP proves the number and the listing is handed over automatically, same link, no duplicate store.

**Removal requests:** admin console → the listing → *Remove listing* (the remarks box is the reason), or `seed-merchants.js remove <store-link> --reason "…"`. **Progress:** `seed-merchants.js stats` (by category, claimed, top localities); the admin dashboard shows *Seeded, unclaimed* and *Seeds claimed*.
**Start over:** `seed-merchants.js remove-all --yes` deletes every unclaimed listing (claimed ones stay).

---

## B22. Google Sign-In (owners and shoppers)

Owners and shoppers see Google's icon button on the sign-in screens; *"I don't have a Google account"* opens the email + code form as before. The server verifies Google's ID token itself (signature, audience, issuer, expiry, verified email), so no Google secret is needed: only the public client ID, which defaults to the platform's (`GOOGLE_CLIENT_ID` in `/etc/vfl/env` overrides it; empty turns Google off).

- **New owner** with Google: asked for the store name and type (on /register they're filled first), then the store is created with the Google email as the verified login.
- **New shopper** with Google: the account is created straight away with the Google name.
- Existing accounts with the same email simply sign in, whichever method they used before.

**Google Cloud Console (one time)**, project that owns the client ID:
1. **APIs & Services → OAuth consent screen**: app name (e.g. *Vocal For Local*), support email, app logo optional, authorised domain `sonsari.in`, privacy policy `https://sonsari.in/privacy`. Scopes: just the defaults (`openid`, `email`, `profile`), which need no Google review. Then **Publish app** (status *In production*); in *Testing* only listed test users can sign in.
2. **APIs & Services → Credentials →** the OAuth 2.0 *Web application* client **→ Authorized JavaScript origins**: add `https://sonsari.in`, `https://www.sonsari.in`, and for local development `http://localhost` and `http://localhost:5173`. No redirect URIs are needed (the button uses Google's popup). Changes can take a few minutes to apply.

If the button shows an error or nothing happens, open the browser console: *"The given origin is not allowed for the given client ID"* means step 2 is missing that origin.
