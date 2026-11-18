// Browser check: crew from hiring to the event day.
//   manager hires Arjun for the shoot (double-booking warning) → Arjun accepts on his phone →
//   manager adds a task that needs a photo → Arjun sends the photo and marks it done → manager signs
//   it off → event day in night mode: attendance for today's birthday → owner settings.
// Usage: node tests/e2e/crew-day.cjs <screenshot-dir>
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { BASE, PHONE, IPAD, launch, checker, query } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const BOOKING = "Neha & Vivek pre-wedding shoot";
  const taskTitle = `Reflector and stand ready ${Date.now() % 10000}`;
  const photo = path.join(mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-")), "reflector.jpg");
  writeFileSync(photo, await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#F3C644" } }).jpeg().toBuffer());

  try {
    // Start clean: take Arjun off the shoot if an earlier run left him there.
    await query(`UPDATE crew_assignments SET status = 'CANCELLED', "declineReason" = 'Earlier test run' WHERE "workerId" = (SELECT id FROM workers WHERE name = 'Arjun Prajapat') AND "eventId" = (SELECT id FROM events WHERE name = $1)`, [BOOKING]);
    let bookingUrl;

    // 1. Manager hires Arjun
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: BOOKING }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      bookingUrl = page.url().split("?")[0];
      await page.goto(`${bookingUrl}?tab=crew`);
      await page.getByRole("button", { name: "+ Add crew" }).click();
      const option = await page.locator('select[name="workerId"] option', { hasText: "Arjun Prajapat" }).getAttribute("value");
      await page.selectOption('select[name="workerId"]', option);
      check("the form warns that Arjun is busy elsewhere that day", /also booked for Aditi & Karan/.test(await page.locator("form", { hasText: "Add crew" }).textContent()));
      await page.fill('input[name="duty"]', "Lights and reflector");
      await page.fill('input[name="agreedPay"]', "750");
      await page.screenshot({ path: `${out}/40-add-crew.png`, fullPage: true });
      await page.getByRole("button", { name: "Add to booking" }).click();
      await page.getByText(/Added\. Note: Arjun Prajapat is also booked/).waitFor({ timeout: 10000 });
      check("manager adds crew with the warning shown", true);
      const shown = await page
        .waitForFunction(() => [...document.querySelectorAll("main li")].some((li) => li.textContent.includes("Arjun Prajapat") && li.textContent.includes("Not answered")), null, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      check("the new crew member shows as not answered", shown);
      await ctx.close();
    }

    // 2. Arjun accepts on his phone
    {
      const { ctx, page } = await signIn("99220 00005", PHONE);
      const offer = page.locator('section[aria-label^="New booking"]').filter({ hasText: BOOKING });
      check("crew sees the new booking with pay", (await offer.count()) === 1 && /₹750/.test(await offer.textContent()));
      await page.screenshot({ path: `${out}/41-crew-offer.png`, fullPage: true });
      await offer.getByRole("button", { name: "Accept" }).click();
      await page.getByText("Accepted. See you there!").waitFor({ timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('section[aria-label^="New booking"]'), null, { timeout: 10000 }).catch(() => {});
      check("accepting removes the offer", (await page.locator('section[aria-label^="New booking"]').filter({ hasText: BOOKING }).count()) === 0);
      await ctx.close();
    }

    // 3. Manager adds a task for Arjun that needs a photo
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${bookingUrl}?tab=crew`);
      check("manager sees Arjun confirmed", /Confirmed/.test(await page.locator("li").filter({ hasText: "Arjun Prajapat" }).first().textContent()));
      await page.goto(`${bookingUrl}?tab=tasks`);
      await page.getByRole("button", { name: "+ Add a task" }).click();
      await page.fill('input[name="title"]', taskTitle);
      const who = await page.locator('select[name="assigneeId"] option', { hasText: "Arjun Prajapat" }).getAttribute("value");
      await page.selectOption('select[name="assigneeId"]', who);
      await page.check('input[name="needsProof"]');
      await page.getByRole("button", { name: "Add task" }).click();
      await page.locator("li", { hasText: taskTitle }).waitFor({ timeout: 10000 });
      check("manager adds a task that needs a photo", true);
      await ctx.close();
    }

    // 4. Arjun sends the photo and marks the task done
    {
      const { ctx, page } = await signIn("99220 00005", PHONE);
      const task = page.locator("li").filter({ hasText: taskTitle });
      check("Done waits for a photo", await task.getByRole("button", { name: "Done" }).isDisabled());
      await task.getByRole("link", { name: "Add photo" }).click();
      await page.waitForURL(/\/crew\/proof\?t=/);
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(photo);
      await page.getByRole("button", { name: /Send 1 as proof/ }).waitFor({ timeout: 30000 });
      await page.getByRole("checkbox").uncheck();
      await page.getByRole("button", { name: /Send 1 as proof/ }).click();
      await page.getByText("Sent. The team will check it.").waitFor({ timeout: 15000 });
      await page.goto(`${BASE}/crew`);
      const again = page.locator("li").filter({ hasText: taskTitle });
      await again.getByRole("button", { name: "Done" }).click();
      await page.waitForFunction((t) => [...document.querySelectorAll("li")].some((li) => li.textContent.includes(t) && li.textContent.includes("BEING CHECKED")), taskTitle, { timeout: 10000 });
      check("crew marks the task done after sending a photo", true);
      await page.screenshot({ path: `${out}/42-crew-today.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Manager signs it off
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${bookingUrl}?tab=tasks`);
      const row = page.locator("li").filter({ hasText: taskTitle });
      await row.getByRole("button", { name: "Sign off" }).click();
      await page.waitForFunction((t) => [...document.querySelectorAll("li")].some((li) => li.textContent.includes(t) && li.textContent.includes("COMPLETED")), taskTitle, { timeout: 10000 });
      check("manager signs the task off", true);
      await ctx.close();
    }

    // 6. Event day for today's birthday (Aman runs it): night mode, attendance
    {
      const { ctx, page } = await signIn("aman@demo.taamara.in", IPAD);
      await page.getByRole("link", { name: "Event day" }).click();
      await page.waitForURL(/\/event-day/);
      const body = await page.textContent("main");
      check("event day shows today's booking, crew and vendors", /Kabir's 1st Birthday/.test(body) && /Vikas Jangid/.test(body) && /Gulmohar Decor/.test(body));
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector("main").parentElement).backgroundColor);
      check("event day is in night mode", bg === "rgb(28, 11, 21)", bg);
      const vikas = page.getByRole("group", { name: "Attendance for Vikas Jangid" });
      await vikas.getByRole("button", { name: "Late" }).click();
      await page.waitForTimeout(1200);
      const marked = await query(`SELECT s.attendance FROM crew_shifts s JOIN crew_assignments a ON a.id = s."assignmentId" JOIN workers w ON w.id = a."workerId" JOIN events e ON e.id = a."eventId" WHERE w.name = 'Vikas Jangid' AND e.name = 'Kabir''s 1st Birthday'`);
      check("marking attendance saves", marked[0]?.attendance === "LATE", marked[0]?.attendance);
      await vikas.getByRole("button", { name: "Present" }).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/43-event-day-ipad.png`, fullPage: true });
      await page.setViewportSize(PHONE);
      await page.screenshot({ path: `${out}/44-event-day-phone.png`, fullPage: true });
      await ctx.close();
    }

    // 7. Supervisor with nothing today sees the next event day
    {
      const { ctx, page } = await signIn("98000 00006", PHONE);
      await page.goto(`${BASE}/event-day`);
      const body = await page.textContent("main");
      check("with nothing today, event day shows the next one", /This is the next event day/.test(body) && /Aditi & Karan/.test(body));
      await ctx.close();
    }

    // 8. Owner settings
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.getByRole("link", { name: "Settings" }).click();
      await page.waitForURL(/\/settings/);
      const box = page.getByRole("switch").first();
      const was = await box.isChecked();
      await box.setChecked(!was);
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.getByText(/Saved\./).waitFor({ timeout: 10000 });
      await box.setChecked(was);
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.getByText(/Saved\./).waitFor({ timeout: 10000 });
      check("owner changes a setting and puts it back", true);
      await page.screenshot({ path: `${out}/45-settings.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }

  await browser.close();
  report();
})();
