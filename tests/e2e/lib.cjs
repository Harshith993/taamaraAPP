// Shared helpers for the browser checks. They need the dev server on :3000 with the demo seed.
require("dotenv/config");
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const PASSWORD = "Taamara@2026";

/** The login rate limit (8 sign-ins per 5 minutes per IP) trips when several scripts run back to back. Development database only. */
async function resetLoginLimits() {
  const url = process.env.DATABASE_URL;
  if (!url || !/_(dev|restore)$/.test(new URL(url).pathname.replace(/^\//, ""))) return;
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DELETE FROM rate_limits");
  await client.end();
}

async function query(sql, params = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

function checker() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    return ok;
  };
  const report = () => {
    console.log(results.join("\n"));
    const passed = results.filter((r) => r.startsWith("PASS")).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    if (passed !== results.length) process.exitCode = 1;
  };
  return { check, report };
}

async function launch() {
  const browser = await chromium.launch();
  const signIn = async (login, viewport = { width: 1440, height: 1000 }) => {
    await resetLoginLimits();
    // Either a plain viewport, or full context options (with a viewport key).
    const ctx = await browser.newContext(viewport.viewport ? viewport : { viewport });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="login"]', login);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    return { ctx, page };
  };
  return { browser, signIn };
}

const PHONE = { width: 390, height: 844 };
const IPAD = { width: 820, height: 1180 };

module.exports = { BASE, PHONE, IPAD, launch, checker, query, resetLoginLimits };
