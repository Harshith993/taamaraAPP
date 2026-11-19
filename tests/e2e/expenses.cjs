// Browser check: an expense from the supervisor's phone to repayment.
// Usage: node tests/e2e/expenses.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const what = `Generator diesel ${Date.now() % 10000}`;
  const bill = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "bill.jpg");
  writeFileSync(bill, await sharp({ create: { width: 900, height: 1400, channels: 3, background: "#FFFCF6" } }).jpeg().toBuffer());
  try {
    {
      const { ctx, page } = await signIn("98000 00006", PHONE);
      await page.goto(`${BASE}/expenses`);
      await page.getByRole("button", { name: "+ Record an expense" }).click();
      await page.selectOption('select[name="eventId"]', { label: "Aditi & Karan" });
      await page.selectOption('select[name="categoryId"]', { index: 1 });
      await page.fill('input[name="amount"]', "2400");
      await page.fill('input[name="description"]', what);
      await page.getByRole("button", { name: "Send for approval" }).click();
      await page.getByText(/Attach the bill/).first().waitFor({ timeout: 10000 });
      check("a bill is needed above ₹500", true);
      await page.locator('input[type="file"]').setInputFiles(bill);
      await page.getByText("bill.jpg · attached").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Send for approval" }).click();
      await page.getByText("Sent to the hosts for approval.").waitFor({ timeout: 10000 });
      check("supervisor records an expense with the bill from a phone", true);
      await page.screenshot({ path: `${out}/b0-expenses-phone.png`, fullPage: true });
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/approvals`);
      const card = page.locator("section").filter({ hasText: what });
      check("owner sees the expense with its receipt", (await card.getByRole("link", { name: "Open the receipt" }).count()) === 1);
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await page.waitForFunction((t) => ![...document.querySelectorAll("section")].some((s) => s.textContent.includes(t) && s.querySelector("button")), what, { timeout: 15000 }).catch(() => {});
      const [e] = await query(`SELECT status FROM expenses WHERE description = $1`, [what]);
      check("owner approves it", e.status === "APPROVED", e.status);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/expenses?state=APPROVED`);
      const row = page.locator("li", { hasText: what });
      await row.getByRole("button", { name: "Repay" }).click();
      await row.locator('input[name^="rr-"]').fill("UPI-5521");
      await row.getByRole("button", { name: "Repaid", exact: true }).click();
      await page.getByText("Marked as repaid.").waitFor({ timeout: 10000 }).catch(() => {});
      const [e] = await query(`SELECT status FROM expenses WHERE description = $1`, [what]);
      check("accountant repays it", e.status === "REIMBURSED", e.status);
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
