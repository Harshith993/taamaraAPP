// Browser check: vendor invoice from a phone to the accountant's check.
// Usage: node tests/e2e/invoices.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const number = `GD/${Date.now() % 100000}`;
  const pdf = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "invoice.pdf");
  writeFileSync(pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

  try {
    // 1. Vendor sends an invoice for the advance
    let jobUrl;
    {
      const { ctx, page } = await signIn("98110 00002", PHONE);
      await page.locator("a", { hasText: "Mandap, stage, entrance" }).first().click();
      await page.waitForURL(/\/vendor\/jobs\//);
      jobUrl = page.url();
      const panel = page.locator("section", { has: page.getByRole("heading", { name: /^Invoices/ }) });
      check("job page offers an invoice form with the work order balance", /WO-\d{4}-\d{4}: ₹4,20,000, invoiced ₹0 so far/.test(await panel.textContent()));
      await page.fill('input[name="invoiceNumber"]', number);
      await page.fill('input[name="taxable"]', "100000");
      await page.locator('input[aria-label="The invoice (PDF or a clear photo)"]').setInputFiles(pdf);
      await page.getByText("invoice.pdf · attached").waitFor({ timeout: 20000 });
      check("GST is worked out from the rate", /₹1,18,000/.test(await panel.textContent()));
      await page.screenshot({ path: `${out}/50-vendor-invoice-form.png`, fullPage: true });
      await page.getByRole("button", { name: "Send invoice" }).click();
      await page.getByText(/Invoice sent/).waitFor({ timeout: 15000 });
      await page.reload();
      check("vendor sees the invoice being checked", new RegExp(`${number.replace("/", "\\/")}[\\s\\S]*Being checked`).test(await page.textContent("main")));
      await ctx.close();
    }

    // 2. Accountant checks it
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      const nav = await page.locator('nav[aria-label="Main"] a', { hasText: "Invoices" }).textContent();
      check("accountant sees invoices to check in the menu", /Invoices\s*\d+/.test(nav), nav.trim());
      await page.goto(`${BASE}/invoices`);
      const row = page.locator("li").filter({ hasText: number });
      const text = await row.textContent();
      check("the invoice shows its work order, proof and file", /WO-\d{4}-\d{4}/.test(text) && /approved proof/.test(text) && /Open the invoice \(PDF\)/.test(text));
      const href = await row.getByRole("link", { name: /Open the invoice/ }).getAttribute("href");
      const res = await page.request.get(`${BASE}${href}`);
      check("the invoice file opens for the accountant", res.status() === 200 && res.headers()["content-type"] === "application/pdf", `${res.status()}`);
      await page.screenshot({ path: `${out}/51-invoices.png`, fullPage: true });
      await row.getByRole("button", { name: "Verified" }).click();
      await page.waitForFunction((n) => ![...document.querySelectorAll("main li")].some((li) => li.textContent.includes(n)), number, { timeout: 15000 });
      await page.goto(`${BASE}/invoices?state=VERIFIED`);
      check("verified invoices move to Ready to pay", (await page.locator("li").filter({ hasText: number }).count()) === 1);
      await ctx.close();
    }

    // 3. Vendor sees it checked
    {
      const { ctx, page } = await signIn("98110 00002", PHONE);
      await page.goto(jobUrl);
      check("vendor sees the invoice checked", /Checked · waiting for payment/.test(await page.textContent("main")));
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
