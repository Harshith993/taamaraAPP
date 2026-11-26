// Browser check: owner approves a crew extra and the crew app shows the new pay. Needs dev server + demo seed.
const { chromium } = require("playwright");
const { resetLoginLimits } = require("./lib.cjs");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
(async () => {
  const browser = await chromium.launch();
  const out = process.argv[2];
  const signIn = async (login, viewport) => {
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
  const { ctx, page } = await signIn("98000 00001", { width: 1440, height: 1100 });
  await page.goto(`${BASE}/approvals`);
  await page.waitForLoadState("networkidle");
  console.log("heading:", await page.textContent("h1"));
  await page.screenshot({ path: `${out}/09-approvals.png`, fullPage: true });
  console.log("sections:", await page.locator("section").count(), "approve buttons:", await page.getByRole("button", { name: "Approve", exact: true }).count());
  const crewCard = page.locator("section").filter({ has: page.getByRole("heading", { name: /crew pay extra/i }) });
  console.log("crew cards:", await crewCard.count());
  await crewCard.getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForTimeout(1500);
  console.log("crew card:", (await crewCard.locator('[role="status"]').textContent().catch(() => "")) || "(no status)");
  await ctx.close();

  const crew = await signIn("9922000002", { width: 390, height: 844 });
  const body = await crew.page.textContent("main");
  console.log("crew pay shows", /₹1,500/.test(body) ? "₹1,500 (900 + approved 600)" : "unexpected", "| waiting text gone:", !/waiting for approval/.test(body));
  await crew.ctx.close();
  await browser.close();
})();
