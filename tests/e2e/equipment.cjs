// Browser check: the equipment register (D58).
//   manager sees the register with a clash and a damage report → adds an item with a photo →
//   books it on the wedding, checks the chairs out and back in with damage → supervisor uses the
//   booking's Equipment tab but has no register → host settles the damage report.
// Usage: node tests/e2e/equipment.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { BASE, PHONE, IPAD, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const photo = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "sofa.jpg");
  writeFileSync(photo, await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#C084FC" } }).jpeg().toBuffer());
  const SOFA = `Velvet sofa set ${Date.now() % 10000}`;
  const [wedding] = await query(`SELECT id FROM events WHERE name = 'Aditi & Karan'`);

  try {
    // 1. Manager: the register, its clash and damage report; adds an item with a photo
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Equipment" }).click();
      await page.waitForURL(/\/equipment/);
      const register = await page.getByRole("list", { name: "Equipment register" }).textContent();
      check("the register lists the company's equipment", /Gold chiavari chairs/.test(register) && /Brass urli bowls/.test(register) && /Bluetooth speakers/.test(register));
      const clashes = (await page.getByRole("list", { name: "Equipment clashes" }).textContent().catch(() => "")) || "";
      check("clashes ahead are shown", /Gold chiavari chairs: 10 short/.test(clashes), clashes.slice(0, 120));
      const issues = (await page.getByRole("list", { name: "Missing or damaged equipment" }).textContent().catch(() => "")) || "";
      check("missing or damaged items are reported", /LED PAR uplighters: 1 damaged/.test(issues), issues.slice(0, 120));
      await page.getByRole("button", { name: "+ Add equipment" }).click();
      const form = page.getByRole("form", { name: "Add equipment" });
      await form.locator('input[name="name"]').fill(SOFA);
      await form.locator('select[name="category"]').selectOption("FURNITURE");
      await form.locator('input[name="quantity"]').fill("3");
      await form.locator('input[type="file"]').setInputFiles(photo);
      await page.getByText("sofa.jpg · attached").waitFor({ timeout: 20000 });
      await form.getByRole("button", { name: "Add to the register" }).click();
      await page.getByRole("listitem", { name: SOFA }).locator("img").waitFor({ timeout: 15000 }).catch(() => {});
      check("manager adds an item with a photo", (await page.getByRole("listitem", { name: SOFA }).locator("img").count()) === 1);
      await page.screenshot({ path: `${out}/e0-equipment.png`, fullPage: true });
      await ctx.close();
    }

    // 2. Manager: the wedding's Equipment tab: clash warning, books the sofas, checks the chairs out and in
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in", IPAD);
      await page.goto(`${BASE}/bookings/${wedding.id}?tab=equipment`);
      check("the booking warns about the chair clash", /Clash: Gold chiavari chairs \(10 short\)/.test(await page.textContent("main")));
      await page.getByRole("button", { name: "+ Book equipment" }).click();
      const form = page.getByRole("form", { name: "Book equipment" });
      const option = await form.locator('select[name="itemId"] option', { hasText: SOFA }).getAttribute("value");
      await form.locator('select[name="itemId"]').selectOption(option);
      await form.locator('input[name="quantity"]').fill("2");
      await form.getByRole("button", { name: "Book it" }).click();
      await page.getByText("Booked for these dates.").waitFor({ timeout: 10000 });
      check("manager books equipment for the booking's dates", await page.getByRole("listitem", { name: `Equipment: ${SOFA}` }).waitFor({ timeout: 10000 }).then(() => true, () => false));
      const chairs = page.getByRole("listitem", { name: "Equipment: Gold chiavari chairs" });
      await chairs.getByRole("button", { name: "Check out" }).click();
      await chairs.locator('input[name^="co-"]').fill("Seat pads packed separately");
      await chairs.getByRole("button", { name: "Checked out" }).click();
      await page.getByText("Checked out.").waitFor({ timeout: 10000 });
      await page.reload();
      const again = page.getByRole("listitem", { name: "Equipment: Gold chiavari chairs" });
      await again.getByRole("button", { name: "Check in" }).click();
      await again.locator('input[name^="cg-"]').fill("98");
      await again.locator('input[name^="cd-"]').fill("2");
      await again.getByRole("button", { name: "Checked in" }).click();
      await again.getByText(/Say what was damaged/).waitFor({ timeout: 10000 });
      check("damage needs a note", true);
      await again.locator('input[name^="cn-"]').fill("2 chairs with a cracked back");
      await again.getByRole("button", { name: "Checked in" }).click();
      await page.getByText("2 damaged").first().waitFor({ timeout: 10000 });
      const [row] = await query(`SELECT a.status, a."quantityDamaged" AS d FROM inventory_allocations a JOIN inventory_items i ON i.id = a."itemId" WHERE i.name = 'Gold chiavari chairs' AND a."eventId" = $1`, [wedding.id]);
      check("chairs are checked back in with the damage recorded", row?.status === "RETURNED" && row.d === 2, JSON.stringify(row));
      const [n] = await query(`SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n."userId" WHERE n.type = 'equipment.problem' AND u."phoneNumber" = '+919800000001'`);
      check("hosts are told about the damage", n.n >= 1, String(n.n));
      await page.screenshot({ path: `${out}/e1-booking-equipment.png`, fullPage: true });
      await ctx.close();
    }

    // 3. Supervisor: uses the booking's tab on a phone, but has no register
    {
      const { ctx, page } = await signIn("98000 00006", PHONE);
      await page.goto(`${BASE}/bookings/${wedding.id}?tab=equipment`);
      check("the supervisor sees the booking's equipment", (await page.getByRole("listitem", { name: `Equipment: ${SOFA}` }).count()) === 1 && (await page.getByRole("button", { name: "Check out" }).count()) >= 1);
      await page.goto(`${BASE}/equipment`);
      check("the register is for hosts and managers", /\/home/.test(page.url()));
      await page.goto(`${BASE}/bookings/${wedding.id}?tab=equipment`);
      await page.screenshot({ path: `${out}/e2-equipment-phone.png`, fullPage: true });
      await ctx.close();
    }

    // 4. Host settles the damage report
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/equipment`);
      const issues = page.getByRole("list", { name: "Missing or damaged equipment" });
      const row = issues.getByRole("listitem").filter({ hasText: "LED PAR uplighters" });
      await row.getByRole("button", { name: "Settle" }).click();
      await row.locator('input[name^="rs-"]').fill("Lens replaced");
      await row.getByRole("button", { name: "Settled" }).click();
      await page.getByText("Settled.").waitFor({ timeout: 10000 });
      const [r] = await query(`SELECT a.resolution FROM inventory_allocations a JOIN inventory_items i ON i.id = a."itemId" WHERE i.name = 'LED PAR uplighters' AND a.status = 'RETURNED'`);
      check("host settles a damage report", r?.resolution === "Lens replaced", r?.resolution);
      await ctx.close();
    }

    // 5. The accountant has no equipment
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/bookings/${wedding.id}`);
      check("the accountant sees no Equipment tab", !/Equipment/.test(await page.getByRole("navigation", { name: "Booking sections" }).textContent()));
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }

  await browser.close();
  report();
})();
