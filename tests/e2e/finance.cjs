// Browser check: money from invoice to payment, a crew extra to payment, and client money.
//   accountant prepares a vendor payment → owner approves → accountant marks it paid → vendor told;
//   supervisor asks for a crew extra → owner approves → accountant pays the crew member;
//   owner adds a client charge and records a receipt; a manager sees costs but no client money.
// Usage: node tests/e2e/finance.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const tag = Date.now() % 100000;
  const invNo = `GD/F${tag}`;
  const reason = `Stayed for teardown ${tag}`;
  let moneyUrl;

  try {
    // Setup: a checked Gulmohar invoice on the wedding's work order.
    const [wo] = await query(`SELECT w.id FROM work_orders w JOIN vendor_assignments a ON a.id = w."assignmentId" JOIN vendors v ON v.id = a."vendorId" JOIN events e ON e.id = a."eventId" WHERE v."companyName" = 'Gulmohar Decor' AND e.name = 'Aditi & Karan'`);
    const [vendor] = await query(`SELECT id FROM vendors WHERE "companyName" = 'Gulmohar Decor'`);
    await query(`INSERT INTO vendor_invoices (id, "vendorId", "workOrderId", "invoiceNumber", "invoiceDate", "taxableAmount", "gstAmount", total, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, CURRENT_DATE, 42372.88, 7627.12, 50000, 'VERIFIED', now(), now())`, [vendor.id, wo.id, invNo]);

    // 1. Accountant prepares the payment from the booking's Money tab
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      moneyUrl = `${page.url().split("?")[0]}?tab=money`;
      await page.goto(moneyUrl);
      const row = page.locator("li li", { hasText: invNo }).first();
      await row.getByRole("button", { name: "Prepare payment" }).click();
      await row.getByRole("button", { name: "Send for approval" }).click();
      await page.getByText("Sent to the owners for approval.").waitFor({ timeout: 10000 });
      check("accountant prepares the vendor payment", true);
      await ctx.close();
    }

    // 2. Supervisor asks for a crew extra
    {
      const { ctx, page } = await signIn("98000 00006");
      await page.goto(moneyUrl.replace("tab=money", "tab=crew"));
      check("supervisors have no Money tab", (await page.locator('nav[aria-label="Booking sections"] a', { hasText: "Money" }).count()) === 0);
      const row = page.locator("li", { hasText: "Arjun Prajapat" }).first();
      await row.getByRole("button", { name: "Extra / deduction" }).click();
      await row.locator('input[name="amount"]').fill("200");
      await row.locator('input[name="reason"]').fill(reason);
      await row.getByRole("button", { name: "Ask the owners" }).click();
      await page.getByText("Sent to the owners for approval.").waitFor({ timeout: 10000 });
      check("supervisor asks for a crew extra", true);
      await ctx.close();
    }

    // 3. Owner approves both
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/approvals`);
      for (const text of [invNo, reason]) {
        const card = page.locator("section").filter({ hasText: text });
        await card.getByRole("button", { name: "Approve", exact: true }).click();
        await page.waitForFunction((t) => ![...document.querySelectorAll("section")].some((s) => s.textContent.includes(t) && s.querySelector("button")), text, { timeout: 15000 }).catch(() => {});
      }
      const left = await query(`SELECT count(*)::int n FROM approval_requests WHERE state = 'PENDING' AND (summary LIKE $1 OR summary LIKE $2)`, [`%${invNo}%`, `%${reason}%`]);
      check("owner approves the payment and the extra", left[0].n === 0);
      await ctx.close();
    }

    // 4. Accountant pays both
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/money`);
      const pay = page.locator("li", { hasText: "Gulmohar Decor" }).filter({ hasText: invNo }).first();
      await pay.getByRole("button", { name: "Mark paid" }).click();
      await pay.locator('input[name^="pr-"]').fill(`UTR${tag}`);
      await pay.getByRole("button", { name: "Paid", exact: true }).click();
      // Paid payments leave "Payments to make".
      await page.waitForFunction((n) => ![...document.querySelectorAll("main li")].some((li) => li.textContent.includes(n)), invNo, { timeout: 15000 });
      const [inv] = await query(`SELECT status FROM vendor_invoices WHERE "invoiceNumber" = $1`, [invNo]);
      check("accountant marks the vendor payment paid; the invoice is paid", inv.status === "PAID", inv.status);
      await page.screenshot({ path: `${out}/a0-money.png`, fullPage: true });

      await page.goto(moneyUrl);
      const crew = page.locator("tr", { hasText: "Arjun Prajapat" });
      check("crew register shows the approved extra", /\+₹200/.test(await crew.textContent()) && /approved/.test(await crew.textContent()));
      await crew.getByRole("button", { name: "Pay" }).click();
      await crew.getByRole("button", { name: "Send for approval" }).click();
      // The row then shows the amount waiting (the form goes away once nothing is left to pay).
      const sent = await page
        .waitForFunction(() => [...document.querySelectorAll("tr")].some((tr) => tr.textContent.includes("Arjun Prajapat") && /waiting/.test(tr.textContent)), null, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      check("accountant sends the crew pay for approval", sent);
      await page.screenshot({ path: `${out}/a1-booking-money.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Vendor is told
    {
      const { ctx, page } = await signIn("98110 00002", PHONE);
      await page.goto(`${BASE}/vendor/notifications`);
      check("vendor is told the payment was sent", /Payment sent: ₹50,000/.test(await page.textContent("main")));
      await ctx.close();
    }

    // 6. Owner: client charge and receipt
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(moneyUrl);
      const before = await page.locator("dl").first().textContent();
      await page.getByRole("button", { name: "+ Add a charge" }).click();
      await page.fill('input[name="description"]', `Extra floral arch ${tag}`);
      await page.fill('input[name="amount"]', "25000");
      await page.getByRole("button", { name: "Add charge" }).click();
      await page.locator("li", { hasText: `Extra floral arch ${tag}` }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "+ Record a payment received" }).click();
      await page.fill('input[name="amount"]', "29500");
      await page.fill('input[name="reference"]', `NEFT${tag}`);
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await page.locator("li", { hasText: `NEFT${tag}` }).waitFor({ timeout: 10000 });
      const after = await page.locator("dl").first().textContent();
      check("owner adds a charge and records the client's payment", before !== after);
      await ctx.close();
    }

    // 7. Manager sees costs, never client money
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(moneyUrl);
      const body = await page.textContent("main");
      check("manager sees vendor costs and crew pay", /Vendor costs/.test(body) && /Crew pay/.test(body));
      check("manager never sees client billing, receipts or margin", !/Billed|Received from the client|Client still owes|Margin/.test(body));
      await page.goto(`${BASE}/money`);
      check("manager can't open the Money page", !page.url().endsWith("/money"), page.url());
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
