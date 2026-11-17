# Progress tracker

Updated at the end of every working session. Status: ✅ done · 🔄 in progress · ⏳ waiting on owner · ⬜ not started

| Phase | Status | Notes |
|---|---|---|
| 1. Requirements analysis | ⏳ | v1.1 in `ARCHITECTURE.md`: owner's answers plus the photo/video work-proof request (17 Nov). Waiting for approval. 10 non-blocking questions open (section 3). |
| 2. System architecture | ⏳ | v1.1: stack, access model, matrix, schema outline, AWS Mumbai hosting, media pipeline. Waiting for approval. |
| 3. UI/UX planning | ⬜ | Next. Needs the app name and logo (a placeholder is fine). |
| 4. Database | ⬜ | Repository ready: `Harshith993/taamaraAPP`. |
| 5. Authentication & authorization | ⬜ | |
| 6. Core operations (incl. vendor portal, crew app) | ⬜ | |
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
| D13 | 17 Nov 2026 | Vendors and crew upload photo/video proof of completed work; managers or supervisors approve it; videos are processed with ffmpeg and stored in S3 Mumbai (G17) | Requested by owner; limits are open question 10 |

## Earlier prototype (superseded)

Before the full brief arrived, a small Express + SQLite prototype was started. It has no screens and does not match the chosen stack. It was moved to `archive/prototype-express-sqlite/` for reference and is not part of the product.
