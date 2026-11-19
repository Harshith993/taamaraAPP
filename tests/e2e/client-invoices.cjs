// Browser check: client GST invoices behind the owner switch, company details, draft → issue →
// print → cancel, and who sees what. Uses the demo booking "Neha & Vivek pre-wedding shoot".
// Usage: node tests/e2e/client-invoices.cjs <screenshot-dir>
// It ends with the invoice cancelled and the switch off again, so it can run again.
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

const SWITCH = "Issue GST invoices to clients from the app";

async function setSwitch(page, on) {
  await page.goto(`${BASE}/settings`);
  const box = page.locator("label", { hasText: SWITCH }).getByRole("switch");
  if ((await box.isChecked()) !== on) await box.click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText(/Saved|Nothing changed/).waitFor({ timeout: 10000 });
}

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const [ev] = await query(`SELECT id FROM events WHERE name = 'Neha & Vivek pre-wedding shoot'`);
  const [wedding] = await query(`SELECT id FROM events WHERE name = 'Aditi & Karan'`);
  const money = `${BASE}/bookings/${ev.id}?tab=money`;
  const panelOf = (page, name) => page.locator("section", { has: page.getByRole("heading", { name }) });
  try {
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(money);
      check("invoices are off by default", (await panelOf(page, /^Client GST invoices/).count()) === 0);
      await setSwitch(page, true);
      check("an owner switches client invoices on", true);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/settings`);
      check("the accountant sees company details but not the switches", (await page.getByRole("heading", { name: "Company details for GST invoices" }).count()) === 1 && (await page.getByRole("switch").count()) === 0);
      await page.locator('input[name="gstin"]').fill("08AAACT1234A1Z2");
      await page.getByRole("button", { name: "Save company details" }).click();
      await page.getByText(/GSTIN doesn't look right/).first().waitFor({ timeout: 10000 });
      check("a mistyped GSTIN is caught by its check character", true);
      await page.locator('input[name="legalName"]').fill("Taamara Taamara Events LLP");
      await page.locator('input[name="gstin"]').fill("08AAACT1234A1Z1");
      await page.locator('input[name="pan"]').fill("");
      await page.locator('input[name="address"]').fill("14 Bhagwan Das Road, C-Scheme");
      await page.locator('input[name="city"]').fill("Jaipur");
      await page.locator('textarea[name="bankDetails"]').fill("HDFC Bank, C-Scheme\nA/c 50200012345678 · IFSC HDFC0000123");
      await page.getByRole("button", { name: "Save company details" }).click();
      await page.getByText(/Company details saved|Nothing changed/).waitFor({ timeout: 10000 });
      check("company GSTIN, address and bank details saved", (await query(`SELECT gstin, "stateCode" FROM company_profile`))[0].stateCode === "08");

      await page.goto(money);
      const panel = panelOf(page, /^Client GST invoices/);
      await panel.waitFor({ timeout: 10000 });
      const issued = await query(`SELECT count(*)::int AS n FROM client_invoices WHERE "eventId" = $1 AND status <> 'CANCELLED'`, [ev.id]);
      check("no live invoice on the booking before the check", issued[0].n === 0, String(issued[0].n));
      await panel.getByRole("button", { name: "Edit billing details" }).click();
      await panel.locator('input[name="address"]').fill("22 Civil Lines");
      await panel.locator('select[name="stateCode"]').selectOption("08");
      await panel.getByRole("button", { name: "Save", exact: true }).click();
      await panel.getByText("22 Civil Lines").waitFor({ timeout: 10000 });
      check("billing details show CGST + SGST within Rajasthan", /CGST \+ SGST/.test(await panel.textContent()));
      await panel.getByRole("button", { name: "+ New invoice" }).click();
      await panel.getByRole("checkbox", { name: /Pre-wedding shoot package/ }).check();
      await panel.getByRole("button", { name: "Save draft" }).click();
      await panel.getByRole("button", { name: "Issue", exact: true }).waitFor({ timeout: 10000 });
      check("a draft is made from the booking's charges", /DRAFT/.test(await panel.textContent()));
      await panel.getByRole("button", { name: "Issue", exact: true }).click();
      await panel.getByRole("button", { name: "Issue invoice" }).click();
      // The list refreshes at once, so wait for the database rather than the passing message.
      for (let i = 0; i < 20 && !(await query(`SELECT 1 FROM client_invoices WHERE "eventId" = $1 AND status = 'ISSUED'`, [ev.id])).length; i++) await page.waitForTimeout(500);
      const [inv] = await query(`SELECT id, number, total, cgst, sgst FROM client_invoices WHERE "eventId" = $1 AND status = 'ISSUED' ORDER BY "createdAt" DESC`, [ev.id]);
      check("issuing gives a gap-free number and splits the tax", /^TT-\d\d-\d\d-\d{4}$/.test(inv.number) && Number(inv.cgst) === 8550 && Number(inv.sgst) === 8550 && Number(inv.total) === 112100, `${inv.number} ${inv.total}`);
      await page.screenshot({ path: `${out}/i0-booking-invoices.png`, fullPage: true });

      await page.goto(`${BASE}/invoices/client/${inv.id}`);
      const sheet = await page.locator("article").textContent();
      check("the printable invoice has the legal details", /Tax invoice/i.test(sheet) && sheet.includes(inv.number) && /GSTIN 08AAACT1234A1Z1/.test(sheet) && /SAC/.test(sheet) && /998596/.test(sheet));
      check("the total is written in words", /Rupees One Lakh Twelve Thousand One Hundred only/.test(sheet));
      check("bank details are printed", /50200012345678/.test(sheet));
      await page.screenshot({ path: `${out}/i1-invoice-print.png`, fullPage: true });
      await page.emulateMedia({ media: "print" });
      check("the menu is hidden when printing", !(await page.getByRole("link", { name: "Money" }).first().isVisible()));
      await page.emulateMedia({ media: "screen" });

      const res = await page.request.get(`${BASE}/api/v1/exports?kind=sales&from=2026-04-01&to=2027-03-31`);
      check("the sales register downloads", res.ok() && /spreadsheetml/.test(res.headers()["content-type"] || ""), String(res.status()));
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${BASE}/bookings/${wedding.id}?tab=money`);
      check("managers never see client invoices", (await panelOf(page, /^Client GST invoices/).count()) === 0);
      const [inv] = await query(`SELECT id FROM client_invoices WHERE "eventId" = $1 AND status = 'ISSUED'`, [ev.id]);
      await page.goto(`${BASE}/invoices/client/${inv.id}`);
      check("a manager can't open an invoice", (await page.locator("article").count()) === 0);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98000 00001", PHONE);
      await page.goto(money);
      const panel = panelOf(page, /^Client GST invoices/);
      await panel.getByRole("button", { name: "Cancel", exact: true }).click();
      await panel.locator('input[name^="cancel-"]').fill("Checking the cancel flow");
      await panel.getByRole("button", { name: "Cancel invoice" }).click();
      await panel.getByText(/Cancelled: Checking the cancel flow/).waitFor({ timeout: 10000 });
      check("an owner cancels it on a phone; the number stays", (await query(`SELECT count(*)::int AS n FROM client_invoices WHERE "eventId" = $1 AND status = 'CANCELLED' AND number IS NOT NULL`, [ev.id]))[0].n >= 1);
      await page.screenshot({ path: `${out}/i2-cancelled-phone.png`, fullPage: true });
      await setSwitch(page, false);
      await page.goto(money);
      check("switched off again, the panel goes away", (await panelOf(page, /^Client GST invoices/).count()) === 0);
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
