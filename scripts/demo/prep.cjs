// Off-camera steps for the demo videos: what the office does between the vendor's scenes, done in a
// headless browser through the real screens (same clicks as tests/e2e/vendor-flow.cjs).
const { BASE, launch, query } = require("../../tests/e2e/lib.cjs");

const BOOKING = "Neha & Vivek pre-wedding shoot";
const SCOPE = "Sunrise shoot lighting";

async function bookingUrl() {
  const [row] = await query("SELECT id FROM events WHERE name = $1", [BOOKING]);
  return `${BASE}/bookings/${row.id}`;
}

async function as(login, fn) {
  const { browser, signIn } = await launch();
  try {
    const { page } = await signIn(login);
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Priya asks Roshni Lights to quote for the shoot's lighting. */
async function inviteQuote() {
  const url = await bookingUrl();
  await as("priya@demo.taamara.in", async (page) => {
    await page.goto(`${url}?tab=vendors`);
    await page.getByRole("button", { name: "+ Ask a vendor to quote" }).click();
    await page.selectOption('select[name="department"]', { label: "Lighting" });
    await page.selectOption('select[name="vendorId"]', { label: "Roshni Lights · Jaipur" });
    await page.fill('input[name="scopeOfWork"]', SCOPE);
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForTimeout(2500);
  });
}

/** The host approves the quote and Priya sends the work order. */
async function approveAndOrder() {
  await as("98000 00001", async (page) => {
    await page.goto(`${BASE}/approvals`);
    const card = page.locator("section").filter({ hasText: SCOPE });
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForTimeout(3000);
  });
  const url = await bookingUrl();
  await as("priya@demo.taamara.in", async (page) => {
    await page.goto(`${url}?tab=vendors`);
    const row = page.locator("tr").filter({ hasText: SCOPE });
    await row.getByRole("button", { name: "Work order" }).click();
    await row.locator("textarea").fill("50% advance, balance within 7 days of the shoot");
    await row.getByRole("button", { name: "Send work order" }).click();
    await row.getByText(/WO-\d{4}-\d{4}/).first().waitFor({ timeout: 10000 });
  });
}

/** The supervisor approves the vendor's proof and Priya signs the job off. */
async function signOff() {
  await as("98000 00006", async (page) => {
    await page.goto(`${BASE}/proof`);
    const approve = page.getByRole("button", { name: "Approve" });
    for (let i = 0; i < 3 && (await approve.count()); i++) {
      const card = page.locator("li, article, section").filter({ hasText: "Roshni" }).filter({ has: approve }).first();
      if (!(await card.count())) break;
      await card.getByRole("button", { name: "Approve" }).first().click();
      await page.waitForTimeout(1500);
    }
  });
  const url = await bookingUrl();
  await as("priya@demo.taamara.in", async (page) => {
    await page.goto(`${url}?tab=vendors`);
    const row = page.locator("tr").filter({ hasText: SCOPE });
    await row.getByRole("button", { name: "Sign off" }).click();
    await page.waitForTimeout(2000);
  });
}

/** Priya writes to Roshni Lights in their job thread, so the vendor has a message to read. */
async function messageVendor(text) {
  await as("priya@demo.taamara.in", async (page) => {
    await page.goto(`${BASE}/messages`);
    await page.locator("a", { hasText: "Roshni Lights" }).first().click();
    await page.waitForURL(/\/messages\//);
    const box = page.locator("textarea").first();
    await box.fill(text);
    await box.press("Enter");
    await page.waitForTimeout(1500);
  });
}

/** Turns on client GST invoices with company details, and fills the shoot client's billing address. */
async function clientInvoicesOn() {
  await as("98000 00001", async (page) => {
    await page.goto(`${BASE}/settings`);
    const box = page.locator("label", { hasText: "Issue GST invoices to clients from the app" }).getByRole("switch");
    if (!(await box.isChecked())) await box.click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.getByText(/Saved|Nothing changed/).first().waitFor({ timeout: 10000 });
    await page.locator('input[name="legalName"]').fill("Taamara Taamara Events LLP");
    await page.locator('input[name="gstin"]').fill("08AAACT1234A1Z1");
    await page.locator('input[name="address"]').fill("14 Bhagwan Das Road, C-Scheme");
    await page.locator('input[name="city"]').fill("Jaipur");
    await page.locator('textarea[name="bankDetails"]').fill("HDFC Bank, C-Scheme\nA/c 50200012345678 · IFSC HDFC0000123");
    await page.getByRole("button", { name: "Save company details" }).click();
    await page.getByText(/Company details saved|Nothing changed/).first().waitFor({ timeout: 10000 });
    await page.goto(`${await bookingUrl()}?tab=money`);
    const panel = page.locator("section", { has: page.getByRole("heading", { name: /^Client GST invoices/ }) }).first();
    await panel.getByRole("button", { name: "Edit billing details" }).click();
    await panel.locator('input[name="address"]').fill("22 Civil Lines");
    await panel.locator('select[name="stateCode"]').selectOption("08");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await panel.getByText("22 Civil Lines").waitFor({ timeout: 10000 });
  });
}

module.exports = { clientInvoicesOn, BOOKING, SCOPE, bookingUrl, as, inviteQuote, approveAndOrder, signOff, messageVendor };
