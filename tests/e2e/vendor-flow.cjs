// Browser check: a vendor job from request to sign-off, clicked through by four people.
//   manager asks Roshni Lights to quote → vendor sends a GST quote on a phone → owner approves →
//   manager sends the work order → vendor accepts, starts, finishes → manager signs off.
// Usage: node tests/e2e/vendor-flow.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const scope = `Fort lighting ${Date.now() % 100000}`;
  const BOOKING = "Neha & Vivek pre-wedding shoot";
  let bookingUrl;
  let jobUrl;

  try {
    // Close jobs left open by earlier runs, so the duplicate guard does not refuse this one.
    await query("UPDATE vendor_assignments SET status = 'CANCELLED', \"declineReason\" = 'Earlier test run' WHERE \"scopeOfWork\" LIKE 'Fort lighting %' AND status NOT IN ('COMPLETED', 'CANCELLED')");

    // 1. Manager asks for a quote
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: BOOKING }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      bookingUrl = page.url().split("?")[0];
      await page.goto(`${bookingUrl}?tab=vendors`);
      await page.getByRole("button", { name: "+ Ask a vendor to quote" }).click();
      await page.selectOption('select[name="department"]', { label: "Lighting" });
      await page.selectOption('select[name="vendorId"]', { label: "Roshni Lights · Jaipur" });
      await page.fill('input[name="scopeOfWork"]', scope);
      await page.screenshot({ path: `${out}/20-invite-vendor.png`, fullPage: true });
      await page.getByRole("button", { name: "Send request" }).click();
      await page.getByText(/asked roshni lights|request sent/i).first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.reload();
      const body = await page.textContent("main");
      check("manager invites a vendor to quote", body.includes(scope) && /Invited · no quote yet/.test(body));
      await ctx.close();
    }

    // 2. Vendor sends a quote from a phone
    {
      const { ctx, page } = await signIn("98110 00005", PHONE);
      const home = await page.textContent("main");
      check("vendor sees the new job on their phone", home.includes(scope));
      await page.locator("a", { hasText: scope }).first().click();
      await page.waitForURL(/\/vendor\/jobs\//);
      jobUrl = page.url();
      check("job page asks for a quote", /Please send your quote/.test(await page.textContent("main")));
      await page.fill('input[name="d-0"]', "LED uplighters with operator");
      await page.fill('input[name="q-0"]', "12");
      await page.fill('input[name="u-0"]', "pcs");
      await page.fill('input[name="r-0"]', "1500");
      await page.getByRole("button", { name: "+ Add a line" }).click();
      await page.fill('input[name="d-1"]', "Generator, 25 kVA");
      await page.fill('input[name="r-1"]', "6000");
      const total = await page.locator('dd[aria-live="polite"]').textContent();
      check("quote form adds GST live", /28,320/.test(total), total.trim());
      await page.screenshot({ path: `${out}/21-vendor-quote-form.png`, fullPage: true });
      await page.getByRole("button", { name: "Send quote" }).click();
      await page.getByText(/Quote v1 sent/).waitFor({ timeout: 10000 });
      await page.reload();
      const after = await page.textContent("main");
      check("vendor sees the quote waiting for approval", /Waiting for approval/.test(after) && /28,320/.test(after));
      await page.screenshot({ path: `${out}/22-vendor-quote-sent.png`, fullPage: true });
      await ctx.close();
    }

    // 3. Owner approves it
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/approvals`);
      const card = page.locator("section").filter({ hasText: scope });
      check("owner sees the quote in approvals", (await card.count()) === 1);
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await card.locator('[role="status"]').waitFor({ timeout: 25000 });
      check("owner approves the quote", /approved/i.test(await card.locator('[role="status"]').textContent()));
      await ctx.close();
    }

    // 4. Manager sends the work order
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${bookingUrl}?tab=vendors`);
      const row = page.locator("tr").filter({ hasText: scope });
      check("vendors tab shows the approved quote", /Approved · awaiting vendor/.test(await row.textContent()));
      await row.getByRole("button", { name: "Work order" }).click();
      await row.locator("textarea").fill("50% advance, balance within 7 days of the shoot");
      await row.getByRole("button", { name: "Send work order" }).click();
      await row.getByText(/WO-\d{4}-\d{4}/).first().waitFor({ timeout: 10000 });
      check("manager issues a numbered work order", /WO-\d{4}-\d{4}/.test(await row.textContent()));
      await page.screenshot({ path: `${out}/23-work-order-sent.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Vendor accepts, starts and finishes
    {
      const { ctx, page } = await signIn("98110 00005", PHONE);
      await page.goto(jobUrl);
      const accept = page.getByRole("button", { name: /Accept work order WO-/ });
      check("vendor is asked to accept the work order", (await accept.count()) === 1);
      await page.screenshot({ path: `${out}/24-vendor-accept.png`, fullPage: true });
      await accept.click();
      // The page refreshes in place: the next step appears without a reload.
      await page.getByRole("button", { name: "We've started" }).waitFor({ timeout: 10000 });
      check("accepting shows the next step straight away", /You're booked/.test(await page.textContent("main")));
      await page.getByRole("button", { name: "We've started" }).click();
      await page.getByRole("button", { name: "Work is done" }).waitFor({ timeout: 10000 });
      await page.fill('input[placeholder="All lights tested"]', "All 12 uplighters tested");
      await page.getByRole("button", { name: "Work is done" }).click();
      await page.getByText(/Marked as done/).waitFor({ timeout: 10000 });
      await page.reload();
      const body = await page.textContent("main");
      check("vendor reports start and finish", /The team is checking your work/.test(body) && /All 12 uplighters tested/.test(body));
      await ctx.close();
    }

    // 6. Manager signs off
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${bookingUrl}?tab=vendors`);
      const row = page.locator("tr").filter({ hasText: scope });
      check("vendors tab shows delivered work to check", /Delivered · to check/.test(await row.textContent()));
      await row.getByRole("button", { name: "Sign off" }).click();
      await page.waitForTimeout(1500);
      await page.reload();
      check("manager signs off the job", /Done/.test(await page.locator("tr").filter({ hasText: scope }).textContent()));
      await ctx.close();
    }

    // 7. Vendor sees it signed off
    {
      const { ctx, page } = await signIn("98110 00005", PHONE);
      await page.goto(jobUrl);
      check("vendor sees the sign-off", /Signed off. Thank you!/.test(await page.textContent("main")));
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }

  await browser.close();
  report();
})();
