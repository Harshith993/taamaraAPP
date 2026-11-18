// Browser check: a booking budget, estimate vs actual, changed by the manager and approved by an owner.
// Usage: node tests/e2e/budget.cjs <screenshot-dir>
const { BASE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const what = `Extra security ${Date.now() % 10000}`;
  let url;
  try {
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      url = `${page.url().split("?")[0]}?tab=money`;
      await page.goto(url);
      const panel = page.locator("section", { has: page.getByRole("heading", { name: /^Budget/ }) });
      const text = await panel.textContent();
      check("the approved budget shows estimate vs actual", /Estimate/i.test(text) && /Actual so far/i.test(text) && /Vendor payments/.test(text));
      if (await panel.getByRole("button", { name: "Change the budget" }).count()) await panel.getByRole("button", { name: "Change the budget" }).click();
      await panel.getByText(/Draft v\d/).waitFor({ timeout: 10000 });
      await panel.locator('select[name="categoryId"]').selectOption({ label: "Miscellaneous" });
      await panel.locator('input[name="description"]').fill(what);
      await panel.locator('input[name="estimatedAmount"]').fill("15000");
      await panel.getByRole("button", { name: "Add line" }).click();
      await panel.getByText(what).waitFor({ timeout: 10000 });
      await panel.getByRole("button", { name: "Send to the owners" }).click();
      await panel.getByText("WAITING FOR OWNER").waitFor({ timeout: 10000 });
      check("manager changes the budget and sends it to the owners", true);
      await page.screenshot({ path: `${out}/d0-budget.png`, fullPage: true });
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/approvals`);
      const card = page.locator("section").filter({ hasText: what });
      check("owner sees the budget lines and the earlier total", /Approved before/.test(await card.textContent()));
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await page.waitForTimeout(2500);
      const [b] = await query(`SELECT b.status FROM budgets b JOIN budget_lines l ON l."budgetId" = b.id WHERE l.description = $1`, [what]);
      check("owner approves the new version", b.status === "APPROVED", b.status);
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
