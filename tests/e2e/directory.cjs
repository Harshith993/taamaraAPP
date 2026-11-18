// Browser check: vendor directory and crew roster.
// Usage: node tests/e2e/directory.cjs <screenshot-dir>
const { BASE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const tag = Date.now() % 100000;
  const company = `Jyoti Tent House ${tag}`;
  const phone = `98${String(Date.now()).slice(-8)}`;
  const crewName = `Bablu Saini ${tag}`;
  const crewPhone = `97${String(Date.now() + 7).slice(-8)}`;

  try {
    // 1. Manager adds a vendor
    let vendorUrl;
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.getByRole("link", { name: "Vendors", exact: true }).click();
      await page.waitForURL(/\/vendors$/);
      check("manager sees the directory with departments", /Roshni Lights/.test(await page.textContent("main")) && (await page.locator('nav[aria-label="Departments"] a').count()) > 5);
      await page.getByRole("button", { name: "+ Add vendor" }).click();
      check("managers are not asked for GSTIN", (await page.locator('input[name="gstin"]').count()) === 0);
      await page.fill('input[name="companyName"]', company);
      await page.fill('input[name="contactName"]', "Jyoti Prakash");
      await page.fill('input[name="phone"]', phone);
      await page.fill('input[name="services"]', "Shamianas, chairs, stage platforms");
      await page.locator("fieldset", { hasText: "Departments" }).locator("label", { hasText: "Decoration" }).click();
      await page.getByRole("button", { name: "Add vendor", exact: true }).click();
      await page.waitForURL(/\/vendors\/[0-9a-f-]{36}/, { timeout: 15000 });
      vendorUrl = page.url();
      check("manager adds a vendor and lands on their profile", (await page.textContent("h1")).toUpperCase().includes("JYOTI TENT HOUSE"));
      check("managers can't see bank details or edit", (await page.getByRole("button", { name: "Edit vendor" }).count()) === 0 && !/Bank/.test(await page.textContent("main")));
      await ctx.close();
    }

    // 2. Accountant adds GSTIN and bank details
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(vendorUrl);
      await page.getByRole("button", { name: "Add bank details" }).click();
      await page.fill('input[name="accountName"]', "Jyoti Tent House");
      await page.fill('input[name="accountNumber"]', "50100123456789");
      await page.fill('input[name="ifsc"]', "HDFC0001234");
      await page.getByRole("button", { name: "Save bank details" }).click();
      await page.waitForFunction(() => /••••6789/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
      const stored = await query(`SELECT b."accountNumberEnc" FROM vendor_bank_details b JOIN vendors v ON v.id = b."vendorId" WHERE v."companyName" = $1`, [company]);
      check("bank account is stored encrypted and shown as the last four", stored[0] && !stored[0].accountNumberEnc.includes("50100123456789"));
      await ctx.close();
    }

    // 3. Supervisor registers crew but can't edit them
    let crewUrl;
    {
      const { ctx, page } = await signIn("98000 00006");
      await page.goto(`${BASE}/roster`);
      await page.getByRole("button", { name: "+ Register crew" }).click();
      check("supervisors are not asked for pay", (await page.locator('input[name="usualEventRate"]').count()) === 0);
      await page.fill('input[name="name"]', crewName);
      await page.fill('input[name="phone"]', crewPhone);
      await page.locator("fieldset", { hasText: "Skills" }).locator("label", { hasText: "Helper" }).click();
      await page.getByRole("button", { name: "Register", exact: true }).click();
      await page.waitForURL(/\/roster\/[0-9a-f-]{36}/, { timeout: 15000 });
      crewUrl = page.url();
      check("supervisor registers crew", (await page.textContent("h1")).toUpperCase().includes("BABLU SAINI"));
      check("supervisor can't edit crew", (await page.getByRole("button", { name: "Edit details" }).count()) === 0);
      await ctx.close();
    }

    // 4. Manager sets pay and a day off
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(crewUrl);
      await page.getByRole("button", { name: "Edit details" }).click();
      await page.fill('input[name="usualEventRate"]', "650");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => /usually ₹650 per event/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
      check("manager sets the usual pay", true);
      const d = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
      await page.fill('input[name="date"]', d);
      await page.fill('input[name="reason"]', "Village wedding");
      await page.getByRole("button", { name: "Not available" }).click();
      await page.waitForFunction(() => /Village wedding/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
      check("manager marks a day off", true);
      await page.screenshot({ path: `${out}/70-crew-profile.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Owner menu on desktop and iPad landscape
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/vendors`);
      await page.screenshot({ path: `${out}/71-vendors-desktop.png` });
      await page.setViewportSize({ width: 1180, height: 820 });
      await page.screenshot({ path: `${out}/72-vendors-ipad-landscape.png` });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
