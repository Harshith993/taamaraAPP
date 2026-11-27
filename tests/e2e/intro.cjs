// Browser check: the opening intro (the lotus blooms, then flies into the header).
//   plays on the first page of a session, ends with the logo in the header and nothing covering the
//   page, doesn't play again in the same session, can be skipped with a tap, is short with reduced
//   motion, and isn't shown to automated browsers unless asked for (so other checks aren't slowed).
// Usage: node tests/e2e/intro.cjs <screenshot-dir>
const { chromium, devices } = require("playwright");
const { BASE, checker, resetLoginLimits } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const browser = await chromium.launch();
  const state = () => document.documentElement.className;
  const overlayShown = () => getComputedStyle(document.getElementById("tt-intro")).display !== "none";
  try {
    // Automated browsers skip it by default.
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      check("automated browsers don't see the intro", !(await page.evaluate(overlayShown)));
      await ctx.close();
    }

    // A phone, first visit: it plays and hands over to the page.
    {
      const ctx = await browser.newContext({ ...devices["iPhone 15"] });
      await ctx.addInitScript(() => (window.__ttForceIntro = true));
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      check("the intro is there from the first paint", await page.evaluate(overlayShown));
      check("the page's own logo waits while it plays", (await page.locator("[data-brand-mark]").first().evaluate((el) => getComputedStyle(el).opacity)) === "0");
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}/i0-intro-bloom.png` });
      await page.waitForFunction(() => !document.documentElement.classList.contains("tt-intro"), null, { timeout: 4000 });
      await page.waitForTimeout(300);
      check("it ends with nothing covering the page", !(await page.evaluate(overlayShown)));
      check("the logo is back in its place", (await page.locator("[data-brand-mark]").first().evaluate((el) => getComputedStyle(el).opacity)) === "1");
      check("the page can be used straight after", await page.locator('input[name="login"]').isEditable());
      check("no errors while it plays", errors.length === 0, errors.slice(0, 2).join(" | "));
      await page.screenshot({ path: `${out}/i1-intro-after.png` });
      await page.reload();
      check("it doesn't play again in the same session", !(await page.evaluate(overlayShown)));
      await ctx.close();
    }

    // A tap skips it.
    {
      const ctx = await browser.newContext({ ...devices["iPad Mini"] });
      await ctx.addInitScript(() => (window.__ttForceIntro = true));
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      const t = Date.now();
      await page.mouse.click(200, 300);
      await page.waitForFunction(() => !document.documentElement.classList.contains("tt-intro"), null, { timeout: 4000 });
      check("a tap skips it", Date.now() - t < 1300, `${Date.now() - t} ms`);
      await ctx.close();
    }

    // Reduced motion: short and still.
    {
      const ctx = await browser.newContext({ reducedMotion: "reduce" });
      await ctx.addInitScript(() => (window.__ttForceIntro = true));
      const page = await ctx.newPage();
      const t = Date.now();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !document.documentElement.classList.contains("tt-intro"), null, { timeout: 4000 });
      check("with reduced motion it is over in under a second", Date.now() - t < 1500, `${Date.now() - t} ms`);
      await ctx.close();
    }

    // Signed in: it lands in the app's header.
    {
      await resetLoginLimits();
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await page.fill('input[name="login"]', "98000 00001");
      await page.fill('input[name="password"]', "Taamara@2026");
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/home/);
      await ctx.addInitScript(() => (window.__ttForceIntro = true));
      const fresh = await ctx.newPage();
      await fresh.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
      check("signed in, it plays over the home page", await fresh.evaluate(overlayShown));
      await fresh.waitForFunction(() => !document.documentElement.classList.contains("tt-intro"), null, { timeout: 4000 });
      check("then the home page is ready", /Good (morning|afternoon|evening)/.test(await fresh.textContent("main")) && !(await fresh.evaluate(state)).includes("tt-intro "));
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
