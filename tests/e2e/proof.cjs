// Browser check: work proof from a phone to approval.
//   vendor (phone) sends a photo and a video with location → supervisor approves one, asks to redo the
//   other → vendor sees both → crew sends proof from Today → owner plays the video on the booking.
// Usage: node tests/e2e/proof.cjs <screenshot-dir>
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { BASE, PHONE, launch, checker } = require("./lib.cjs");

const VENUE = { latitude: 26.8985, longitude: 75.8069 };

async function makeMedia() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "taamara-e2e-"));
  const photo = path.join(dir, "IMG_0042.jpg");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="#DD619A"/><rect x="300" y="300" width="2400" height="1400" fill="#F6F0E3"/><circle cx="1500" cy="1000" r="500" fill="#861A41"/></svg>`;
  writeFileSync(photo, await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer());
  const video = path.join(dir, "IMG_0043.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-metadata", "location=+26.8985+075.8069/", video]);
  return { photo, video };
}

(async () => {
  const out = process.argv[2] || "/tmp";
  const { check, report } = checker();
  const { browser, signIn } = await launch();
  const media = await makeMedia();
  const caption = `Mandap ready ${Date.now() % 10000}`;

  try {
    // 1. Vendor sends proof from a phone, with location allowed
    let jobUrl;
    {
      const { ctx, page } = await signIn("98110 00002", { viewport: PHONE, isMobile: true, hasTouch: true, permissions: ["geolocation"], geolocation: VENUE });
      await page.locator("a", { hasText: "Mandap, stage, entrance" }).first().click();
      await page.waitForURL(/\/vendor\/jobs\//);
      jobUrl = page.url();
      check("job page offers Take photo and Record video", (await page.getByRole("button", { name: "Take photo" }).count()) === 1 && (await page.getByRole("button", { name: "Record video" }).count()) === 1);
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(media.photo);
      await page.locator('input[type="file"][accept="video/*"]').setInputFiles(media.video);
      await page.getByRole("button", { name: /Send 2 as proof/ }).waitFor({ timeout: 30000 });
      await page.fill('input[placeholder="Stage drapes done, left side"]', caption);
      await page.screenshot({ path: `${out}/30-vendor-proof-ready.png`, fullPage: true });
      await page.getByRole("button", { name: /Send 2 as proof/ }).click();
      await page.getByText("2 sent. The team will check them.").waitFor({ timeout: 15000 });
      check("vendor sends a photo and a video", true);
      // Processing finishes in the background; the page refreshes itself.
      // Wait for this run's two items to appear with thumbnails (processing runs in the background).
      await page.waitForFunction((c) => [...document.querySelectorAll("main li")].filter((li) => li.textContent.includes(c) && li.querySelector('img[src*="/thumb?"]')).length === 2, caption, { timeout: 60000 });
      const items = await page.locator("main li").filter({ hasText: caption }).allTextContents();
      check("vendor sees both items being checked, with thumbnails", items.length === 2 && items.every((t) => /Sent · being checked/.test(t)));
      check("the venue location was recorded", items.every((t) => /At the venue/.test(t)));
      await page.waitForFunction(() => !document.body.textContent.includes("Preparing…"), null, { timeout: 60000 });
      await page.screenshot({ path: `${out}/31-vendor-proof-sent.png`, fullPage: true });
      await ctx.close();
    }

    // 2. Supervisor checks: approves the photo, asks to redo the video
    {
      const { ctx, page } = await signIn("98000 00006", { width: 820, height: 1180 });
      const badge = await page.locator('nav[aria-label="Main"] a', { hasText: "Proof" }).textContent();
      check("supervisor sees a Proof count in the menu", /Proof\s*\d+/.test(badge), badge.trim());
      await page.goto(`${BASE}/proof`);
      const mine = page.locator("li").filter({ hasText: caption });
      check("supervisor sees the two new items to check", (await mine.count()) === 2);
      await page.screenshot({ path: `${out}/32-proof-queue-ipad.png`, fullPage: true });
      // Checked items leave the "To check" list.
      const photo = mine.filter({ hasNotText: "▶" }).first();
      await photo.getByRole("button", { name: "Approve" }).click();
      await page.waitForFunction((c) => [...document.querySelectorAll("main li")].filter((li) => li.textContent.includes(c)).length === 1, caption, { timeout: 10000 });
      const video = page.locator("li").filter({ hasText: caption }).first();
      await video.getByRole("button", { name: "Ask to redo" }).click();
      await video.locator("textarea").fill("Please show the whole mandap, not only the left side");
      await video.getByRole("button", { name: "Send back" }).click();
      await page.waitForFunction((c) => ![...document.querySelectorAll("main li")].some((li) => li.textContent.includes(c)), caption, { timeout: 10000 });
      check("supervisor approves one and asks to redo the other", true);
      await page.goto(`${BASE}/proof?state=all`);
      const all = await page.locator("li").filter({ hasText: caption }).allTextContents();
      check("both show their outcome under All", all.some((t) => /Approved/.test(t)) && all.some((t) => /Redo asked/.test(t) && /whole mandap/.test(t)));
      await ctx.close();
    }

    // 3. Vendor sees the outcome
    {
      const { ctx, page } = await signIn("98110 00002", PHONE);
      await page.goto(jobUrl);
      const body = await page.textContent("main");
      check("vendor sees the approval and the redo note", /Approved/.test(body) && /The team asked you to redo (one item|\d+ items): .*Please show the whole mandap/.test(body));
      await ctx.close();
    }

    // 4. Crew sends proof from Today
    {
      const { ctx, page } = await signIn("99220 00002", PHONE);
      await page.getByRole("link", { name: "Add proof of work" }).click();
      await page.waitForURL(/\/crew\/proof\?a=/);
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles(media.photo);
      await page.getByRole("button", { name: /Send 1 as proof/ }).waitFor({ timeout: 30000 });
      await page.getByRole("checkbox").uncheck();
      await page.getByRole("button", { name: /Send 1 as proof/ }).click();
      await page.getByText("Sent. The team will check it.").waitFor({ timeout: 15000 });
      check("crew sends a photo from their phone", true);
      await page.waitForFunction(() => document.querySelectorAll('figure img[src*="/thumb?"]').length >= 1, null, { timeout: 30000 });
      await page.screenshot({ path: `${out}/33-crew-proof.png`, fullPage: true });
      await ctx.close();
    }

    // 5. Owner plays the seeded walkthrough video on the booking
    {
      const { ctx, page } = await signIn("98000 00001");
      await page.goto(`${BASE}/bookings`);
      await page.locator("table a", { hasText: "Aditi & Karan" }).first().click();
      await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
      await page.goto(`${page.url().split("?")[0]}?tab=proof`);
      const tiles = await page.locator("figure").count();
      check("owner sees the booking's proof", tiles >= 5, `${tiles} items`);
      await page.screenshot({ path: `${out}/34-booking-proof.png`, fullPage: true });
      await page.locator("li").filter({ hasText: "Setup walkthrough" }).getByRole("button", { name: /Open/ }).click();
      const playing = await page.waitForFunction(() => {
        const v = document.querySelector("dialog[open] video");
        return v && v.readyState >= 2 ? v.videoWidth : false;
      }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => 0);
      check("the video plays in the viewer", playing > 0, `width ${playing}`);
      await page.screenshot({ path: `${out}/35-video-viewer.png` });
      await ctx.close();
    }
  } catch (err) {
    check("flow ran without errors", false, err.message.split("\n")[0]);
  }

  await browser.close();
  report();
})();
