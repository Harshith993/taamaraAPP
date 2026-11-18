// Browser check: the bell and the notifications list, for the owner, a vendor and a crew member.
// Usage: node tests/e2e/notifications.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  try {
    for (const [login, path, viewport] of [["98000 00001", "/notifications", { width: 1440, height: 900 }], ["98110 00005", "/vendor/notifications", PHONE], ["99220 00002", "/crew/notifications", PHONE]]) {
      const { ctx, page } = await signIn(login, viewport);
      const bell = page.getByRole("link", { name: /^Notifications/ });
      const label = await bell.getAttribute("aria-label");
      const before = Number(/(\d+) unread/.exec(label)?.[1] ?? 0);
      check(`${login}: the bell shows unread notifications`, before > 0, label);
      await bell.click();
      await page.waitForURL((u) => u.pathname === path);
      const first = page.locator("main li[data-unread] button").first();
      const firstText = (await first.textContent()).trim().slice(0, 40);
      await first.click();
      await page.waitForURL((u) => u.pathname !== path, { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
      const after = Number(/(\d+) unread/.exec(await page.getByRole("link", { name: /^Notifications/ }).getAttribute("aria-label"))?.[1] ?? 0);
      check(`${login}: opening one goes where it points and marks it read`, after === before - 1 && !page.url().endsWith(path), `${firstText} → ${new URL(page.url()).pathname}`);
      if (login.startsWith("98000")) {
        await page.goto(`${BASE}${path}`);
        await page.screenshot({ path: `${out}/90-notifications.png`, fullPage: true });
      }
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
