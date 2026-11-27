// Demo video for the Host / Co-host: the whole staff app at 1440×900, with iPad and phone segments
// and a short look at what managers, supervisors, the accountant and crew see.
// Usage: node scripts/demo/host.cjs <work-dir>   (then scripts/demo/stitch.cjs <work-dir> out.mp4)
// Run after scripts/demo/vendor.cjs on the same seeded database: the vendor's invoice and proof
// from that video are what the host checks here.
const path = require("path");
const { Demo } = require("./lib.cjs");
const prep = require("./prep.cjs");
const { query } = require("../../tests/e2e/lib.cjs");
const { makeMedia } = require("./media.cjs");

const HOST = "98000 00001";

(async () => {
  const workDir = process.argv[2] || "/tmp/demo-host";
  const demo = new Demo("For hosts", { workDir, frame: "desktop" });
  const media = await makeMedia(path.join(workDir, "media"));
  await demo.open();
  await prep.clientInvoicesOn();
  const id = async (name) => (await query("SELECT id FROM events WHERE name = $1", [name]))[0].id;
  const WEDDING = `/bookings/${await id("Aditi & Karan")}`;
  const SHOOT = `/bookings/${await id("Neha & Vivek pre-wedding shoot")}`;
  const DIWALI = `/bookings/${await id("Infotech Diwali Night")}`;

  // Helpers that read like the screen
  const nav = (d, name) => d.page.locator('nav[aria-label="Main"] a', { hasText: name }).first();
  const btn = (d, name, exact = false) => d.page.getByRole("button", { name, exact }).first();
  const link = (d, name) => d.page.getByRole("link", { name }).first();
  const text = (d, t) => d.page.getByText(t).first();
  const tab = async (d, name, key) => {
    const t = d.page.locator("main a, main [role=tab]").filter({ hasText: new RegExp(`^${name}`) }).first();
    if (!(await d.click(t, { after: 1300 }))) await d.go(`${d.page.url().split("?")[0]}?tab=${key}`);
    await d.idle();
  };
  const fill = async (d, target, value) => {
    if (await d.point(target, { hold: 250 })) {
      await d.unhl();
      await d.loc(target).fill(value);
      await d.wait(500);
    }
  };
  const look = async (d, target, html, hold = 0) => {
    await d.say(html);
    await d.point(target, { hold: 400 });
    await d.wait(Math.max(hold, 1200 + html.replace(/<[^>]+>/g, "").length * 50));
    await d.unhl();
  };
  const cancelForm = async (d) => {
    const c = d.page.getByRole("button", { name: "Cancel", exact: true }).first();
    if (await c.count()) await d.click(c, { after: 800 });
  };

  // ── 1. Opening, sign-in, home, sidebar, search, bookings ───────────────────────────────────
  await demo.segment({ device: "desktop", intro: true }, async (d) => {
    await d.start("/login", { card: ["Taamara Taamara ERP", "A tour for the Host and Co-host", "Every booking, vendor, crew shift and rupee in one calm place."] });
    await d.card("Chapter 1", "Opening and sign-in", "A short opening, then sign in with a mobile number or email.");
    await d.page.evaluate(() => sessionStorage.removeItem("tt-intro"));
    await d.page.reload({ waitUntil: "domcontentloaded" });
    await d.wait(3800);
    await d.caption("The lotus blooms once per visit, then settles into the header. A tap skips it.", 3500);
    await d.say("Hosts sign in with their <b>mobile number</b> (or email) and password.");
    await d.type('input[name="login"]', "98000 00001", { delay: 80 });
    await d.type('input[name="password"]', "Taamara@2026", { delay: 60 });
    await d.click('button[type="submit"]', { after: 300 });
    await d.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    await d.idle();
    await d.wait(800);

    await d.card("Chapter 2", "Home", "Your day at a glance.");
    await look(d, d.page.locator("main h1").first(), "A greeting, today's date and how many bookings are coming up.");
    await look(d, d.page.locator("main a", { hasText: "Approvals" }).first(), "Shortcut cards. The badge counts what's <b>waiting for you</b>.");
    await look(d, text(d, /Upcoming bookings ·/), "<b>Upcoming bookings</b>: status, next function, billed and received.");
    await look(d, text(d, /Approvals waiting ·/), "<b>Approvals waiting</b>: quotes, payments, expenses, advances and crew extras.");
    await d.scroll(320);
    await look(d, text(d, /My tasks ·/), "<b>My tasks</b>: anything assigned to you.");
    await d.scrollTop();

    await d.card("Chapter 3", "The sidebar and ⌘K search", "Everything is one click away.");
    await look(d, d.page.locator('nav[aria-label="Main"]').first(), "The sidebar groups the app: <b>Work, People, Operations, Money</b> and <b>Admin</b>.", 4200);
    await look(d, nav(d, "Approvals"), "Red counts show what needs attention, like approvals and proof to check.");
    await d.say("Press <b>⌘K</b> (or Ctrl+K, or /) to search bookings, vendors, crew and pages.");
    await d.point(d.page.locator("header button, header [aria-label=Search]").filter({ hasText: /Search/ }).first(), { hold: 800 });
    await d.unhl();
    await d.page.keyboard.press("Control+k");
    await d.wait(900);
    await d.page.keyboard.type("roshni", { delay: 140 });
    await d.wait(2200);
    await d.caption("Results appear as you type. Arrow keys and Enter open one.", 2600);
    await d.page.keyboard.press("Control+a");
    await d.page.keyboard.type("aditi", { delay: 140 });
    await d.wait(2000);
    await d.page.keyboard.press("Enter");
    await d.page.waitForURL(/\/bookings\//, { timeout: 8000 }).catch(() => {});
    await d.idle();
    await d.caption("…and we're on the <b>Aditi &amp; Karan</b> wedding.", 2400);

    await d.card("Chapter 4", "Bookings", "Create a booking in one page: client, functions and venues.");
    await d.click(nav(d, "Bookings"), { after: 1300 });
    await d.idle();
    await look(d, d.page.locator("main a, main button").filter({ hasText: /^Tentative$/ }).first(), "Filter <b>upcoming, tentative, past</b> or all, and search.");
    await look(d, d.page.locator("table").first(), "Each row: status, dates, next function, team, and vendors · crew · tasks.");
    await d.click(link(d, "+ New booking"), { after: 1400 });
    await d.idle();
    await d.caption("A new booking: give it a name and a type. The type's checklist is added for you.", 3500);
    await d.type('input[name="name"]', "Mehta & Kapoor Engagement", { delay: 45 });
    await d.select('select[name="categoryId"]', { label: "Engagement" });
    await d.select('select[name="status"]', { label: "Confirmed" });
    await d.type('input[name="expectedGuests"]', "250");
    await d.say("Pick an existing client, or add a new one right here.");
    await d.select('select[name="clientId"]', { index: 4 });
    await d.wait(1200);
    await d.say("Then the <b>functions</b>: a party is one; a wedding can have five, each with its venue.");
    await d.type('input[name="fn-name-0"]', "Ring ceremony", { delay: 45 });
    await fill(d, 'input[name="fn-date-0"]', "2026-12-12");
    await fill(d, 'input[name="fn-start-0"]', "19:00");
    await fill(d, 'input[name="fn-end-0"]', "23:30");
    await d.type('input[name="fn-venue-0"]', "Fairmont Jaipur", { delay: 45 });
    await d.type('input[name="fn-guests-0"]', "250");
    await d.click(btn(d, "Create booking"), { after: 2500 });
    await d.idle();
    await d.caption("Created, with a booking number and its checklist of tasks.", 3200);
  });

  // ── 2. Inside a booking ────────────────────────────────────────────────────────────────────
  await demo.segment({ device: "desktop", login: HOST }, async (d) => {
    await d.start(WEDDING, { card: ["Chapter 5", "Inside a booking: functions and planning", "The Aditi & Karan wedding: five functions over six days."] });
    await look(d, d.page.locator("main h1").first(), "The header: booking number, dates, lead manager, client and the team and crew chats.");
    await look(d, text(d, "Mehendi"), "The <b>function strip</b>: each function with its time and venue.");
    await look(d, text(d, "+ Add a function"), "<b>Overview</b> lists the functions. Edit them, or add another.");
    await tab(d, "Schedule", "schedule");
    await d.caption("<b>Schedule</b> is the run sheet: cues per function, and who sees each one (vendors, crew).");
    await d.scroll(300);
    await tab(d, "Needs", "needs");
    await d.caption("<b>Needs</b>: requirements to arrange, like a backup generator or extra live counters.");
    await tab(d, "Tasks", "tasks");
    await d.caption("<b>Tasks</b> with owners and due times. Some need a photo before they can be marked done.");
    await look(d, btn(d, "Sign off"), "When proof is sent, a manager or host <b>signs it off</b>.");

    await d.card("Chapter 6", "Vendors on a booking", "Ask for quotes, compare, approve and send a work order.");
    await tab(d, "Vendors", "vendors");
    await look(d, d.page.locator("table").first(), "Every vendor, the work, the <b>stage</b> (quoted, approved, in progress, done) and the amount.", 4500);
    await d.click(btn(d, "+ Ask a vendor to quote"), { after: 1000 });
    await d.select('select[name="department"]', { label: "Sound" });
    await d.wait(600);
    await d.caption("Choose the department and vendor and describe the work. The vendor gets it on their phone.", 3800);
    await cancelForm(d);
    await look(d, btn(d, "Work order"), "Once a host approves the quote, the manager sends a numbered <b>work order</b>.");

    await d.card("Chapter 7", "Crew and equipment", "Who's working, and the company's own items booked out.");
    await tab(d, "Crew", "crew");
    await d.caption("<b>Crew</b>: each person's duty, shifts and reporting point, pay and extras.");
    await look(d, btn(d, "Extra / deduction"), "Add an extra (like a late night) or a deduction. Extras wait for a host's approval.");
    await tab(d, "Equipment", "equipment");
    await look(d, text(d, /Clash:/), "<b>Equipment</b> booked from the register. A clash warns you, but still lets you book.", 4500);
    await look(d, btn(d, "Check out"), "<b>Check out</b> when it leaves the godown, and back in afterwards, with notes on damage.");

    await d.card("Chapter 8", "Budget and money on a booking", "Estimate against actual, what the client owes, and what's paid out.");
    await tab(d, "Money", "money");
    await look(d, text(d, "Margin before tax"), "The totals: billed, received, still owed, vendor costs, crew pay, expenses and <b>margin</b>.", 4500);
    await d.click(btn(d, "Change the budget"), { after: 1200 });
    await d.caption("The <b>budget</b>: estimated lines per category. A manager's changes are sent to the hosts to approve.", 4200);
    await d.scroll(-200);
    await d.go(`${WEDDING}?tab=money`);
    await d.scroll(520, { ms: 2200 });
    await d.caption("<b>Client charges</b> and <b>payments received</b>, and below them the <b>vendor payments</b> to make.", 4200);
    await d.scroll(500, { ms: 2000 });
    await d.wait(1000);

    await d.card("Chapter 9", "Documents", "Contracts, layouts and designs, shared with the right people.");
    await tab(d, "Docs", "docs");
    await d.click(btn(d, "+ Add a document"), { after: 900 });
    await d.type('input[name="title"]', "Mandap lighting plan", { delay: 45 });
    await d.select('select[name="kind"]', { label: "Plan / layout" });
    await d.say("Choose <b>who can see it</b>: the team, all staff, chosen vendors or crew, or hosts only.");
    await d.point('select[name="visibility"]', { hold: 2600 });
    await d.unhl();
    await d.upload(btn(d, "Choose PDF or photo"), media.photo, 'input[type="file"]');
    await d.click(btn(d, "Add document"), { after: 2500 });
    await d.caption("Added. Vendors and crew it's shared with see it in their app.", 3000);

    await d.card("Chapter 10", "Settling a booking", "A checklist, then settle and lock the books.");
    await d.go(`${DIWALI}?tab=money`);
    await d.scroll(300);
    await d.caption("When an event is over, the <b>settlement checklist</b> shows what's left: payments, proof, expenses.", 4200);
    const settle = d.page.locator("section", { has: d.page.getByRole("heading", { name: /^Settlement/ }) }).first();
    await d.click(settle.getByRole("button", { name: "Settle booking" }), { after: 1000 });
    await d.type(settle.locator('input[name^="settle-"]'), "Client balance agreed, books closed", { delay: 40 });
    await d.click(settle.getByRole("button", { name: "Settle and lock" }), { after: 2500 });
    await d.caption("Settled and locked: no more money changes. A host can reopen it, with a reason.", 3800);
  });

  // ── 3. Calendar, approvals, money, invoices, expenses, advances ───────────────────────────
  await demo.segment({ device: "desktop", login: HOST }, async (d) => {
    await d.start("/calendar", { card: ["Chapter 11", "Calendar", "Every function across every booking."] });
    await look(d, text(d, "Today"), "The month at a glance. Move between months, or jump back to today.");
    await d.scroll(450, { ms: 2000 });
    await d.caption("Below, the list by day: venue, crew and vendors for each function.", 3000);
    await d.scrollTop();

    await d.card("Chapter 12", "Approvals", "One inbox for everything a host decides.");
    await d.click(nav(d, "Approvals"), { after: 1300 });
    await d.idle();
    await look(d, text(d, /Vendor quote/), "A <b>vendor quote</b>: the lines, GST and total, with the other quotes for the same work to compare.", 5000);
    await d.say("<b>Approve</b>, ask to revise, or don't approve. Every decision goes in the audit log.");
    await d.click(btn(d, "Approve", true), { after: 2800 });
    await d.scroll(400, { ms: 1800 });
    await d.caption("Payments, expenses with their bills, cash advances and crew extras all wait here too.", 3800);

    await d.card("Chapter 13", "Money and the monthly P&L", "Across every booking.");
    await d.click(nav(d, "Money"), { after: 1300 });
    await d.idle();
    await look(d, text(d, "Billed to clients"), "Billed, received, still owed, paid out, and the <b>margin before tax</b>.");
    await d.scroll(380, { ms: 1800 });
    await look(d, link(d, "Excel"), "The <b>month-by-month P&amp;L</b> for the financial year. Download it as Excel for the accountant.", 4200);
    await d.scroll(500, { ms: 1800 });
    await d.caption("Each booking's billed, costs and margin, side by side.", 2800);

    await d.card("Chapter 14", "Vendor invoices and client invoices", "Check what vendors send; issue GST invoices to clients.");
    await d.click(nav(d, "Invoices"), { after: 1300 });
    await d.idle();
    const row = d.page.locator("li").filter({ hasText: "RL/1187" }).first();
    await look(d, row, "Roshni Lights sent invoice <b>RL/1187</b> from their phone. Check it against the work order and the approved proof.", 5000);
    await d.click(row.getByRole("button", { name: "Verified" }), { after: 2200 });
    await d.caption("Verified: it moves to <b>Ready to pay</b>.", 2600);
    await d.go(`${SHOOT}?tab=money`);
    const panel = d.page.locator("section", { has: d.page.getByRole("heading", { name: /^Client GST invoices/ }) }).first();
    await look(d, panel, "With client invoices switched on in Settings, draft a numbered <b>GST invoice</b> from the booking's charges.", 4000);
    await d.click(panel.getByRole("button", { name: "+ New invoice" }), { after: 1000 });
    const charge = panel.getByRole("checkbox").first();
    await d.click(charge, { after: 800 });
    await d.click(panel.getByRole("button", { name: "Save draft" }), { after: 2000 });
    await d.click(panel.getByRole("button", { name: "Issue", exact: true }), { after: 1000 });
    await d.click(panel.getByRole("button", { name: "Issue invoice" }), { after: 2500 });
    const open = panel.getByRole("link").filter({ hasText: /TT|INV|Open|Print|\// }).first();
    if (await d.click(open, { after: 2200 })) {
      await d.idle();
      await d.caption("The invoice, ready to print or save as PDF for the client.", 3200);
      await d.scroll(300);
    }

    await d.card("Chapter 15", "Expenses", "Small spends on a booking, each with its bill.");
    await d.click(nav(d, "Expenses"), { after: 1300 });
    await d.idle();
    await look(d, d.page.locator("main").getByText("Expenses ·").first(), "Every expense, its booking, who paid, and its status. A bill is needed for every one.", 4000);
    await d.click(btn(d, "+ Record an expense"), { after: 900 });
    await d.select('select[name="eventId"]', { label: "Aditi & Karan" });
    await d.select('select[name="categoryId"]', { label: "Transport" });
    await d.type('input[name="amount"]', "450");
    await d.type('input[name="description"]', "Tempo for the mandap flowers", { delay: 40 });
    await d.upload(btn(d, "Choose PDF or photo"), media.invoice, 'input[type="file"]');
    await d.click(btn(d, "Send for approval"), { after: 2400 });

    await d.card("Chapter 16", "Cash advances", "Company cash carried by managers and supervisors.");
    await d.click(nav(d, "Advances"), { after: 1300 });
    await d.idle();
    await look(d, text(d, /Cash with the team/), "<b>Cash with the team</b>: who holds how much right now.");
    await look(d, text(d, /Open advances/), "Each advance: spending (with bills), what's returned and what's still with them.", 4000);
    await d.click(btn(d, "+ Give a cash advance"), { after: 900 });
    await d.select('select[name="holderId"]', { label: "Ramesh Kumar" });
    await d.select('select[name="eventId"]', { label: "Aditi & Karan" });
    await d.type('input[name="amount"]', "3000");
    await d.type('input[name="purpose"]', "Tea, water and autos on the wedding day", { delay: 35 });
    await d.click(btn(d, "Give the advance"), { after: 2500 });
    await d.caption("Given. Ramesh sees it on his phone and records each spend with its bill.", 3600);
  });

  // ── 4. Operations, people, messages, admin ─────────────────────────────────────────────────
  await demo.segment({ device: "desktop", login: HOST }, async (d) => {
    await d.start("/equipment", { card: ["Chapter 17", "The equipment register", "The company's own decor, furniture, lights and sound."] });
    await look(d, text(d, /Missing or damaged/), "<b>Missing or damaged</b> items from past events, to settle.");
    await look(d, text(d, /Clashes ahead/), "<b>Clashes ahead</b>: the same items booked twice on overlapping dates.");
    await d.scroll(380, { ms: 1800 });
    await d.caption("Each item: how many you own, in store and out, its condition and where it's kept.", 3800);

    await d.card("Chapter 18", "Vendors and crew directories", "Everyone you book, with their history.");
    await d.click(nav(d, "Vendors"), { after: 1300 });
    await d.idle();
    await d.click(d.page.locator("main a, main button").filter({ hasText: /^Lighting$/ }).first(), { after: 1500 });
    await d.caption("Filter by category, or search. <b>Has login</b> shows who uses the vendor app.", 3200);
    await d.click(link(d, "Roshni Lights"), { after: 1500 });
    await d.idle();
    await d.caption("A vendor's page: contacts, GST, bank details (confirmed by a call) and their jobs with you.", 4200);
    await d.scroll(450, { ms: 2000 });
    await d.click(nav(d, "Crew"), { after: 1300 });
    await d.idle();
    await d.caption("The <b>crew</b>: skills, usual rate, upcoming work, and who has the crew app.", 3400);
    await d.click(link(d, "Sunil Yadav"), { after: 1500 });
    await d.idle();
    await d.caption("A crew member's shifts, pay history and days off.", 3000);

    await d.card("Chapter 19", "Proof photos", "Photos and videos from vendors and crew, approved before anyone is paid.");
    await d.click(nav(d, "Proof"), { after: 1300 });
    await d.idle();
    await d.caption("Each photo or video shows who sent it, when and where. Videos play right here.", 3800);
    await d.click(btn(d, "Approve", true), { after: 2000 });
    const redo = btn(d, "Ask to redo");
    if (await d.click(redo, { after: 900 })) {
      await d.type(d.page.locator("main textarea").first(), "Please show the whole entrance, not only the left side", { delay: 30 });
      await d.click(btn(d, "Send back"), { after: 2000 });
    }
    await d.caption("Approved, or sent back with a note. The sender sees it straight away.", 3000);

    await d.card("Chapter 20", "Event day: night mode", "Built for the venue: dark, big and calm.");
    await d.click(nav(d, "Event day"), { after: 1800 });
    await d.idle();
    await d.caption("Today's event in <b>night mode</b>: the next cue, crew confirmed, vendors due and proof to check.", 4500);
    await look(d, text(d, /Crew today/i), "Tap a number to call crew. Vendors due have a <b>Call</b> button.");
    await look(d, text(d, /Tasks due/i), "Tasks due today, and the team on duty.");
    await d.click(link(d, /Back to the app/i), { after: 1500 });

    await d.card("Chapter 21", "Messages and notifications", "Team chats, vendor and crew threads, and announcements.");
    await d.go("/messages");
    await d.caption("Conversations per booking: the team, each vendor, and the crew.", 3000);
    await d.click(d.page.locator("main a").filter({ hasText: /^Team/ }).first(), { after: 1500 });
    await d.idle();
    const box = d.page.locator("main textarea").first();
    await d.type(box, "Swatches are with Gulmohar. Pastel mandap confirmed!", { delay: 35 });
    if (!(await d.click(btn(d, "Send", true), { after: 1500 }))) await box.press("Enter");
    await d.go("/messages");
    await look(d, text(d, "Send an announcement"), "<b>Announcements</b> go to a booking's team, crew or vendors, or to everyone, and show who has read them.", 4500);
    await d.click(d.page.locator("header a[href*=notifications], header [aria-label*=otification]").first(), { after: 1500 });
    await d.idle();
    await d.caption("The bell: what happened and what's waiting. Phones can get them as push notifications too.", 3800);
    await d.click(btn(d, "Mark all read"), { after: 1200 });

    await d.card("Chapter 22", "Team, roles and settings", "Who can sign in, and what each role can do.");
    await d.click(nav(d, "Team"), { after: 1300 });
    await d.idle();
    await d.caption("Add a person with a role and temporary password. Change roles, reset passwords or switch people off.", 4500);
    await d.scroll(400, { ms: 1800 });
    await d.click(link(d, /What each role can do/), { after: 1500 });
    await d.idle();
    await d.caption("<b>Roles</b>: for managers, supervisors and the accountant, choose each permission: none, their bookings, or all.", 5000);
    await d.scroll(500, { ms: 2400 });
    await d.click(nav(d, "Settings"), { after: 1300 });
    await d.idle();
    await d.caption("<b>Settings</b>: whether crew see their pay, gallery uploads, proof before final payment, client GST invoices…", 5000);
    await d.scroll(500, { ms: 2400 });
    await d.caption("…and the company details printed on client invoices. Every change goes in the audit log.", 3600);
  });

  // ── 5. iPad and phone layouts for the host ────────────────────────────────────────────────
  await demo.segment({ device: "ipad", login: HOST }, async (d) => {
    await d.start("/home", { card: ["Chapter 23", "On an iPad", "The sidebar becomes an icon rail."] });
    await d.caption("On an iPad held upright, the sidebar shrinks to an <b>icon rail</b>.", 3200);
    await d.point(d.page.locator('nav[aria-label="Main"]').first(), { hold: 1500 });
    await d.unhl();
    await d.go(WEDDING);
    await d.caption("Bookings, tabs and tables fit the screen, ready for the venue.", 3200);
    await d.scroll(400);
  });
  await demo.segment({ device: "phone", login: HOST }, async (d) => {
    await d.start("/home", { card: ["Chapter 24", "On a phone", "The main places sit in thumb reach."] });
    await d.caption("On a phone, the main places are in a <b>bottom bar</b>.", 3000);
    await d.scroll(400);
    const more = d.page.getByRole("button", { name: /More/ }).last();
    await d.say("<b>More</b> opens everything else.");
    await d.click(more, { after: 2600 });
    await d.page.keyboard.press("Escape");
    await d.wait(800);
  });

  // ── 6. What other people see ───────────────────────────────────────────────────────────────
  await demo.segment({ device: "desktop", login: "priya@demo.taamara.in" }, async (d) => {
    await d.start("/home", { card: ["Chapter 25", "What the others see", "Each role sees only what it needs."] });
    await d.caption("<b>Event managers</b> (Priya) run the bookings they're assigned to: planning, vendors, crew and tasks.", 4500);
    await look(d, d.page.locator('nav[aria-label="Main"]').first(), "No Team, Settings or company-wide money. Their quotes and expenses go to a host to approve.", 4500);
  });
  await demo.segment({ device: "desktop", login: "accounts@demo.taamara.in" }, async (d) => {
    await d.start("/home");
    await d.caption("The <b>accountant</b> (an outside accountant) sees money only: invoices, payments, expenses, the P&amp;L and exports.", 4800);
    await look(d, d.page.locator('nav[aria-label="Main"]').first(), "No run sheets, proof or crew phone numbers.", 3000);
  });
  await demo.segment({ device: "phone", login: "98000 00006" }, async (d) => {
    await d.start("/home");
    await d.caption("<b>Supervisors</b> (Ramesh) work at the venue from a phone: run sheet ticks, proof, crew, and cash.", 4800);
    await d.scroll(350);
    await d.wait(1000);
  });
  await demo.segment({ device: "phone", login: "99220 00002" }, async (d) => {
    await d.start("/crew");
    await d.caption("<b>Crew</b> (Sunil) see today's shift, where to report, their tasks, proof and their pay.", 4600);
    await d.scroll(350);
    await d.page.evaluate(() => window.__demo.card("Taamara Taamara ERP", "Thank you for watching", "Questions or ideas? Message the team in the app."));
    d.marks.push({ t: Date.now(), title: "Thank you", kicker: "" });
    await d.wait(5000);
  });

  await demo.close();
})();
