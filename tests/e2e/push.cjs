// Browser check: web push is ready to switch on (Phase 10). Needs the app started with VAPID keys
// (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). Subscribing itself needs the browser's push service on the
// internet, so it is not done here; tests/push.test.ts covers sending.
// Usage: node tests/e2e/push.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  try {
    const sw = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
    const js = await sw.text();
    check("the service worker is served without signing in", sw.status === 200 && /javascript/.test(sw.headers.get("content-type") || "") && /showNotification/.test(js), String(sw.status));
    for (const [login, path] of [["99220 00002", "/crew/notifications"], ["98110 00005", "/vendor/notifications"], ["98000 00001", "/notifications"]]) {
      const { ctx, page } = await signIn(login, { viewport: PHONE, permissions: ["notifications"] });
      await page.goto(`${BASE}${path}`);
      const box = page.getByRole("region", { name: "Notifications on this device" });
      const shown = await box.waitFor({ timeout: 10000 }).then(() => true, () => false);
      check(`${path} offers notifications on this device`, shown && (await box.getByRole("button", { name: "Turn on" }).count()) === 1);
      const registered = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/sw.js")));
      check(`${path} registers the service worker`, registered);
      if (path === "/crew/notifications") await page.screenshot({ path: `${out}/p0-push-toggle.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
