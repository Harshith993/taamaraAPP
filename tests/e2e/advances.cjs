// Browser check: cash advances (D57).
//   host sees cash with the team on Money → host approves the accountant's advance for Ramesh →
//   accountant hands it over → Ramesh sees the cash on his home screen and records spending with a
//   bill from his phone → host approves the spend and closes the advance → accountant exports.
// Usage: node tests/e2e/advances.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const bill = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "diesel-bill.jpg");
  writeFileSync(bill, await sharp({ create: { width: 900, height: 1400, channels: 3, background: "#FFFCF6" } }).jpeg().toBuffer());
  const PURPOSE = "Generator diesel and tea on the wedding night";
  const what = `Diesel for the generator ${Date.now() % 10000}`;

  try {
    // 1. Host: Money shows the cash each person holds; approves the waiting advance
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/money`);
      const cash = page.getByRole("list", { name: "Company cash held per person" });
      const text = (await cash.textContent().catch(() => "")) || "";
      check("Money shows company cash held per person", /Priya Sharma/.test(text) && /₹8,150/.test(text), text.replace(/\s+/g, " ").slice(0, 120));
      await page.goto(`${BASE}/approvals`);
      const card = page.locator("section").filter({ hasText: PURPOSE });
      check("the accountant's advance waits for a host", (await card.count()) === 1 && /Ramesh Kumar/.test(await card.textContent()));
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await page.waitForFunction((p) => ![...document.querySelectorAll("section")].some((s) => s.textContent.includes(p) && s.querySelector("button")), PURPOSE, { timeout: 15000 }).catch(() => {});
      const [row] = await query(`SELECT status FROM cash_advances WHERE purpose = $1`, [PURPOSE]);
      check("host approves the advance", row?.status === "APPROVED", row?.status);
      await ctx.close();
    }

    // 2. Accountant hands it over
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/advances`);
      await page.screenshot({ path: `${out}/a0-advances-office.png`, fullPage: true });
      const card = page.locator("li").filter({ hasText: PURPOSE }).first();
      await card.getByRole("button", { name: "Mark handed over" }).click();
      await card.getByRole("button", { name: "Handed over" }).click();
      await page.getByText("Handed over.").waitFor({ timeout: 10000 });
      const [row] = await query(`SELECT status FROM cash_advances WHERE purpose = $1`, [PURPOSE]);
      check("accountant marks the cash handed over", row?.status === "GIVEN", row?.status);
      await ctx.close();
    }

    // 3. Ramesh, on his phone: sees the cash and records spending with a bill
    {
      const { ctx, page } = await signIn("98000 00006", PHONE);
      await page.goto(`${BASE}/home?stay=1`);
      const home = await page.textContent("main");
      check("the holder's home screen shows company cash with them", /Company cash with you/.test(home) && /₹5,000/.test(home));
      await page.goto(`${BASE}/advances`);
      await page.getByRole("link", { name: "Record spending" }).first().click();
      await page.waitForURL(/\/expenses\?advance=/);
      await page.selectOption('select[name="categoryId"]', { index: 1 });
      await page.fill('input[name="amount"]', "9000");
      await page.fill('input[name="description"]', what);
      await page.locator('input[type="file"]').setInputFiles(bill);
      await page.getByText("diesel-bill.jpg · attached").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Send for approval" }).click();
      await page.getByText(/Only ₹5,000/).first().waitFor({ timeout: 10000 });
      check("spending can't go over what is left", true);
      await page.fill('input[name="amount"]', "1800");
      await page.getByRole("button", { name: "Send for approval" }).click();
      await page.getByText("Sent to the hosts for approval.").waitFor({ timeout: 10000 });
      const [e] = await query(`SELECT e."paidVia", e."receiptFileId" IS NOT NULL AS bill, a.purpose FROM expenses e JOIN cash_advances a ON a.id = e."cashAdvanceId" WHERE e.description = $1`, [what]);
      check("the spend is recorded against the advance, with its bill", e?.paidVia === "CASH_ADVANCE" && e.bill && e.purpose === PURPOSE, JSON.stringify(e));
      await page.screenshot({ path: `${out}/a1-holder-expense.png`, fullPage: true });
      await ctx.close();
    }

    // 4. Host approves the spend, then closes the advance with the rest returned
    {
      const { ctx, page } = await signIn("98000 00002");
      await page.goto(`${BASE}/approvals`);
      const card = page.locator("section").filter({ hasText: what });
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await page.waitForFunction((t) => ![...document.querySelectorAll("section")].some((s) => s.textContent.includes(t) && s.querySelector("button")), what, { timeout: 15000 }).catch(() => {});
      await page.goto(`${BASE}/advances`);
      const adv = page.locator("li").filter({ hasText: PURPOSE }).first();
      check("the advance shows ₹3,200 left", /₹3,200 left/.test(await adv.textContent()));
      await adv.getByRole("button", { name: "Close", exact: true }).click();
      await adv.getByRole("button", { name: "Close the advance" }).click();
      await page.getByText(/Closed: ₹1,800 spent, ₹3,200 returned/).waitFor({ timeout: 10000 }).catch(async () => {
        throw new Error(`closing didn't confirm: ${((await adv.textContent()) || "").replace(/\s+/g, " ").slice(-200)}`);
      });
      const [row] = await query(`SELECT status, "returnedAmount"::float AS r FROM cash_advances WHERE purpose = $1`, [PURPOSE]);
      check("host closes the advance with the rest returned", row?.status === "CLOSED" && row.r === 3200, JSON.stringify(row));
      await page.screenshot({ path: `${out}/a2-advances-closed.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Accountant exports the advances
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const res = await page.request.get(`${BASE}/api/v1/exports?kind=advances&from=2026-01-01&to=${today}`);
      check("the accountant downloads the cash advances export", res.status() === 200 && /spreadsheetml/.test(res.headers()["content-type"] || ""), String(res.status()));
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }

  await browser.close();
  report();
})();
