// Browser check: announcements with "Got it", booking team chat, a vendor thread updating live
// (Server-Sent Events), and the crew chat on a phone.
// Usage: node tests/e2e/messages.cjs <screenshot-dir>
const { BASE, PHONE, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const [wedding] = await query(`SELECT id FROM events WHERE name = 'Aditi & Karan'`);
  const stamp = Date.now() % 100000;
  const panelOf = (page, name) => page.locator("section", { has: page.getByRole("heading", { name }) });
  try {
    // 1. Crew confirm the seeded announcement from their Today screen.
    {
      const { ctx, page } = await signIn("99220 00002", PHONE);
      const please = panelOf(page, /^Please read/);
      check("crew see an announcement waiting on Today", (await please.count()) === 1 && /report at gate 2|bring torches/i.test(await please.textContent()));
      // Confirm everything waiting (earlier runs may have left one).
      for (let i = 0; i < 5 && (await please.getByRole("button", { name: "Got it" }).count()); i++) {
        await please.getByRole("button", { name: "Got it" }).first().click();
        await page.getByText("Thanks, noted.").first().waitFor({ timeout: 10000 });
        await page.reload();
      }
      await page.reload();
      check("after Got it, it no longer waits", (await panelOf(page, /^Please read/).count()) === 0);
      await ctx.close();
    }
    // 2. The supervisor sees who confirmed, and sends one to the booking's crew.
    {
      const { ctx, page } = await signIn("98000 00006");
      await page.getByRole("link", { name: /^Messages/ }).click();
      await page.waitForURL(/\/messages$/);
      const list = panelOf(page, /^Announcements/);
      check("the sender sees how many confirmed", /\d+ of \d+ confirmed/.test(await list.textContent()));
      const form = panelOf(page, "Send an announcement");
      await form.locator('select[name="audience"]').selectOption("BOOKING_CREW");
      await form.locator('select[name="eventId"]').selectOption(wedding.id);
      await form.locator('input[name="title"]').fill(`Pheras: bring torches ${stamp}`);
      await form.locator('textarea[name="body"]').fill("Power backup is late; bring your torches.");
      await form.locator('input[name="needsAck"]').check();
      await form.getByRole("button", { name: "Send announcement" }).click();
      await page.getByText(/Sent\. Everyone it is for has been told/).waitFor({ timeout: 10000 });
      check("the supervisor sends one to the booking's crew", (await query(`SELECT count(*)::int AS n FROM announcements WHERE title = $1`, [`Pheras: bring torches ${stamp}`]))[0].n === 1);
      check("supervisors can't send to everyone", (await form.locator('select[name="audience"] option[value="ALL_STAFF"]').count()) === 0);
      await ctx.close();
    }
    // 3. The manager starts the team chat and messages a vendor; the vendor's reply arrives live.
    {
      const { ctx: mctx, page: m } = await signIn("priya@demo.taamara.in");
      await m.goto(`${BASE}/bookings/${wedding.id}`);
      await m.getByRole("link", { name: "Team chat" }).click();
      await m.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
      await m.getByLabel("Message", { exact: true }).fill(`Seating plan is final ${stamp}`);
      await m.getByRole("button", { name: "Send" }).click();
      await m.getByText(`Seating plan is final ${stamp}`).waitFor({ timeout: 10000 });
      check("the manager writes in the booking team chat", true);

      await m.goto(`${BASE}/bookings/${wedding.id}?tab=vendors`);
      await m.locator("tr", { hasText: "Roshni Lights" }).getByRole("link", { name: "Message" }).click();
      await m.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
      const threadUrl = m.url();
      await m.getByLabel("Message", { exact: true }).fill(`Can you add 4 uplighters? ${stamp}`);
      await m.getByRole("button", { name: "Send" }).click();
      await m.getByText(`Can you add 4 uplighters? ${stamp}`).waitFor({ timeout: 10000 });

      const { ctx: vctx, page: v } = await signIn("98110 00005", PHONE);
      const badge = await v.getByRole("link", { name: /^Messages, \d+ unread/ }).count();
      check("the vendor sees unread messages in the header", badge === 1);
      await v.getByRole("link", { name: /^Messages/ }).click();
      await v.waitForURL(/\/vendor\/messages$/);
      await v.screenshot({ path: `${out}/m-vendor-list.png`, fullPage: true });
      await v.locator("main a", { hasText: "Roshni Lights · Aditi & Karan" }).click();
      await v.getByText(`Can you add 4 uplighters? ${stamp}`).waitFor({ timeout: 10000 });
      check("the vendor reads the manager's message", true);
      check("the vendor can't see the team chat", !(await v.content()).includes(`Seating plan is final ${stamp}`));

      await m.goto(threadUrl);
      await m.waitForTimeout(1500); // let the live stream connect
      await v.getByLabel("Message", { exact: true }).fill(`Yes, done by 4 pm ${stamp}`);
      await v.getByRole("button", { name: "Send" }).click();
      await m.getByText(`Yes, done by 4 pm ${stamp}`).waitFor({ timeout: 8000 });
      check("the reply appears on the manager's screen without reloading", true);
      await v.screenshot({ path: `${out}/m0-vendor-thread-phone.png`, fullPage: true });
      await m.screenshot({ path: `${out}/m1-manager-thread.png`, fullPage: true });
      await vctx.close();
      await mctx.close();
    }
    // 4. Crew chat from Today; the new announcement waits for crew.
    {
      const { ctx, page } = await signIn("99220 00002", PHONE);
      check("the new announcement waits for the crew", /bring torches/.test(await panelOf(page, /^Please read/).textContent()));
      await page.getByRole("link", { name: /^Crew chat/ }).click();
      await page.waitForURL(/\/crew\/messages\/[0-9a-f-]{36}$/);
      await page.getByLabel("Message", { exact: true }).fill(`Reached gate 2 ${stamp}`);
      await page.getByRole("button", { name: "Send" }).click();
      await page.getByText(`Reached gate 2 ${stamp}`).waitFor({ timeout: 10000 });
      check("crew write in the crew chat", true);
      await page.goto(`${BASE}/crew/messages`);
      check("crew see only their crew chat", (await page.locator("main li a[href^='/crew/messages/']").count()) === 1);
      await page.screenshot({ path: `${out}/m2-crew-messages-phone.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
