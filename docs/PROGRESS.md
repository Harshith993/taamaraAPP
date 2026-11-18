# Progress tracker

Updated at the end of every working session. Status: ✅ done · 🔄 in progress · ⏳ waiting on owner · ⬜ not started

| Phase | Status | Notes |
|---|---|---|
| 1. Requirements analysis | ✅ | v1.1 approved by the owners on 17 Nov. 8 non-blocking questions remain open (section 3), each answered before its phase. |
| 2. System architecture | ✅ | v1.1 approved on 17 Nov: stack, access model, matrix, schema outline, AWS Mumbai hosting, media pipeline. |
| 3. UI/UX planning | ✅ | Direction C in the lotus palette. 9 screens on the canvas: owner home, design language, crew Today, booking workspace, supervisor event day (night mode), crew proof upload, vendor job, manager home (desktop), owner money (desktop). Screen map for every role in `docs/design/SITEMAP.md`. The owner asked to continue without waiting for approval (18 Nov). |
| 4. Database | ✅ | Prisma 7 schema (72 tables), 2 migrations with database-level protections (append-only audit log, payment ledger rules, fixed issued invoices, proof one-parent rule), reference + demo seed, 42 database tests. |
| 5. Authentication & authorization | ✅ | Better Auth (phone or email + password, DB sessions, rate limits, forced first password), policy layer with scoped filters, team & role management for owners, sign-in/home/team/roles screens, vendor and crew homes. 77 automated tests + 23-check browser smoke test. |
| 6. Core operations (incl. vendor portal, crew app) | 🔄 | Started: owners' approvals inbox, then bookings list and booking workspace. |
| 7. Finance | ⬜ | |
| 8. Communication & notifications | ⬜ | |
| 9. Testing & security | ⬜ | |
| 10. Deployment (AWS Mumbai) | ⬜ | Needs an AWS account in the company's name. |

## Decisions log

| # | Date | Decision | Status |
|---|---|---|---|
| D1 | 17 Nov 2026 | Next.js + TypeScript + Tailwind/shadcn + PostgreSQL + Prisma, as a modular monolith | Proposed in v1.0 |
| D2 | 17 Nov 2026 | Three-layer access control: account type, role permissions with scope, record and field filtering on the server | Proposed in v1.0 |
| D3 | 17 Nov 2026 | Financial records are never deleted; corrections are voids or reversals with a reason | Proposed in v1.0 |
| D4 | 17 Nov 2026 | Single business. No multi-company design (owner answer 1) | Decided by owner |
| D5 | 17 Nov 2026 | Hosting Option B: one server plus S3 and SES, all in AWS Mumbai; no services that store business data outside India (owner answer 10) | Decided by owner |
| D6 | 17 Nov 2026 | Roles: Owner (founder and co-founder, equal), Event Manager, Accountant, Supervisor, Vendor, Labour (owner answer 2) | Decided by owner |
| D7 | 17 Nov 2026 | No client logins and no booking/proposal flow; clients are records only (owner answers 3, 5) | Decided by owner |
| D8 | 17 Nov 2026 | A booking has one or more functions (owner answer 4) | Decided by owner |
| D9 | 17 Nov 2026 | Crew are hired directly and paid a fixed amount per event, with approved extras and deductions; English UI (owner answer 6) | Decided by owner |
| D10 | 17 Nov 2026 | Vendors log in to submit quotes and invoices; the vendor portal is core v1 (owner answer 7) | Decided by owner |
| D11 | 17 Nov 2026 | Owners (either one) approve quotes, payments and expenses; managers never see client billing or margin (owner answers 5, 9) | Decided by owner; "either one" is assumption A1 |
| D12 | 17 Nov 2026 | Code and plans live in the private repository `Harshith993/taamaraAPP` | Decided by owner |
| D14 | 17 Nov 2026 | Plan v1.1 approved, with assumptions A1–A4 (either owner approves; managers see costs but not billing; crew extras as approved lines; managers create bookings) | Approved by owners |
| D15 | 17 Nov 2026 | The company and app are **Taamara Taamara** (events & beyond) | Decided by owner (corrected from "Taamara") |
| D19 | 18 Nov 2026 | Owner asked to keep building without stopping for approvals while away; review happens afterwards | Owner instruction |
| D20 | 18 Nov 2026 | Next.js server caching (Cache Components) is off: nearly every screen is per-user and permission-scoped, so nothing is cached on the server | Technical decision |
| D21 | 18 Nov 2026 | Tests rebuild a separate `*_test` database from the migrations on every run; the development database is never reset by tools (Prisma also asks for a person's consent first) | Technical decision |
| D22 | 18 Nov 2026 | Vendor and crew logins can never hold an "every record" scope, even if misconfigured; their widest access is their own records | Technical decision |
| D18 | 17 Nov 2026 | Visual direction C (Cue Sheet), recoloured from the company logo: cream ground, aubergine ink, plum brand, one lotus petal colour per department, lotus-lattice and petal-stripe patterns, and a night mode for event days | Decided by owner |
| D16 | 17 Nov 2026 | Proof defaults: camera or gallery, videos up to 2 minutes, approved proof required before a vendor's final payment | Approved by owners |
| D17 | 17 Nov 2026 | iPad is a first-class device alongside phone and desktop; the UI must be immersive and not look generic | Requested by owner |
| D13 | 17 Nov 2026 | Vendors and crew upload photo/video proof of completed work; managers or supervisors approve it; videos are processed with ffmpeg and stored in S3 Mumbai (G17) | Requested by owner; limits are open question 10 |

## Earlier prototype (superseded)

Before the full brief arrived, a small Express + SQLite prototype was started. It has no screens and does not match the chosen stack. It was moved to `archive/prototype-express-sqlite/` for reference and is not part of the product.

## How to run it locally

```bash
cp .env.example .env          # then put random secrets in BETTER_AUTH_SECRET and FIELD_ENCRYPTION_KEY
npm install
npx prisma migrate deploy     # create the tables
npm run db:seed               # reference data + demo data (demo password: Taamara@2026)
npm run dev                   # http://localhost:3000
npm test                      # automated tests (needs TEST_DATABASE_URL)
```

Demo sign-ins (development only): owner `98000 00001`, co-founder `98000 00002`, event manager `priya@demo.taamara.in`, accountant `accounts@demo.taamara.in`, supervisor `98000 00006`, vendor (Roshni Lights) `98110 00005`, crew (Sunil) `99220 00002`.
