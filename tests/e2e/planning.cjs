// Browser check: planning a booking after it is created.
//   owner puts a supervisor on the team, edits details and a function → manager builds the run sheet
//   and a requirement → supervisor can tick the run sheet but not edit it.
// Usage: node tests/e2e/planning.cjs <screenshot-dir>
const { BASE, IPAD, launch, checker } = require("./lib.cjs");

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const BOOKING = "Sharma Anniversary Dinner";
  const cue = `Guests arrive ${Date.now() % 10000}`;
  let url;

  try {
    // 1. Owner: team, details, function
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/bookings?range=all`);
      await page.locator("table a", { hasText: BOOKING }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      url = page.url().split("?")[0];
      await page.getByRole("button", { name: "Change team" }).click();
      const ramesh = page.locator("fieldset", { hasText: "Supervisors" }).locator("label", { hasText: "Ramesh Kumar" });
      if (!(await ramesh.locator("input").isChecked())) await ramesh.click();
      await page.getByRole("button", { name: "Save team" }).click();
      await page.waitForFunction(() => /Supervisor:\s*Ramesh Kumar/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
      check("owner puts a supervisor on the booking", true);

      await page.getByRole("button", { name: "Edit details" }).click();
      await page.selectOption('select[name="status"]', "CONFIRMED");
      await page.fill('input[name="expectedGuests"]', "70");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => /CONFIRMED/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
      check("owner confirms the booking", true);

      await page.locator('ul li', { hasText: "Anniversary dinner" }).getByRole("button", { name: "Edit" }).click();
      await page.selectOption('select[name="venueId"]', { label: "Hotel Marigold Banquet" });
      await page.fill('input[name="startTime"]', "19:30");
      await page.screenshot({ path: `${out}/60-edit-function.png`, fullPage: true });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const moved = await page
        .waitForFunction(() => {
          const card = document.querySelector('ul[aria-label="Functions"]')?.textContent ?? "";
          return /19:30/.test(card) && /Hotel Marigold Banquet/.test(card);
        }, null, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      check("owner moves the function to a venue and a new time", moved);
      await ctx.close();
    }

    // 2. Manager: run sheet and requirement
    {
      const { ctx, page } = await signIn("priya@demo.taamara.in");
      await page.goto(`${url}?tab=schedule`);
      await page.getByRole("button", { name: "+ Add to the run sheet" }).click();
      await page.fill('input[name="title"]', cue);
      await page.selectOption('select[name="type"]', "CEREMONY");
      await page.fill('input[name="time"]', "19:15");
      await page.check('input[name="crew"]');
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator("li", { hasText: cue }).waitFor({ timeout: 10000 });
      check("manager adds a run sheet item crew can see", /crew see this/.test(await page.locator("li", { hasText: cue }).textContent()));
      await page.locator("li", { hasText: cue }).getByRole("button", { name: "Edit" }).click();
      await page.fill('input[name="location"]', "Hotel lobby");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction((c) => [...document.querySelectorAll("li")].some((li) => li.textContent.includes(c) && li.textContent.includes("Hotel lobby")), cue, { timeout: 10000 });
      check("manager edits the item", true);

      await page.goto(`${url}?tab=needs`);
      await page.getByRole("button", { name: "+ Add a requirement" }).click();
      await page.fill('input[name="title"]', "Live ghazal trio");
      await page.selectOption('select[name="source"]', "CLIENT");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.locator("li", { hasText: "Live ghazal trio" }).first().waitFor({ timeout: 10000 });
      check("manager adds a client requirement", /asked by the client/.test(await page.locator("li", { hasText: "Live ghazal trio" }).first().textContent()));
      await page.screenshot({ path: `${out}/61-needs.png`, fullPage: true });
      await ctx.close();
    }

    // 3. Supervisor: sees the booking, ticks the run sheet, can't edit it
    {
      const { ctx, page } = await signIn("98000 00006", IPAD);
      await page.goto(`${url}?tab=schedule`);
      const row = page.locator("li", { hasText: cue });
      check("supervisor sees the run sheet without edit buttons", (await row.count()) === 1 && (await row.getByRole("button", { name: "Edit" }).count()) === 0 && (await page.getByRole("button", { name: "+ Add to the run sheet" }).count()) === 0);
      await row.getByRole("button", { name: "Done?" }).click();
      await row.getByRole("button", { name: "✓ Done" }).waitFor({ timeout: 10000 });
      check("supervisor ticks an item off", true);
      await page.screenshot({ path: `${out}/62-run-sheet-supervisor.png`, fullPage: true });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }
  await browser.close();
  report();
})();
