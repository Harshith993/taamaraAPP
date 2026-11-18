// Browser check: vendor profile and bank change (with the office's confirmation call); crew "Me".
// Usage: node tests/e2e/self-service.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const acct = `5010${String(Date.now()).slice(-8)}`;
  try {
    let vendorPage;
    {
      const { ctx, page } = await signIn("98110 00005", PHONE);
      await page.getByRole("link", { name: /Your details, GST and bank/ }).click();
      await page.waitForURL(/\/vendor\/profile/);
      await page.getByRole("button", { name: /bank details/ }).click();
      await page.fill('input[name="accountName"]', "Roshni Lights");
      await page.fill('input[name="accountNumber"]', acct);
      await page.fill('input[name="ifsc"]', "SBIN0031234");
      await page.getByRole("button", { name: "Save bank details" }).click();
      await page.getByText("waiting for a confirmation call").waitFor({ timeout: 10000 });
      check("vendor changes their bank details and is told a call will confirm them", new RegExp(acct.slice(-4)).test(await page.textContent("main")));
      await page.screenshot({ path: `${out}/c0-vendor-profile.png`, fullPage: true });
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("accounts@demo.taamara.in");
      await page.goto(`${BASE}/vendors`);
      await page.getByRole("link", { name: "Roshni Lights" }).click();
      await page.waitForURL(/\/vendors\/[0-9a-f-]{36}/);
      vendorPage = page.url();
      check("the office sees the change flagged", /changed their bank details/.test(await page.textContent("main")));
      await page.getByRole("button", { name: /I called them/ }).click();
      await page.getByText("Confirmed. Payments can go ahead.").waitFor({ timeout: 10000 });
      check("accountant confirms after calling", true);
      await ctx.close();
    }
    {
      const { ctx, page } = await signIn("99220 00005", PHONE);
      await page.getByRole("link", { name: /Me: days off/ }).click();
      await page.waitForURL(/\/crew\/me/);
      const d = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);
      await page.fill('input[name="date"]', d);
      await page.fill('input[name="reason"]', "Cousin's wedding");
      await page.getByRole("button", { name: "Not available" }).click();
      await page.getByText("Cousin's wedding").waitFor({ timeout: 10000 });
      check("crew mark a day they can't work", true);
      check("crew can reach the password change", (await page.getByRole("link", { name: "Change my password" }).count()) === 1);
      await page.screenshot({ path: `${out}/c1-crew-me.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
