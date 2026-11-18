// Browser smoke test across roles. Needs the dev server on :3000 with the demo seed.
// Run: node tests/e2e/smoke.cjs <screenshot-dir>
// Signs in as each role, checks what they can see, and saves screenshots.
const { chromium } = require("playwright");
const { resetLoginLimits } = require("./lib.cjs");

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

async function signIn(browser, login, password, viewport) {
  await resetLoginLimits();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  return { ctx, page };
}

const NEW_PHONE = `98${String(Date.now()).slice(-8)}`;

(async () => {
  const browser = await chromium.launch();
  const desk = { width: 1440, height: 1000 };
  const phone = { width: 390, height: 844 };

  // Signed-out visitors go to the login page.
  {
    const ctx = await browser.newContext({ viewport: phone });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/team`);
    check("signed-out visitor is sent to login", page.url().includes("/login"), page.url());
    await page.screenshot({ path: `${OUT}/01-login-phone.png` });
    await page.fill('input[name="login"]', "98000 00001");
    await page.fill('input[name="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    const alert = await page.locator('form [role="alert"]').first().textContent().catch(() => "");
    check("wrong password shows a clear message", /don't match/.test(alert || ""), alert);
    await ctx.close();
  }

  // Owner (phone typed with spaces)
  {
    const { ctx, page } = await signIn(browser, "98000 00001", "Taamara@2026", desk);
    check("owner lands on /home", page.url().endsWith("/home"), page.url());
    const body = await page.textContent("main");
    check("owner sees all 4 upcoming bookings", /4 upcoming bookings/.test(body), (body.match(/\d+ upcoming bookings?[^·]*/) || [""])[0]);
    check("owner sees client billing", /received ₹/.test(body));
    check("owner sees approvals", /Approvals waiting · 3/.test(body));
    check("owner has Team in menu", (await page.locator('nav[aria-label="Main"] a', { hasText: "Team" }).count()) === 1);
    await page.screenshot({ path: `${OUT}/02-owner-home.png`, fullPage: true });
    await page.goto(`${BASE}/team`);
    await page.waitForLoadState("networkidle");
    check("owner opens Team", /People · \d+/.test(await page.textContent("main")));
    await page.screenshot({ path: `${OUT}/03-team.png`, fullPage: true });
    await page.goto(`${BASE}/team/roles`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/04-roles.png` });

    // Add a new supervisor and sign in as them
    await page.goto(`${BASE}/team`);
    await page.fill('input[name="name"]', "Test Supervisor");
    await page.fill('input[name="phone"]', NEW_PHONE);
    await page.selectOption('select[name="roleKey"]', "SUPERVISOR");
    await page.fill('input[name="temporaryPassword"]', "Marigold-1234");
    await page.click('button:has-text("Add person")');
    await page.waitForTimeout(1500);
    const added = await page.locator('[role="status"]').first().textContent().catch(() => "");
    check("owner adds a supervisor", /Added Test Supervisor/.test(added || ""), (added || "").slice(0, 80));
    await ctx.close();
  }

  // New supervisor's first sign-in forces a new password
  {
    const { ctx, page } = await signIn(browser, NEW_PHONE, "Marigold-1234", phone);
    check("first sign-in goes to set-password", page.url().includes("/set-password"), page.url());
    await page.screenshot({ path: `${OUT}/05-set-password-phone.png` });
    await page.fill('input[name="current"]', "Marigold-1234");
    await page.fill('input[name="next"]', "MyOwn-Pass-99");
    await page.fill('input[name="confirm"]', "MyOwn-Pass-99");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    check("after setting a password they reach home", page.url().endsWith("/home"), page.url());
    const body = await page.textContent("main");
    check("new supervisor sees no bookings yet", /0 upcoming bookings assigned to you/.test(body), (body.match(/\d+ upcoming[^·]*/) || [""])[0]);
    await page.goto(`${BASE}/team`);
    await page.waitForLoadState("networkidle");
    check("supervisor cannot open Team", page.url().includes("/home?denied=1"), page.url());
    await ctx.close();
  }

  // Event manager: assigned bookings only, no billing
  {
    const { ctx, page } = await signIn(browser, "priya@demo.taamara.in", "Taamara@2026", desk);
    const body = await page.textContent("main");
    check("manager sees only assigned bookings (3)", /3 upcoming bookings assigned to you/.test(body), (body.match(/\d+ upcoming[^·]*/) || [""])[0]);
    check("manager does not see client billing", !/received ₹/.test(body) && /hidden from your role/.test(body));
    check("manager has no Team in menu", (await page.locator('nav[aria-label="Main"] a', { hasText: "Team" }).count()) === 0);
    await page.screenshot({ path: `${OUT}/06-manager-home.png`, fullPage: true });
    await ctx.close();
  }

  // Vendor on a phone
  {
    const { ctx, page } = await signIn(browser, "+91 98110 00005", "Taamara@2026", phone);
    check("vendor lands on /vendor", page.url().endsWith("/vendor"), page.url());
    const body = await page.textContent("main");
    check("vendor sees their lighting job and own quote", /Full venue lighting/.test(body) && /Your quote v2/.test(body));
    check("vendor does not see other vendors", !/Prakash|Gulmohar|Annapurna/.test(body));
    await page.screenshot({ path: `${OUT}/07-vendor-phone.png`, fullPage: true });
    await page.goto(`${BASE}/home`);
    await page.waitForLoadState("networkidle");
    check("vendor cannot open the internal app", page.url().endsWith("/vendor"), page.url());
    await ctx.close();
  }

  // Crew on a phone
  {
    const { ctx, page } = await signIn(browser, "9922000002", "Taamara@2026", phone);
    check("crew lands on /crew", page.url().endsWith("/crew"), page.url());
    const body = await page.textContent("main");
    check("crew sees their next shift", /Your next shift/.test(body) && /Report by/.test(body));
    check("crew sees own pay incl. waiting extra", /waiting for approval/.test(body));
    await page.screenshot({ path: `${OUT}/08-crew-phone.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();
  console.log(results.join("\n"));
  console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks passed`);
})();
