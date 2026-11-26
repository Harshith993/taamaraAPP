# Progress tracker

Updated at the end of every working session. Status: ✅ done · 🔄 in progress · ⏳ waiting on owner · ⬜ not started

| Phase | Status | Notes |
|---|---|---|
| 1. Requirements analysis | ✅ | v1.1 approved by the owners on 17 Nov. 8 non-blocking questions remain open (section 3), each answered before its phase. |
| 2. System architecture | ✅ | v1.1 approved on 17 Nov: stack, access model, matrix, schema outline, AWS Mumbai hosting, media pipeline. |
| 3. UI/UX planning | ✅ | Direction C in the lotus palette. 9 screens on the canvas: owner home, design language, crew Today, booking workspace, supervisor event day (night mode), crew proof upload, vendor job, manager home (desktop), owner money (desktop). Screen map for every role in `docs/design/SITEMAP.md`. The owner asked to continue without waiting for approval (18 Nov). |
| 4. Database | ✅ | Prisma 7 schema (72 tables), 9 migrations with database-level protections (append-only audit log, payment ledger rules, fixed issued invoices, proof one-parent rule), reference + demo seed, 42 database tests. |
| 5. Authentication & authorization | ✅ | Better Auth (phone or email + password, DB sessions, rate limits, forced first password), policy layer with scoped filters, team & role management for owners, sign-in/home/team/roles screens, vendor and crew homes. 77 automated tests + 23-check browser smoke test. |
| 6. Core operations (incl. vendor portal, crew app) | ✅ | Everything in the roadmap row is built: booking workspace (overview, functions, schedule/run sheet, needs, vendors, crew, tasks, proof, documents, money), calendar, vendor directory, quote → approval → work order, vendor portal (jobs, quotes, proof, invoices, payments, own profile and bank details), crew roster and hiring, attendance, crew app (Today, proof, tasks, pay, Me), night-mode Event day, photo/video proof with review, notifications. |
| 7. Finance | ✅ | Vendor invoices checked by the accountant; vendor and crew payments (prepare → owner approves → mark paid; void with reason); bank changes held until a confirmation call; client charges and receipts (with TDS kept back by the client); crew extras; expenses with receipts; budgets; Money tab and Money page; monthly P&L by financial year with Excel; settling a booking (checklist, owner settles and the database locks its money; owner reopens with a reason); client GST invoices built behind an owner switch, **off** until open question 2 is answered (D38); exports: P&L, sales register, purchase register, payments, expenses, crew pay. Not built: credit notes, server-side invoice PDFs. |
| 8. Communication & notifications | ✅ | Notifications with a bell for every login; booking team chat, vendor threads and crew chats with photos/PDFs and live updates (Server-Sent Events, D41); announcements with "Got it" (D42); reminders: shift tomorrow, overdue tasks, approvals waiting, unanswered crew offers (D43); delivery outbox with an in-app driver (D44). Web push and SES email drivers wait for Phase 10 credentials. |
| 9. Testing & security | 🔄 | Done: nonce-based Content-Security-Policy (D45); every service action tested as seven kinds of login, which found and fixed four access gaps (D46); upload hardening (photo pixel limit, ffmpeg reads only the local file, 5 GB a day per person). Next: load test of a busy day with many video uploads, backup-restore drill, dependency audit, a review of rate limits on the API. |
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
| D23 | 18 Nov 2026 | Uploads go to our own server in 4 MB pieces that resume after a dropped connection, then into storage (local disk now, S3 Mumbai in Phase 10). Simpler than browser-to-S3 multipart, identical in development and production, and stays under the Next.js proxy's 10 MB request buffer. Revisit if busy days strain the server. | Technical decision |
| D24 | 18 Nov 2026 | Every file is served through a signed link made for one signed-in person, expiring in 20–30 minutes; nothing in storage is public. The file type is read from the file's bytes, never its name. | Technical decision |
| D25 | 18 Nov 2026 | Photos and videos are processed on the app server right after upload (one video at a time, so the app stays responsive); anything a restart interrupts resumes on startup. Moves to pg-boss jobs in Phase 8. Location and other metadata are removed from the copies people view; the original is kept. | Technical decision |
| D26 | 18 Nov 2026 | Open question 4 (attendance) answered as "both, owners choose": supervisors and managers always mark attendance; crew self check-in with location is an owner switch, off by default. Marking opens 6 h before reporting time and closes 18 h after; more than 15 min late counts as late. | Assumption, owners can change in Settings |
| D27 | 18 Nov 2026 | Nobody but an owner approves their own proof or signs off their own task. | Technical decision |
| D28 | 18 Nov 2026 | Owners control five switches on a Settings page: crew see their pay (Q5, default on), crew self check-in (Q4, off), proof from the gallery (on), longest proof video (120 s), vendor's final payment needs approved proof (on). Every change is audited. | Technical decision |
| D29 | 18 Nov 2026 | Vendor invoices can't add up to more than the work order; disputed and void invoices don't count; invoices are checked by people with "prepare payments" (accountant, owners). | Technical decision |
| D30 | 18 Nov 2026 | iPhone HEIC photos are converted to JPEG on the phone before upload; the server's image tools can't read HEIC, so one that slips through is refused with a clear message. | Technical decision |
| D31 | 18 Nov 2026 | Crew extras and deductions are asked for by the booking's manager or supervisor and decided by an owner; only approved ones change what the crew member is owed. | Technical decision |
| D32 | 18 Nov 2026 | Vendor payments are prepared against a checked invoice; advances paid before an invoice still count towards what the vendor has been paid. A payment can't exceed what is left on the invoice (or what crew are owed), counting payments already waiting. | Technical decision |
| D33 | 18 Nov 2026 | "Margin before tax" on screens is what the client is charged before GST minus vendor costs (as quoted, GST included) and crew pay. It is a planning figure, not the accounts; GST credits and overheads are for the outside accountant. | Assumption, owners to confirm |
| D34 | 18 Nov 2026 | Expenses above ₹500 need a bill or receipt attached; smaller ones (tea, auto fare) may go without. Owners can't approve their own expense while the other owner is active. | Assumption, owners to confirm the amount |
| D35 | 18 Nov 2026 | When a vendor changes their own bank details, owners and the accountant are told and no payment can be prepared until someone calls the vendor on their usual number and confirms. Guards against payment-redirection fraud. | Technical decision |
| D36 | 18 Nov 2026 | Settling a booking: only an owner settles, once the booking is completed, the client has paid everything billed (with GST), every booked vendor's work is signed off, invoiced, checked and paid, all crew are paid with no extras waiting, and no payments, expenses, quotes or budgets are waiting. Settling stores the final figures and locks the booking's money in the database (no charges, payments, expenses, crew extras, invoices, budgets, vendor jobs or crew). An owner can reopen it with a reason (audited). The accountant sees the checklist; managers see only that it is settled. | Confirmed by the host (19 Nov): the host and co-host settle bookings |
| D37 | 18 Nov 2026 | Monthly P&L: a booking's billing, costs and margin count in the month of its first day; money received and paid out count by payment date; approved expenses not tied to a booking are "office expenses" in the month spent. Financial years run April to March. Crew marked no-show are not counted as a cost (they can't be paid). | Assumption, owners to confirm |
| D38 | 18 Nov 2026 | Client GST invoices are built but **off by default** (owner switch in Settings) until open question 2 is answered. When on, owners and the accountant draft invoices from a booking's client charges (a charge can be split, e.g. advance and balance, but never billed twice), then issue them: a gap-free number per financial year (`TT-26-27-0001`, prefix set in Settings, 16 characters at most), dates never going backwards, CGST + SGST within Rajasthan and IGST otherwise. Place of supply is the client's GSTIN state, else the client's state, else Rajasthan. The company's and client's details are frozen on the invoice when issued. Issued invoices can only be cancelled with a reason (database triggers); credit notes are not built yet. Invoices are printed from the browser (save as PDF); no server PDF yet. GSTINs are checked with their check character. Managers never see invoices (D11). | Assumption, owners to confirm (open question 2) |
| D39 | 18 Nov 2026 | When a client deducts income tax at source (TDS) from a payment, the accountant records the TDS with the receipt. It counts towards what the client owes (so a booking can be settled) but not as cash received. | Technical decision |
| D40 | 18 Nov 2026 | Chat is attached to bookings: a team chat (managers and supervisors on it; owners can join any), one thread per vendor per booking (the team and that vendor's logins), and one crew chat per booking (the team and its crew). Access is worked out from the booking each time, so someone taken off a booking loses access at once. People get one notification when a conversation has something new for them, not one per message. Messages can be removed by their sender for 15 minutes. Photos and PDFs can be attached. The accountant has no chats (matrix: "own" direct threads only). | Technical decision |
| D41 | 18 Nov 2026 | Live updates use Server-Sent Events from our own server with an in-process event bus (one server, D5), with a 30-second refresh as a fallback. Moving to several servers would swap the bus for Postgres LISTEN/NOTIFY. | Technical decision |
| D42 | 18 Nov 2026 | Announcements: owners send to all staff, all crew or all vendors; managers and supervisors send to their booking's team, crew or vendors. "Got it" is optional per announcement; senders see who hasn't confirmed, and waiting ones show at the top of each person's home screen. | Technical decision |
| D43 | 18 Nov 2026 | Reminders run inside the app server every 10 minutes (no pg-boss yet; every job is safe to run twice): crew get "tomorrow: report by…" once per shift, people with overdue tasks once a day, owners one daily digest when approvals have waited 12 hours, crew who haven't answered an offer for a day once. Nothing is sent between 21:00 and 08:00 India time. | Assumption, owners to confirm times |
| D44 | 18 Nov 2026 | Notifications are delivered through an outbox: rows are written with the change that caused them, then a loop hands them to the drivers each person has on (in-app now; web push and SES email are drivers for Phase 10, push on and email off by default). | Technical decision |
| D45 | 18 Nov 2026 | Content-Security-Policy with a fresh nonce on every request: scripts run only with the nonce ('strict-dynamic'); nothing loads from other sites; no framing. Styles allow inline because department colours are set as style attributes. Every page is rendered per request so it gets its nonce. | Technical decision |
| D46 | 18 Nov 2026 | A permission test runs every service action as seven kinds of login and fails the build if a new action isn't listed. It found and fixed three gaps: a manager not on a booking could read its cost totals (booking Money summary), its crew-picker list, and its vendor invoices by id; and vendor or crew logins could open the staff booking header. | Technical decision |
| D47 | 19 Nov 2026 | The two people with full access are called **Host** (founder) and **Co-host** (co-founder) everywhere in the app, instead of "owner". Both have the same full access. Inside the code and database the role key stays `OWNER`; each person's title (Host or Co-host) is set on the Team page. In these documents, "owner" means the host and co-host. | Requested by the host |
| D48 | 19 Nov 2026 | New look, "Daylight" (design language v2): pure white, pastel rainbow from the lotus, soft rounded cards with drop shadows, liquid-glass header, Space Grotesk and Geist, Lucide icons, hover animations, moving arrows, sparkles, no skeleton loaders. Replaces the Cue Sheet look of D18; Event day keeps its dark night mode. Login, host home (a row of feature cards with live counts), Money, the booking workspace and the crew and vendor phone screens were reworked; every other screen follows through the shared components. | Requested by the host |
| D13 | 17 Nov 2026 | Vendors and crew upload photo/video proof of completed work; managers or supervisors approve it; videos are processed with ffmpeg and stored in S3 Mumbai (G17) | Requested by owner; limits are open question 10 |

## What was built on 18 Nov (owner away; review afterwards)

All of this is on the branch `claude/gallant-dirac-mw3e53`, one commit per piece, each with tests.

| Area | What it does | Where |
|---|---|---|
| Vendor screens browser check | Quote request → GST quote on a phone → owner approval → work order → accept → start → done → sign-off, clicked through by four people. Found and fixed: after "We've started" the "Work is done" button didn't appear until a reload. | `tests/e2e/vendor-flow.cjs` |
| File storage and uploads | Local-disk storage behind an interface (S3 Mumbai later), resumable 4 MB pieces, file type read from the bytes, size limits, signed per-person links, video byte ranges. | `src/lib/storage/`, `src/modules/files/`, `/api/v1/uploads`, `/api/v1/files` |
| Media processing | Photos: upright, 1600 px copy, thumbnail, metadata removed. Videos: length checked, thumbnail, H.264 MP4 without location. | `src/modules/files/processing.ts` |
| Work proof | Vendors and crew take a photo or record a video, add a note and their location; the booking's manager or supervisor approves or asks to redo. Proof page and a Proof tab on each booking. | `/proof`, `src/modules/proof/` |
| Crew | Hire from the Crew tab (pay, reporting time and place per function; days off refused, double bookings warned); crew accept or decline on their phone; new crew Today screen with check-in, proof, tasks, pay and shared plans. | `src/modules/crew/`, `/crew` |
| Attendance | Present / Late / Absent per shift on the booking or on Event day; optional self check-in with location. | `src/modules/crew/service.ts` |
| Tasks | Tasks for the team or crew; tasks that need a photo can't be done without one; sign off or send back with a note. | `src/modules/tasks/` |
| Event day | Night mode for dark venues: next cue, crew in, vendors due, proof to check, run sheet with a now marker and ticks, check-in board, tasks, the team's numbers. | `/event-day` |
| Planning | Owners choose the team and can cancel a booking; managers edit details and functions; run sheet editor; requirements ("Needs") linked to vendors. | `src/modules/events/planning.ts` |
| Vendors and crew directories | Search and filter; add and edit (tax and bank details only for owners and the accountant, bank numbers encrypted); profiles with jobs, attendance and days off. | `/vendors`, `/roster` |
| Documents | Per booking, each document for owners only, the booking team, all staff, or shared with chosen vendors and/or the crew. | Docs tab, `src/modules/documents/` |
| Calendar | The month's functions on a grid (iPad, desktop) or a day list (phone). | `/calendar` |
| Vendor invoices | Vendor sends an invoice against the work order; the accountant verifies, asks to correct or voids. | `/invoices` |
| Payments and client money | Prepare → owner approves → mark paid, void with a reason; client charges and receipts; crew extras; Money tab per booking; Money page. | `/money`, Money tab, `src/modules/finance/` |
| Expenses | Managers and supervisors record spends with a bill photo; owners approve; money from someone's own pocket is repaid and recorded. | `/expenses` |
| Exports | Excel for the outside accountant: purchase register with GSTIN and GST, payments in and out, expenses, crew pay. | Money page |
| Budgets | Estimate vs actual per kind of cost on each booking; drafted by the manager, approved by an owner, new versions for changes. | Money tab |
| Vendor and crew self-service | Vendors keep their contact, GST and bank details (bank changes held for a confirmation call) and see payments per job; crew have a Me page for days off, pay history and password. | `/vendor/profile`, `/crew/me` |
| Notifications | A bell with the unread count for every login, and a list; tapping one opens what it is about. | `src/components/notifications.tsx` |
| Settling a booking | Checklist of what's still open (client paid with GST, vendors signed off, invoiced and paid, crew paid, nothing waiting); an owner settles it and its money is locked in the database; an owner can reopen it with a reason. | Money tab, `src/modules/finance/settlement.ts` |
| Monthly P&L | Month by month for the financial year: bookings by their first day (billed, costs, margin), office expenses, cash received and paid out by date; Excel download. | Money page, `src/modules/finance/pnl.ts` |
| Client GST invoices (switched off) | Company GST details in Settings; bill-to details per booking; drafts from client charges; issue with a gap-free number, CGST+SGST or IGST; printable tax invoice; cancel with a reason; sales register. Off until the owners answer open question 2. | Money tab, `/invoices/client/[id]`, `src/modules/finance/client-invoices.ts` |
| Messages | Team chat per booking, a thread per vendor, a crew chat per booking; photos and PDFs; live updates; unread counts in every header. | `/messages`, `/vendor/messages`, `/crew/messages`, `src/modules/communication/chat.ts` |
| Announcements | To everyone (owners) or a booking's team, crew or vendors; optional "Got it" with who hasn't confirmed; waiting ones on home screens. | Messages page, `src/modules/communication/announcements.ts` |
| Reminders | Shift tomorrow, overdue tasks, approvals waiting, unanswered crew offers; quiet at night. | `src/modules/reminders/` |
| Security | Content-Security-Policy with a nonce per request; every action tested as every kind of login; upload limits. | `src/proxy.ts`, `tests/access/every-action.test.ts` |
| Settings | Owner switches: crew see their pay, crew self check-in, proof from the gallery, video length, proof before a vendor's final payment. | `/settings` |

Tests: 338 automated tests in 27 files (`npm test`) and 19 browser check scripts with 230+ checks, run against a production build on a fresh demo database: `smoke` 23, `bookings` 9, `approvals`, `vendor-flow` 15, `proof` 12, `crew-day` 13, `invoices` 8, `planning` 8, `directory` 10, `docs-calendar` 9, `notifications` 6, `finance` 12, `expenses` 5, `self-service` 5, `budget` 4, `settlement` 13, `client-invoices` 18, `messages` 13, `security` 8. Run each with `node tests/e2e/<name>.cjs <screenshot-folder>` while the app runs on :3000 with the demo seed.

Dependency audit (26 Nov, `npm audit --omit=dev`): 3 high and 2 moderate, from two sources. `effect` comes in through Prisma's own config tooling (`@prisma/config`), used when running migrations rather than serving pages; fix by upgrading Prisma when a patched release is out. `uuid` comes in through `exceljs`; the flaw needs uuid v3/v5/v6 with a caller-supplied buffer, which the export code doesn't use. The suggested `npm audit fix --force` would downgrade exceljs to 3.4.0 (breaking), so it was not applied. Check again before Phase 10.

Known: the attendance step of `crew-day` only passes when run between 06:00 India time and the next morning, because marking opens 6 hours before the seeded shift (12:00); run at 01:30 it fails for that reason only. The `pg` driver prints a deprecation warning from inside Prisma's own query engine during some transactions. Our own code no longer overlaps queries in transactions (`inSequence`). Check Prisma's adapter before upgrading to `pg` 9.

## Next up

1. Owners: review the 18 Nov work and confirm D26 (attendance), D28 (switch defaults), D33 (margin), D34 (receipt amount), D37 (monthly P&L basis), D38 (client invoices) and D43 (reminder times); answer open questions 2 (client GST invoices and TDS), 3, 6, 7, 8, 9; create the AWS account in the company's name for Phase 10.
2. Phase 9: load test of a busy event day with many video uploads, backup-restore drill, dependency audit, rate limits on the API.
3. If client invoices are switched on: credit notes, and a server-made PDF to send to clients.
4. Phase 10: AWS Mumbai deployment, S3 storage driver, web push (VAPID) and SES email drivers for the delivery outbox, pg-boss if one server is no longer enough.

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

Uploaded files go to `./data/storage` (set `STORAGE_DIR` to change it). Video processing needs `ffmpeg` and `ffprobe` on the PATH (`apt-get install ffmpeg`); photos use `sharp`, which `npm install` brings.

Demo sign-ins (development only): host `98000 00001`, co-host `98000 00002`, event manager `priya@demo.taamara.in`, accountant `accounts@demo.taamara.in`, supervisor `98000 00006`, vendor (Roshni Lights) `98110 00005`, crew (Sunil) `99220 00002`.
