# Taamara Taamara: screen map (Phase 3)

Every screen, who can open it, and the devices it is laid out for. **P** = phone, **T** = iPad (portrait and landscape), **D** = desktop. Screens marked ◆ are drawn on the design canvas (page "Taamara Taamara · Cue Sheet"); the rest follow the same parts and rules in `DESIGN-LANGUAGE.md`.

Access follows the permission matrix in `docs/ARCHITECTURE.md` §6. The server enforces it: a screen a role cannot open is not in its menu and its API refuses the request.

## Sign-in (everyone)

| Screen | Devices | Notes |
|---|---|---|
| Log in | P T D | Phone number or email, plus password (crew can use a PIN). |
| Set your password | P T D | Shown on first login and after an owner resets it. |
| Forgot password | P T D | Email link for email users; crew and vendors ask an owner to reset. |
| Two-step check | P T D | Owners only, by authenticator app. |

## Internal app: owners, event managers, accountant, supervisors

| Area | Screen | Roles | Devices |
|---|---|---|---|
| Home | ◆ Owner home: countdown, crew meter, cue timeline, approvals, week, proof | Owner | T D (P stacks) |
| | ◆ Event manager home: my bookings, tasks, vendor progress, crew gaps | Manager | D T P |
| | Accountant home: dues, payments to make, invoices to check | Accountant | D T |
| | Supervisor home: opens straight into Event day | Supervisor | P T |
| Bookings | Booking list: upcoming, tentative, past; filter by type, manager, month | Owner, Manager (assigned), Accountant (view) | P T D |
| | New booking: client → functions → team → checklist template | Owner, Manager | P T D |
| | ◆ Booking workspace, tabs: Overview · Schedule · **Vendors** · Crew · Tasks · Budget · Equipment · Documents · Messages · Report | Owner, Manager (assigned); Accountant (view, Budget); Supervisor (assigned, no money) | T D (P: tabs become a menu) |
| | Function editor: date, times, venue, guests, run sheet | Owner, Manager | T D |
| | Run sheet print / PDF | Owner, Manager, Supervisor | D |
| Event day | ◆ Event day, night mode: run sheet, crew check-in, proof to check, announce, report a problem | Supervisor, Manager, Owner | T P |
| Calendar | Month, week and day views; layers for functions, vendor slots, crew shifts; colour = department | All internal (scoped) | P T D |
| Vendors | Directory: category, rating, free on a date | Owner, Manager, Accountant (view), Supervisor (view) | P T D |
| | Vendor profile: details, rate card, bookings, quotes, invoices, payments, reviews, documents | Owner; Manager (no bank details); Accountant | T D |
| | Ask vendors to quote: pick requirements → pick vendors → send | Owner, Manager | T D |
| | Compare quotes and approve | Owner (approve); Manager (view, assigned) | T D |
| | Work order (PDF) | Owner, Manager | D |
| Crew | Roster: skills, availability, last worked | Owner, Manager, Accountant (view), Supervisor (view) | P T D |
| | Crew member profile: shifts, attendance, pay, documents | Owner; Manager (pay ⚙); Accountant | T D |
| | Shift planner: fill open shifts per function | Owner, Manager | T D |
| Tasks | My tasks; all tasks as list or by status (Pending, Assigned, In progress, Under review, Completed, Delayed, Cancelled) | All internal (scoped) | P T D |
| | Task detail: description, reference images, comments, proof, approve | Assigned people; reviewer | P T D |
| Proof | Proof review queue: approve or ask to redo | Owner, Manager, Supervisor (assigned) | P T D |
| Approvals | Queue: quotes, payments, expenses, crew extras, with the evidence beside each | Owner | P T D |
| Money | ◆ Money overview: billed, received, paid out, expected profit, in/out chart, P&L by booking, outstanding, approvals | Owner, Accountant | D T |
| | Client billing and GST invoices | Owner, Accountant | D T |
| | Payments in and out; void with reason (never delete) | Owner, Accountant | D T |
| | Vendor invoices: match to work order and proof | Owner, Accountant | D T |
| | Crew pay register per event, extras and deductions | Owner, Accountant | D T |
| | Expenses with receipts; cash advances | Owner, Accountant; Manager and Supervisor (submit, assigned) | P T D |
| | Budgets: estimate vs actual per booking | Owner, Accountant; Manager (costs only ⚙) | D T |
| | Reports and exports for the accountant: sales register, purchase register, payments, GST summary | Owner, Accountant | D |
| Messages | Booking team chat, vendor threads, crew threads, direct, announcements | Scoped by booking | P T D |
| | Notifications | Everyone | P T D |
| Admin | Team: people, roles, reset password, deactivate | Owner | D T |
| | Permission matrix editor | Owner | D |
| | Settings: company and GST, lists (event types, vendor categories, skills, expense groups), checklist templates, numbering, proof rules | Owner; Accountant (GST and numbering ⚙) | D |
| | Audit log | Owner; Accountant (financial ⚙) | D |
| Account | Profile, password, two-step check (owners), signed-in devices | Everyone | P T D |

## Vendor portal

| Screen | Devices | Notes |
|---|---|---|
| Jobs: invited, active, done | P T D | Only their own jobs. |
| ◆ Job detail: requirement, progress from invite to paid, quote, manager contact, messages | P T D | Never shows the client's contact details or other vendors. |
| Quote form: line items, GST, PDF upload, versions | P T D | Each vendor sees only their own quotes. |
| Add proof (same flow as crew) | P T | After the work order. |
| Upload invoice | P T D | After approved proof, by default. |
| Calendar: their bookings and blocked dates | P T D | |
| Payments: status per job | P T D | |
| Profile: company, GST, bank details, extra logins for their staff | P T D | |

## Crew app

| Screen | Devices | Notes |
|---|---|---|
| ◆ Today: shift, reporting time and place, directions, supervisor call, add proof, tasks, pay | P | Opens on login. |
| ◆ Add proof: photo or video, resumable upload, note, location and time stamp | P | |
| Schedule: upcoming shifts | P | |
| Tasks | P | |
| Pay: per event and paid status | P | Shown only if owners allow it. |
| Announcements | P | Acknowledge with one tap. |
| Me: profile, password or PIN | P | |

## Layout rules per device

- **Phone** (< 744 px): one column. Bottom tab bar for crew and vendors, a top menu for internal users. Wide tables scroll sideways inside their box.
- **iPad portrait** (744–1023 px): two columns where it helps (event day: run sheet + crew). Tabs stay visible.
- **iPad landscape and desktop** (≥ 1024 px): the full three-column layouts drawn on the canvas.
- Every action is reachable by touch (44 px targets); nothing depends on hover. Keyboard shortcuts on iPad with a keyboard and on desktop.
