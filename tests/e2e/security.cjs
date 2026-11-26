// Browser check: the Content-Security-Policy is sent with a fresh nonce, pages still work under it,
// and no page triggers a CSP violation. Run against a production build for the real policy.
// Usage: node tests/e2e/security.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

const PAGES = {
  "98000 00001": ["/home", "/bookings", "/calendar", "/money", "/approvals", "/messages", "/settings", "/vendors", "/roster", "/proof", "/expenses", "/team", "/notifications"],
  "98110 00005": ["/vendor", "/vendor/messages", "/vendor/profile"],
  "99220 00002": ["/crew", "/crew/messages", "/crew/me"],
};

(async () => {
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  try {
    const a = await fetch(`${BASE}/login`);
    const b = await fetch(`${BASE}/login`);
    const csp = a.headers.get("content-security-policy") || "";
    const nonceOf = (h) => (h.match(/'nonce-([^']+)'/) || [])[1];
    check("the login page sends a Content-Security-Policy", /script-src 'self' 'nonce-/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp));
    check("each request gets a new nonce", nonceOf(csp) && nonceOf(csp) !== nonceOf(b.headers.get("content-security-policy") || ""));
    const html = await a.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    check("every script on the page carries the nonce", scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonceOf(csp)}"`)), `${scripts.length} scripts`);
    check("other security headers are present", a.headers.get("x-frame-options") === "DENY" && a.headers.get("x-content-type-options") === "nosniff");

    for (const [login, paths] of Object.entries(PAGES)) {
      const { ctx, page } = await signIn(login, login.startsWith("98000") ? undefined : PHONE);
      const violations = [];
      page.on("console", (m) => {
        if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(`${page.url()}: ${m.text().slice(0, 160)}`);
      });
      await page.exposeFunction("__cspViolation", (v) => violations.push(v));
      await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(`${location.pathname}: ${e.violatedDirective} ${e.blockedURI}`)));
      for (const p of paths) {
        await page.goto(`${BASE}${p}`);
        await page.waitForLoadState("networkidle");
      }
      check(`no CSP violations on ${paths.length} pages for ${login}`, violations.length === 0, violations.slice(0, 3).join(" | "));
      await ctx.close();
    }

    // The outside accountant (D56): money only, and every sign-in is in the audit log.
    {
      const before = await query(`SELECT count(*)::int AS n FROM audit_log l JOIN users u ON u.id = l."actorId" WHERE u.email = 'accounts@demo.taamara.in' AND l.action = 'sign-in'`);
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      const after = await query(`SELECT count(*)::int AS n FROM audit_log l JOIN users u ON u.id = l."actorId" WHERE u.email = 'accounts@demo.taamara.in' AND l.action = 'sign-in'`);
      check("the accountant's sign-in is audited", after[0].n === before[0].n + 1, `${before[0].n} → ${after[0].n}`);
      const nav = await page.getByRole("navigation", { name: "Main" }).textContent();
      check("the accountant's menu is money only", /Money/.test(nav) && /Invoices/.test(nav) && !/Crew|Proof|Event day/.test(nav), nav.replace(/\s+/g, " ").trim());
      const blocked = [];
      for (const p of ["/roster", "/proof", "/event-day"]) {
        await page.goto(`${BASE}${p}`);
        if (!/\/home/.test(page.url())) blocked.push(p);
      }
      check("crew, proof and event day pages send the accountant home", blocked.length === 0, blocked.join(", "));
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a").first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      const tabs = await page.getByRole("navigation", { name: "Booking sections" }).textContent();
      check("a booking shows the accountant its money but not crew, proof or docs", /Money/.test(tabs) && !/Crew|Proof|Docs|Schedule|Needs/.test(tabs), tabs.replace(/\s+/g, " ").trim());
      await ctx.close();
    }

    // Client-side code runs under the policy: a button that needs JavaScript still works.
    const { ctx, page } = await signIn("98000 00001");
    await page.goto(`${BASE}/messages`);
    const before = await page.locator('select[name="audience"]').inputValue();
    await page.locator('select[name="audience"]').selectOption("ALL_STAFF");
    check("interactive parts work (React hydrated under the policy)", before !== "ALL_STAFF" && (await page.locator('select[name="eventId"]').count()) === 0);
    await ctx.close();
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
