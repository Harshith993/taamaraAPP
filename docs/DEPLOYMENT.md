# Deployment: AWS Mumbai (Phase 10)

Everything in this guide is ready except the AWS account itself, which the hosts are creating in the
company's name. Each step says who does it. "Hosts" means the host or co-host; "us" means whoever sets
up the servers.

The plan (ARCHITECTURE.md §7, D5): one server in **AWS Mumbai (ap-south-1)** running the app, PostgreSQL
and Caddy (automatic HTTPS) with Docker Compose; uploaded files in a private **S3** bucket in Mumbai;
nightly database backups to a second S3 bucket; notification email through **SES** in Mumbai; web push
from the app itself. No business data is stored outside India.

## What is in the repository

| File | What it does |
|---|---|
| `deploy/Dockerfile` | The app image: Node 22, ffmpeg, the PostgreSQL 16 client. Runs migrations, then the app. |
| `deploy/docker-compose.yml` | The app, PostgreSQL 16 and Caddy, with named volumes for the database, uploads and certificates. |
| `deploy/Caddyfile` | HTTPS for `APP_DOMAIN`, 12 MB request limit, live updates passed straight through. |
| `deploy/env.production.example` | Every setting the server needs. Copied to `deploy/.env` and filled in on the server (never committed). |
| `deploy/iam-policy.json` | The only AWS permissions the server gets: its two buckets and sending email from one address. |
| `deploy/backup-to-s3.sh` | The nightly backup (cron): `scripts/backup.sh` inside the app, then upload to the backup bucket. |
| `scripts/create-host.ts` | Creates the first Host on the empty database and prints a temporary password. |

The image is being built and run end to end on a test machine (27 Nov 2026; see the log at the end).

## 1. The AWS account (hosts)

1. Create the AWS account in the company's name, with the company's email and card. Turn on MFA for the
   root user and don't use the root user day to day.
2. Create one IAM user (or IAM Identity Center user) for us with admin rights, also with MFA, and share
   its sign-in privately. We switch it off after go-live; the server itself runs on a role.
3. Set a monthly **budget alert** (Billing → Budgets) at about US $50, to the hosts' email.

## 2. The domain (hosts, with us)

Decide the address, for example `app.taamara.in`. In the domain's DNS, add an **A record** for it pointing
at the server's Elastic IP (step 3). For email, SES gives three DKIM CNAME records and we add an SPF
record; both go in the same DNS.

## 3. AWS resources (us), all in ap-south-1 Mumbai

1. **S3 bucket `taamara-files`**: block all public access (on by default), default encryption SSE-S3,
   **versioning on**, lifecycle: move objects older than 180 days to Standard-IA, delete
   non-current versions after 30 days. No CORS: files are always served through the app's signed links.
2. **S3 bucket `taamara-backups`**: block all public access, SSE-S3, versioning on, lifecycle: delete
   objects after 30 days.
3. **IAM role `taamara-app`** for EC2, with `deploy/iam-policy.json` as its only policy (bucket names and
   the From address as above).
4. **EC2** (or Lightsail) instance: Ubuntu 24.04, 2 vCPU / 4 GB to start (t3.medium; the load test D51
   used 4 CPUs comfortably), 60 GB gp3 disk, the `taamara-app` role, an **Elastic IP**. Security group:
   80 and 443 from anywhere, 22 only from the hosts' office IP (or use SSM Session Manager and close 22).
5. **SES**: verify the domain (DKIM), then ask AWS to move SES out of the sandbox (a short form) so it can
   email any address.
6. Turn on automatic security updates on the server (`unattended-upgrades`, on by default in Ubuntu).

## 4. First start (us)

```bash
# On the server
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 awscli git
sudo usermod -aG docker ubuntu && newgrp docker
sudo git clone https://github.com/Harshith993/taamaraAPP /srv/taamara && sudo chown -R ubuntu /srv/taamara
cd /srv/taamara/deploy
cp env.production.example .env && chmod 600 .env
#   fill in .env: APP_DOMAIN, POSTGRES_PASSWORD, BETTER_AUTH_SECRET, FIELD_ENCRYPTION_KEY
#   (openssl rand -base64 32 for each), VAPID keys (npx web-push generate-vapid-keys), bucket names
docker compose up -d --build                      # builds the image, migrates the database, starts
docker compose exec app sh -c 'SEED_DEMO=false npm run db:seed'                 # roles and lists, no demo data
docker compose exec app npx tsx scripts/create-host.ts "Host's name" 98xxxxxxxx Host
docker compose exec app npx tsx scripts/create-host.ts "Co-host's name" 98xxxxxxxx Co-host   # refused: add the co-host on the Team page instead
```

Then the host signs in with their mobile number and the temporary password, sets their own password,
and adds the co-host and the team on the Team page.

**Keep `FIELD_ENCRYPTION_KEY` safe outside the server** (for example in the hosts' password manager).
Vendor and crew bank details are encrypted with it; without it a restored backup can't read them.

## 5. Backups (us)

```bash
crontab -e
15 2 * * *  /srv/taamara/deploy/backup-to-s3.sh >> /var/log/taamara-backup.log 2>&1
```

Every night at 02:15 the database is dumped, checked into a manifest (OPERATIONS.md) and copied to
`s3://taamara-backups/<date>/`, with a week also kept on the server. Uploaded files are protected by
versioning in `taamara-files`.

**Repeat the restore drill on the real server** (OPERATIONS.md, "Restoring") within the first week, and
write it in the drill log.

## 6. Checks before the pilot (us, then hosts)

1. `https://APP_DOMAIN/login` loads with a valid certificate; `http://` redirects to `https://`.
2. Run the browser checks against the server: `E2E_BASE_URL=https://APP_DOMAIN node tests/e2e/security.cjs`
   (on a copy with demo data, never the live database).
3. Upload a photo and a video as a crew member and see them in S3 (`aws s3 ls s3://taamara-files/proof/`).
4. Turn on "Notifications on this device" on a phone and get a test notification; send one email.
5. Repeat the load test (OPERATIONS.md) against the server.
6. The hosts run one small booking end to end (D60).

## Updating the app later

```bash
cd /srv/taamara && git pull && cd deploy && docker compose up -d --build
```

Migrations run on start. A backup runs first if the update changes the database
(`./backup-to-s3.sh`).

## Test log

| Date | Where | What was checked |
|---|---|---|
| 27 Nov 2026 | Test machine (Docker 29, Compose v5) | Image builds; `docker compose up` starts PostgreSQL, migrates, starts the app and Caddy; reference seed and `create-host.ts`; sign-in over HTTPS through Caddy (local certificate); `scripts/backup.sh` inside the app container with the PostgreSQL 16 client. S3 and SES were tested against a local S3 server and a mocked SES (tests/files/s3-storage.test.ts, tests/email-driver.test.ts) until the account exists. |
