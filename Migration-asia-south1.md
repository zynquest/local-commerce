# Migrating the VM to asia-south1 (Mumbai) on e2-medium, in project vfl-sonsari

This moves production from the free `e2-micro` in `us-central1` (project **`zmoneyplus-506717`**) to an `e2-medium` (2 shared vCPUs, 4 GB RAM) in `asia-south1` (project **`vfl-sonsari`**). Pages should load about 200 ms faster from India.

**Why you need a new VM:** a VM, its disk and its static IP all belong to one region and one project, so none of them can be moved. You build a new VM in Mumbai in `vfl-sonsari`, copy the data across, and point DNS at the new IP. The old VM stays as a fallback until you delete it.

**Downtime:** about 15–30 minutes during the cutover (Phase 2), plus up to 10 minutes while DNS updates (the `A` record TTL is 600 s).

**Cost:** this setup is no longer in the free tier. Approximate monthly cost:

| Item | Approx. cost |
|---|---|
| VM (`e2-medium`) | ≈ $28–30 |
| 30 GB `pd-balanced` disk | ≈ $3–4 |
| Static IPv4 | ≈ $3.65 |

Check the current figures in the [pricing calculator](https://cloud.google.com/products/calculator). A 1-year committed-use discount takes about 37% off the VM.

**Don't delete the `zmoneyplus-506717` project.** It also runs the unrelated `zmoneyplus` VM in `asia-south1-a`. The cleanup in Phase 4 deletes only the VFL resources.

Set these variables in every Mac terminal you use for this migration. Every `gcloud` command below names its project explicitly, so your active `gcloud` configuration doesn't matter:

```bash
OLD_PROJECT=zmoneyplus-506717
OLD_ZONE=us-central1-a
NEW_PROJECT=vfl-sonsari
NEW_REGION=asia-south1
NEW_ZONE=asia-south1-a
BUCKET=gs://vfl-sonsari-backups-in

# The old VM was created with read-only Cloud Storage access, so it can't upload to the bucket itself.
# This runs a backup on the old VM, copies it to the Mac, and uploads it to $BUCKET from there.
push_backup() {
  gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- '
    set -e; sudo /opt/vfl/app/deploy/backup.sh
    S=$(sudo ls -1t /var/lib/vfl/backups | grep "^vfl-.*\.dump$" | head -1 | sed "s/^vfl-//; s/\.dump$//")
    rm -rf ~/mig && mkdir ~/mig
    sudo cp /var/lib/vfl/backups/vfl-$S.dump /var/lib/vfl/backups/uploads-$S.tgz ~/mig/ && sudo chown -R $USER ~/mig && ls -l ~/mig' &&
  rm -rf /tmp/vfl-mig && mkdir -m 700 /tmp/vfl-mig &&
  gcloud compute scp --project=$OLD_PROJECT --zone=$OLD_ZONE 'vfl-vm:~/mig/*' /tmp/vfl-mig/ &&
  gcloud storage cp /tmp/vfl-mig/* $BUCKET/ &&
  rm -rf /tmp/vfl-mig && gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- 'rm -rf ~/mig' &&
  gcloud storage ls -l "$BUCKET/"
}
```

---

## Phase 0: Preparation (a day or more before the cutover)

1. **Link billing to `vfl-sonsari`.** It currently has no billing account.
   - Open https://console.cloud.google.com/billing/linkedaccount?project=vfl-sonsari.
   - Choose your billing account and click **Set account**.
   - Check that it worked: `gcloud billing projects describe $NEW_PROJECT --format='value(billingEnabled)'` should print `True`.
2. **Create a budget alert** scoped to `vfl-sonsari` at about ₹3,500, with alerts at 50%, 90% and 100% (Billing → Budgets & alerts).
3. **Notify merchants who use custom domains (B16).** Their `A` records point at the old IP (`136.115.38.247`), so each one must change them during the cutover. List them:

   ```bash
   gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- \
     "sudo -u postgres psql vocal_for_local -Atc \"SELECT slug, custom_domain FROM stores WHERE custom_domain IS NOT NULL\""
   ```

4. **IP allowlists:** if you allowlisted the server's IP anywhere (for example IP whitelisting in the Fast2SMS panel), add the new IP there in Phase 1. The Google Maps key, Google Sign-In and the Meta WhatsApp API check domains, not IPs, so they need no change.
5. **API keys and OAuth clients stay where they are.** If the Google Maps key or the Google Sign-In client was created in `zmoneyplus-506717`, it keeps working after the move, because the app only uses the key values from `/etc/vfl/env`. Leave those resources in place, or recreate them in `vfl-sonsari` later and update the env file.
6. **Check that the GoDaddy TTL on `@` is 600 seconds.** If it's higher, lower it now and wait out the old TTL before the cutover.

---

## Phase 1: Build the new VM (no downtime)

### 1.1 Enable Compute Engine and the firewall in vfl-sonsari

```bash
gcloud services enable compute.googleapis.com --project=$NEW_PROJECT

# Enabling Compute Engine normally creates the "default" network along with SSH/ICMP rules. Check:
gcloud compute networks list --project=$NEW_PROJECT                    # → default
gcloud compute firewall-rules list --project=$NEW_PROJECT --format='table(name,sourceRanges.list(),allowed[].map().firewall_rule().list())'
```

If `default` is missing, create it, then allow SSH:

```bash
gcloud compute networks create default --project=$NEW_PROJECT --subnet-mode=auto
gcloud compute firewall-rules create default-allow-ssh --project=$NEW_PROJECT --network=default --direction=INGRESS --allow=tcp:22
```

Firewall rules belong to a project and don't carry over from the old one, so create the HTTP and HTTPS rules:

```bash
gcloud compute firewall-rules create vfl-allow-http  --project=$NEW_PROJECT --network=default --direction=INGRESS --allow=tcp:80  --target-tags=http-server
gcloud compute firewall-rules create vfl-allow-https --project=$NEW_PROJECT --network=default --direction=INGRESS --allow=tcp:443 --target-tags=https-server
```

### 1.2 Static IP and VM

```bash
gcloud compute addresses create vfl-ip-in --project=$NEW_PROJECT --region=$NEW_REGION --network-tier=STANDARD
NEW_IP=$(gcloud compute addresses describe vfl-ip-in --project=$NEW_PROJECT --region=$NEW_REGION --format='get(address)'); echo $NEW_IP

gcloud compute instances create vfl-vm-in \
  --project=$NEW_PROJECT \
  --zone=$NEW_ZONE \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --network-tier=STANDARD --address=vfl-ip-in \
  --scopes=storage-rw,logging-write,monitoring-write \
  --tags=http-server,https-server
```

If GCP rejects the `STANDARD` network tier in this region, use `--network-tier=PREMIUM` for both the address and the VM. Premium-tier outbound data costs more per GB.

### 1.3 Backup bucket in Mumbai

```bash
gcloud storage buckets create $BUCKET --project=$NEW_PROJECT --location=$NEW_REGION --uniform-bucket-level-access
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":14}}]}' > /tmp/lc.json
gcloud storage buckets update $BUCKET --lifecycle-file=/tmp/lc.json
```

The old VM can't upload to this bucket because it has read-only Cloud Storage access. `push_backup` (defined with the variables above) uploads from your Mac instead. The new VM's default service account has no roles in `vfl-sonsari`, so after creating the VM (1.2), grant it access to this bucket. It reads the bucket during the restore and uploads the nightly backups afterwards:

```bash
NEW_SA=$(gcloud compute instances describe vfl-vm-in --project=$NEW_PROJECT --zone=$NEW_ZONE --format='value(serviceAccounts[0].email)')
gcloud storage buckets add-iam-policy-binding $BUCKET --member="serviceAccount:$NEW_SA" --role=roles/storage.objectAdmin
```

### 1.4 Bootstrap and tune for 4 GB RAM

```bash
gcloud compute scp --project=$NEW_PROJECT --zone=$NEW_ZONE deploy/setup-vm.sh vfl-vm-in:~/
gcloud compute ssh --project=$NEW_PROJECT --zone=$NEW_ZONE vfl-vm-in
# ── on the new VM ──
sudo bash setup-vm.sh
```

`setup-vm.sh` tunes Postgres for a 1 GB VM. Add a second config file that overrides those values. Postgres reads `conf.d` files in alphabetical order, so `zz-` loads last and wins, and re-running `setup-vm.sh` won't undo it:

```bash
sudo tee /etc/postgresql/16/main/conf.d/zz-e2-medium.conf >/dev/null <<'PG'
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 8MB
maintenance_work_mem = 128MB
max_connections = 40
PG
sudo systemctl restart postgresql
```

The committed systemd unit limits Node to 256 MB of heap. Raise it with a drop-in file. `deploy.sh` reinstalls the unit on every deploy but leaves drop-ins alone:

```bash
sudo mkdir -p /etc/systemd/system/vfl-api.service.d
printf '[Service]\nEnvironment=NODE_OPTIONS=--max-old-space-size=768\n' | sudo tee /etc/systemd/system/vfl-api.service.d/memory.conf
sudo systemctl daemon-reload
```

### 1.5 Clone the repository

Follow **B7** in `Deployment.md` on the new VM. Create a new deploy key and add it in GitHub, or skip the key for a public repository.

### 1.6 Copy secrets, certificates and Nginx sites from the old VM

On the **old** VM, bundle the files:

```bash
gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm
# ── on the old VM ──
sudo tar czf ~/vfl-secrets.tgz -C / etc/vfl/env etc/letsencrypt etc/nginx/sites-available etc/nginx/sites-enabled
sudo crontab -l > ~/root-crontab
sudo chown $USER ~/vfl-secrets.tgz
exit
```

Copy the bundle through your Mac, then delete every copy except the one on the new VM:

```bash
gcloud compute scp --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm:~/vfl-secrets.tgz vfl-vm:~/root-crontab /tmp/
gcloud compute scp --project=$NEW_PROJECT --zone=$NEW_ZONE /tmp/vfl-secrets.tgz /tmp/root-crontab vfl-vm-in:~/
rm /tmp/vfl-secrets.tgz
gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- rm ~/vfl-secrets.tgz
```

On the **new** VM, unpack the bundle and give the database role the password from the old `/etc/vfl/env`, so `DATABASE_URL` works unchanged:

```bash
gcloud compute ssh --project=$NEW_PROJECT --zone=$NEW_ZONE vfl-vm-in
# ── on the new VM ──
sudo tar xzf ~/vfl-secrets.tgz -C / && rm ~/vfl-secrets.tgz
sudo chown root:vfl /etc/vfl/env && sudo chmod 640 /etc/vfl/env
OLDPW=$(sudo sed -n 's#^DATABASE_URL=postgres://vfl:\([^@]*\)@.*#\1#p' /etc/vfl/env)
sudo -u postgres psql -c "ALTER ROLE vfl PASSWORD '$OLDPW'"; unset OLDPW
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The certificates are copied too, so HTTPS works as soon as DNS points at the new VM. You don't have to wait for Certbot. The bundle also carries the certificates and site files of merchant custom domains.

### 1.7 Rehearsal: restore a recent copy and deploy

From your Mac, take a backup on the old VM and upload it to the new bucket. The site stays up while it runs:

```bash
push_backup          # ends by listing vfl-<stamp>.dump and uploads-<stamp>.tgz in the bucket
```

The backup contains customer data. `push_backup` deletes its copies on your Mac and in your home folder on the old VM once the upload succeeds. If it fails partway, delete `/tmp/vfl-mig` on your Mac yourself.

On the **new** VM, restore it and deploy:

```bash
BUCKET=gs://vfl-sonsari-backups-in
D=$(sudo gcloud storage ls "$BUCKET/vfl-*.dump" | sort | tail -1); U=$(dirname "$D")/uploads-$(basename "$D" .dump | sed "s/^vfl-//").tgz
sudo gcloud storage cp "$D" "$U" /var/lib/vfl/backups/
sudo cat /var/lib/vfl/backups/$(basename "$D") | sudo -u postgres pg_restore --clean --if-exists -d vocal_for_local   # postgres can't read the root-only folder
sudo tar xzf /var/lib/vfl/backups/$(basename "$U") -C /var/lib/vfl && sudo chown -R vfl:vfl /var/lib/vfl/uploads
sudo /opt/vfl/app/deploy/deploy.sh
```

From your Mac, test the new VM before DNS changes. `--resolve` sends the request to the new IP under the real hostname:

```bash
curl -s  --resolve sonsari.in:443:$NEW_IP https://sonsari.in/api/health          # {"ok":true}
curl -sI --resolve sonsari.in:443:$NEW_IP https://sonsari.in/ | head -1
```

To click through the whole site against the new VM, temporarily add `<NEW_IP> sonsari.in www.sonsari.in` to `/etc/hosts` on your Mac. Log in, open a store and check that product photos load. Remove the line afterwards.

---

## Phase 2: Cutover (downtime starts)

Pick a quiet hour, for example late night IST.

1. **Stop writes on the old VM:**

   ```bash
   gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- "sudo systemctl stop vfl-api && sudo systemctl disable vfl-api"
   ```

   The old VM now returns 502 for every page except static files.

2. **Take the final backup into the new bucket:**

   ```bash
   push_backup
   ```

3. **Restore it on the new VM:**

   ```bash
   gcloud compute ssh --project=$NEW_PROJECT --zone=$NEW_ZONE vfl-vm-in
   # ── on the new VM ──
   BUCKET=gs://vfl-sonsari-backups-in
   sudo systemctl stop vfl-api
   D=$(sudo gcloud storage ls "$BUCKET/vfl-*.dump" | sort | tail -1); U=$(dirname "$D")/uploads-$(basename "$D" .dump | sed "s/^vfl-//").tgz
   echo "$D"                                                     # must be the timestamp from step 2
   sudo gcloud storage cp "$D" "$U" /var/lib/vfl/backups/
   sudo cat /var/lib/vfl/backups/$(basename "$D") | sudo -u postgres pg_restore --clean --if-exists -d vocal_for_local   # postgres can't read the root-only folder
   sudo rm -rf /var/lib/vfl/uploads && sudo tar xzf /var/lib/vfl/backups/$(basename "$U") -C /var/lib/vfl && sudo chown -R vfl:vfl /var/lib/vfl/uploads
   sudo systemctl start vfl-api && sleep 3 && curl -s http://127.0.0.1:4000/api/health
   ```

4. **Compare row counts.** Run this on both VMs; the numbers must match:

   ```bash
   sudo -u postgres psql vocal_for_local -Atc "SELECT (SELECT count(*) FROM stores), (SELECT count(*) FROM products), (SELECT count(*) FROM orders)"
   ```

   If a table doesn't exist, take it out of the query.

5. **Update DNS in GoDaddy:** change the `A` record for `@` from `136.115.38.247` to `NEW_IP`. Leave the `www` CNAME as it is. Ask each custom-domain merchant to update their `A` records too.

---

## Phase 3: Verify (downtime ends once DNS has updated)

From your Mac:

```bash
dig +short sonsari.in                       # → NEW_IP
curl -s https://sonsari.in/api/health        # {"ok":true}
curl -sI https://www.sonsari.in | grep -i location
```

On the **new** VM:

```bash
sudo /opt/vfl/app/deploy/healthcheck.sh
sudo certbot renew --dry-run                 # only after DNS points here
```

Put the cron jobs back, sending backups to the Mumbai bucket. Review the old crontab first:

```bash
cat ~/root-crontab
( echo '0 21 * * * BACKUP_BUCKET=gs://vfl-sonsari-backups-in /opt/vfl/app/deploy/backup.sh >> /var/log/vfl-backup.log 2>&1'
  echo '*/5 * * * * /opt/vfl/app/deploy/healthcheck.sh >/dev/null || echo "$(date -Is) HEALTHCHECK FAILED" >> /var/log/vfl-health.log' ) | sudo crontab -
sudo crontab -l && rm ~/root-crontab
```

If you had a Cloud Monitoring uptime check in `zmoneyplus-506717`, create it again in `vfl-sonsari` (Monitoring → Uptime checks, HTTPS `sonsari.in`, path `/api/health`) and delete the old one.

From now on, connect to deploy with:

```bash
gcloud compute ssh --project=vfl-sonsari --zone=asia-south1-a vfl-vm-in
```

---

## Rollback (if the new VM misbehaves)

1. In GoDaddy, set the `A` record for `@` back to `136.115.38.247`.
2. Restart the old API:

   ```bash
   gcloud compute ssh --project=$OLD_PROJECT --zone=$OLD_ZONE vfl-vm -- "sudo systemctl enable --now vfl-api"
   ```

Anything written on the new VM after the cutover (orders, signups, photos) is **not** on the old VM. Take a backup on the new VM and restore it on the old one before switching back, or accept that those writes are lost.

---

## Phase 4: Cleanup (after about 7 stable days)

This deletes only the VFL resources in `zmoneyplus-506717`. Leave the `zmoneyplus` VM and the project itself alone.

```bash
gcloud compute instances delete vfl-vm --project=$OLD_PROJECT --zone=$OLD_ZONE
gcloud compute addresses delete vfl-ip --project=$OLD_PROJECT --region=us-central1      # an unattached IP still costs money
gcloud compute firewall-rules delete vfl-allow-http vfl-allow-https --project=$OLD_PROJECT  # first check nothing else in the project uses these tags
gcloud storage buckets remove-iam-policy-binding $BUCKET --role=roles/storage.objectAdmin \
  --member="serviceAccount:754008456964-compute@developer.gserviceaccount.com"     # the grant from the earlier version of 1.3, now unused
gcloud compute instances list --project=$OLD_PROJECT                    # only the zmoneyplus VM should remain
gcloud compute instances list --project=$NEW_PROJECT                    # vfl-vm-in
```

Two more things to update:
- Set the default `gcloud` project to `vfl-sonsari`: `gcloud config set project vfl-sonsari`.
- Update `Deployment.md` to match: B0, B4 and B18 should say `asia-south1` and `e2-medium`, and every `ZONE=` should be `asia-south1-a`.
