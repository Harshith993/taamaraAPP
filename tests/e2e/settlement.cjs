// Browser check: settling a booking (checklist, settle and lock, reopen) and the monthly P&L.
// Usage: node tests/e2e/settlement.cjs <screenshot-dir>
// Uses the demo booking "Infotech Diwali Night" (completed, client part-paid). It ends reopened,
// so the script can run again.
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const [ev] = await query(`SELECT id FROM events WHERE name = 'Infotech Diwali Night'`);
  const [settled] = await query(`SELECT id FROM events WHERE name = 'Mittal Engagement'`);
  const url = `${BASE}/bookings/${ev.id}?tab=money`;
  const panelOf = (page, name) => page.locator("section", { has: page.getByRole("heading", { name }) });
  try {
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(url);
      const panel = panelOf(page, /^(Settlement|Ready to settle)/);
      await panel.waitFor({ timeout: 10000 });
      const text = await panel.textContent();
      check("the accountant sees the settlement checklist", /The client has paid in full/.test(text) && /Vendors are paid/.test(text));
      check("only owners get the settle button", (await panel.getByRole("button", { name: "Settle booking" }).count()) === 0);
      const owed = text.match(/still owes ₹([\d,]+(?:\.\d+)?)/);
      if (owed) {
        check("it says what the client still owes", owed[1] === "3,55,200.00", owed[1]);
        await page.screenshot({ path: `${out}/s0-checklist.png`, fullPage: true });
        await page.getByRole("button", { name: "+ Record a payment received" }).click();
        await page.locator('input[name="amount"]').fill(owed[1].replace(/,/g, ""));
        await page.locator('input[name="reference"]').fill("NEFT-DIWALI-2");
        await page.getByRole("button", { name: "Record", exact: true }).click();
        await panelOf(page, "Ready to settle").waitFor({ timeout: 10000 });
      }
      check("once the client has paid, it is ready to settle", (await panelOf(page, "Ready to settle").count()) === 1);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(url);
      const panel = panelOf(page, "Ready to settle");
      await panel.getByRole("button", { name: "Settle booking" }).click();
      await panel.locator('input[name^="settle-"]').fill("All paid, books closed");
      await panel.getByRole("button", { name: "Settle and lock" }).click();
      await panelOf(page, "Settled").waitFor({ timeout: 10000 });
      const text = await panelOf(page, "Settled").textContent();
      check("an owner settles it; the final figures show", /margin/i.test(text) && /All paid, books closed/.test(text));
      const [row] = await query(`SELECT status, "settledAt" FROM events WHERE id = $1`, [ev.id]);
      check("the booking is SETTLED in the database", row.status === "SETTLED" && row.settledAt !== null, row.status);
      check("money buttons are gone once settled", (await page.getByRole("button", { name: /Record a payment received|Add a charge/ }).count()) === 0);
      await page.screenshot({ path: `${out}/s1-settled.png`, fullPage: true });

      await page.goto(`${BASE}/bookings/${settled.id}?tab=money`);
      check("the seeded settled booking shows its final margin", /₹4,35,000/.test(await panelOf(page, "Settled").textContent()));

      await page.goto(`${BASE}/money`);
      const pnl = panelOf(page, /^Month by month/);
      const ptext = await pnl.textContent();
      check("the Money page shows the month-by-month P&L", /FY 20\d\d–\d\d/.test(ptext) && /After office/.test(ptext) && /Net cash/.test(ptext));
      check("the P&L has twelve months and a total", (await pnl.locator("tbody tr").count()) === 13);
      const href = await pnl.getByRole("link", { name: "Excel" }).getAttribute("href");
      const res = await page.request.get(`${BASE}${href}`);
      check("the P&L downloads as Excel", res.ok() && /spreadsheetml/.test(res.headers()["content-type"] || ""), String(res.status()));
      await page.screenshot({ path: `${out}/s2-money-pnl.png`, fullPage: true });
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("aman@demo.taamara.in");
      await page.goto(url);
      const body = await page.locator("main").textContent();
      check("the manager sees it is settled, without client figures", /This booking is settled/.test(body) && !/Client still owes|Billed \(before GST\)/.test(body));
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98000 00002", PHONE);
      await page.goto(url);
      const panel = panelOf(page, "Settled");
      await panel.getByRole("button", { name: "Reopen" }).click();
      await panel.locator('input[name^="reopen-"]').fill("Checking the reopen flow");
      await panel.getByRole("button", { name: "Reopen booking" }).click();
      await panelOf(page, "Ready to settle").waitFor({ timeout: 10000 });
      const [row] = await query(`SELECT status FROM events WHERE id = $1`, [ev.id]);
      check("the co-founder reopens it on a phone, with a reason", row.status === "COMPLETED", row.status);
      await page.screenshot({ path: `${out}/s3-reopened-phone.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
