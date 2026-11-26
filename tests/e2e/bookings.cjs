// Browser checks for bookings across roles. Needs the dev server on :3000 with the demo seed.
const { chromium } = require("playwright");
const { resetLoginLimits } = require("./lib.cjs");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

(async () => {
  const browser = await chromium.launch();
  const out = process.argv[2];
  const signIn = async (login, viewport = { width: 1440, height: 1000 }) => {
    await resetLoginLimits();
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="login"]', login);
    await page.fill('input[name="password"]', "Taamara@2026");
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");
    return { ctx, page };
  };

  // Owner
  {
    const { ctx, page } = await signIn("98000 00001");
    await page.goto(`${BASE}/bookings`);
    await page.waitForLoadState("networkidle");
    const list = await page.textContent("main");
    check("owner bookings list shows every upcoming booking", /Upcoming · ([4-9]|\d\d)/.test(list));
    await page.screenshot({ path: `${out}/10-bookings-list.png`, fullPage: true });
    await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
    await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
    await page.waitForLoadState("networkidle");
    const overview = await page.textContent("main");
    check("owner overview shows money and client", /Billed to client/.test(overview) && /Anil Gupta/.test(overview));
    await page.screenshot({ path: `${out}/11-booking-overview.png`, fullPage: true });
    await page.click('nav[aria-label="Booking sections"] >> text=Vendors');
    await page.waitForURL(/tab=vendors/);
    await page.waitForLoadState("networkidle");
    const vendors = await page.textContent("main");
    check("owner vendors tab shows quotes", /Roshni Lights/.test(vendors) && /₹4,20,000/.test(vendors));
    await page.screenshot({ path: `${out}/12-booking-vendors.png`, fullPage: true });
    await ctx.close();
  }

  // Manager creates a booking
  {
    const { ctx, page } = await signIn("priya@demo.taamara.in");
    await page.goto(`${BASE}/bookings/new`);
    await page.waitForLoadState("networkidle");
    await page.fill('input[name="name"]', `Kavya & Rohit ${Date.now() % 1000}`);
    await page.selectOption('select[name="categoryId"]', { label: "Wedding" });
    await page.check('input[type="radio"] >> nth=1');
    await page.fill('input[name="clientName"]', "Mahesh Agarwal");
    await page.fill('input[name="clientPhone"]', "98290 11111");
    const d = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() + 41 * 864e5).toISOString().slice(0, 10);
    await page.locator('input[name^="fn-name-"]').first().fill("Sangeet");
    await page.locator('input[name^="fn-date-"]').first().fill(d);
    await page.locator('input[name^="fn-venue-"]').first().fill("Jai Mahal Palace");
    await page.click("text=+ Add another function");
    await page.locator('input[name^="fn-name-"]').nth(1).fill("Wedding");
    await page.locator('input[name^="fn-date-"]').nth(1).fill(d2);
    await page.screenshot({ path: `${out}/13-new-booking.png`, fullPage: true });
    await page.getByRole("button", { name: "Create booking" }).click();
    await page.waitForURL(/\/bookings\/[0-9a-f-]+\?created=1/, { timeout: 15000 }).catch(() => {});
    const body = await page.textContent("main");
    if (!/Booking created/.test(body)) {
      console.log("DEBUG url:", page.url());
      console.log("DEBUG alerts:", await page.locator('main [role="alert"]').allTextContents());
      await page.screenshot({ path: `${out}/debug-create.png`, fullPage: true });
    }
    check("manager creates a two-function booking", /KAVYA & ROHIT/i.test(body) && /Booking created/.test(body), page.url());
    await page.click('nav[aria-label="Booking sections"] >> text=Tasks');
    await page.waitForURL(/tab=tasks/);
    await page.waitForLoadState("networkidle");
    check("checklist tasks were added", /Tasks · 10/.test(await page.textContent("main")));
    await page.goto(`${BASE}/bookings?range=upcoming`);
    check("new booking appears in the manager's list", /Kavya & Rohit/.test(await page.textContent("main")));
    // A booking she is not assigned to stays hidden
    await ctx.close();
  }

  // Supervisor: no money on the vendors tab
  {
    const { ctx, page } = await signIn("98000 00006");
    await page.goto(`${BASE}/bookings`);
    await page.waitForLoadState("networkidle");
    await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
    await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
    await page.click('nav[aria-label="Booking sections"] >> text=Vendors');
    await page.waitForURL(/tab=vendors/);
    await page.waitForLoadState("networkidle");
    const v = await page.textContent("main");
    check("supervisor sees vendors without amounts", /Gulmohar Decor/.test(v) && !/₹/.test(v));
    await page.click('nav[aria-label="Booking sections"] >> text=Overview');
    await page.waitForURL(/tab=overview/);
    await page.waitForLoadState("networkidle");
    check("supervisor overview has no money panel", !/Billed to client|Committed costs/.test(await page.textContent("main")));
    await ctx.close();
  }

  // Manager cannot open a booking she is not on (Kabir's birthday is Aman's)
  {
    const { ctx, page } = await signIn("priya@demo.taamara.in");
    const owner = await signIn("98000 00001");
    await owner.page.goto(`${BASE}/bookings`);
    const href = await owner.page.locator("a", { hasText: "Kabir's 1st Birthday" }).first().getAttribute("href");
    await owner.ctx.close();
    const res = await page.goto(`${BASE}${href}`);
    check("manager gets 'not found' for someone else's booking", res.status() === 404, `status ${res.status()}`);
    await ctx.close();
  }

  await browser.close();
  console.log(results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks passed`);
})();
