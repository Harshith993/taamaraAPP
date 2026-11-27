// Browser check: booking documents shared with a vendor and the crew, and the calendar.
// Usage: node tests/e2e/docs-calendar.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const title = `Stage layout ${Date.now() % 10000}`;
  const pdf = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "layout.pdf");
  writeFileSync(pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

  try {
    // 1. Manager shares a layout with Gulmohar Decor and the crew
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      await page.goto(`${page.url().split("?")[0]}?tab=docs`);
      await page.getByRole("button", { name: "+ Add a document" }).click();
      check("managers can't keep owner-only documents", (await page.locator('select[name="visibility"] option[value="OWNER_ONLY"]').count()) === 0);
      await page.fill('input[name="title"]', title);
      await page.selectOption('select[name="visibility"]', "SHARED");
      await page.locator("fieldset", { hasText: "Share with" }).locator("label", { hasText: "Gulmohar Decor" }).click();
      await page.locator("fieldset", { hasText: "Share with" }).locator("label", { hasText: "crew" }).click();
      await page.locator('input[aria-label="File (PDF or photo)"]').setInputFiles(pdf);
      await page.getByText("layout.pdf · attached").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Add document" }).click();
      await page.locator("li", { hasText: title }).waitFor({ timeout: 10000 });
      check("manager adds a shared document", /Shared: Gulmohar Decor, Crew/.test(await page.locator("li", { hasText: title }).textContent()));
      await page.screenshot({ path: `${out}/80-docs.png`, fullPage: true });
      await ctx.close();
    }

    // 2. The vendor and a crew member see it; another vendor doesn't
    {
      const { ctx, page } = await signIn("98110 00002", PHONE);
      await page.locator("a", { hasText: "Mandap, stage, entrance" }).first().click();
      await page.waitForURL(/\/vendor\/jobs\//);
      const link = page.getByRole("link", { name: title });
      check("Gulmohar sees the shared layout", (await link.count()) === 1);
      const res = await page.request.get(`${BASE}${await link.getAttribute("href")}`);
      check("and can open it", res.status() === 200);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98110 00005", PHONE);
      const jobs = await page.locator("main a[href^='/vendor/jobs/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      let seen = false;
      for (const href of jobs) {
        await page.goto(`${BASE}${href}`);
        if ((await page.getByRole("link", { name: title }).count()) > 0) seen = true;
      }
      check("Roshni Lights does not see it", !seen);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("99220 00002", PHONE);
      check("crew on the booking see it on Today", (await page.getByRole("link", { name: title }).count()) === 1);
      await ctx.close();
    }

    // 3. Calendar
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calendar" }).click();
      await page.waitForURL(/\/calendar/);
      const grid = await page.textContent("main");
      check("calendar shows this month's functions", /Aditi & Karan/.test(grid) && /Kabir's 1st Birthday/.test(grid));
      await page.screenshot({ path: `${out}/81-calendar.png`, fullPage: true });
      await page.setViewportSize({ width: 1180, height: 820 });
      // The sidebar shows the host's whole menu on an iPad in landscape without scrolling.
      const nav = await page.evaluate(() => { const n = document.querySelector('nav[aria-label="Main"]'); return { visible: n.getBoundingClientRect().width > 0, fits: n.scrollHeight <= n.clientHeight + 1, links: n.querySelectorAll("a").length }; });
      check("the host's whole menu fits the sidebar on iPad landscape", nav.visible && nav.fits && nav.links >= 14, JSON.stringify(nav));
      await page.setViewportSize(PHONE);
      check("phone shows the agenda list", await page.locator(".md\\:hidden li").first().isVisible());
      await page.screenshot({ path: `${out}/82-calendar-phone.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
