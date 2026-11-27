# Demo videos

Two screen-recorded tours of the real app (production build, demo seed), with a visible cursor,
click highlights, plain-English captions and chapter title cards. No voice-over.

| Video | For | Device | File |
|---|---|---|---|
| Host tour | Host / Co-host (role OWNER) | Laptop 1440×900, with iPad and phone parts | `taamara-host-demo.mp4` |
| Vendor guide | Vendor partners | Phone 393×852, shown portrait | `taamara-vendor-demo.mp4` |

Each MP4 has chapter marks (players such as VLC and QuickTime show them). The chapter list with
times is in `*.chapters.txt` next to each video.

## What they show

**Host tour**: the opening intro and sign-in, home, the sidebar and ⌘K search, creating a booking,
inside a booking (functions, run sheet, needs, tasks), vendors on a booking (quotes, work orders),
crew and equipment tabs, budget and money on a booking, documents, settling a booking, the calendar,
approvals, money and the monthly P&L, vendor invoices and client GST invoices, expenses, cash
advances, the equipment register, the vendor and crew directories, proof photos, event-day night
mode, messages and notifications, team, roles and settings, the iPad and phone layouts, and a short
look at what event managers, the accountant, supervisors and crew see.

**Vendor guide** (Roshni Lights on a phone): sign in, "What needs you now", sending a quote,
accepting the work order, starting work, proof photos and "Work is done", sending an invoice and
seeing payments, messages, alerts, and the profile with a bank-details change (confirmed by a call
from the office). The bottom tab bar is used throughout.

## Making them again

Needs PostgreSQL 16 with the `taamara_dev` database (see `.env.example`), `ffmpeg`, and the
pre-installed Playwright Chromium.

```bash
npm run build && npm start            # production server on :3000 (leave it running)
scripts/demo/record-all.sh docs/demo  # reset + seed, record both, stitch both (about 25 minutes)
```

`record-all.sh` rebuilds the development database from the demo seed (`scripts/demo/reset-db.sh`,
which refuses any database not ending in `_dev`), records the vendor video and then the host video
(the host checks the vendor's invoice and proof from the first one), and stitches each into an
H.264 MP4.

| Script | What it does |
|---|---|
| `scripts/demo/lib.cjs` | Recorder: one browser context per scene, an overlay with cursor, click ripples, highlight box, captions and title cards; trims each recording to its first page. |
| `scripts/demo/vendor.cjs`, `host.cjs` | The two tours. Each step is a real click or keystroke; a missing control is logged and skipped rather than spoiling the take. |
| `scripts/demo/prep.cjs` | Office steps done off camera between the vendor's scenes (invite to quote, approve, work order, sign-off) and switching on client invoices. |
| `scripts/demo/media.cjs` | The "photos" taken on camera: a lit stage for proof, a paper invoice. |
| `scripts/demo/stitch.cjs` | Joins the scenes (phones and iPads centred on the cream page in the laptop video), applies the per-video speed (host 1.25×, vendor 1.1×), adds chapters. |

Automated browsers skip the opening intro, so the recorder sets `window.__ttForceIntro`; it signs
people in off camera (except the sign-in scenes) and clears the login rate limit first.
