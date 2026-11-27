// Demo video for vendors: the vendor portal on a phone (Roshni Lights, 393×852).
// Usage: node scripts/demo/vendor.cjs <work-dir>   (then scripts/demo/stitch.cjs <work-dir> out.mp4)
// Needs the production server on :3000 and a freshly seeded database (scripts/demo/reset-db.sh).
// The office's steps between scenes (approving the quote, the work order, sign-off) run off camera
// in scripts/demo/prep.cjs.
const path = require("path");
const { Demo } = require("./lib.cjs");
const prep = require("./prep.cjs");
const { makeMedia } = require("./media.cjs");

const VENDOR = "98110 00005";
const NAHARGARH = { latitude: 26.9373, longitude: 75.8155 };
const phoneOptions = { permissions: ["geolocation"], geolocation: NAHARGARH };

(async () => {
  const workDir = process.argv[2] || "/tmp/demo-vendor";
  const demo = new Demo("For vendors", { workDir, frame: "phone" });
  const media = await makeMedia(path.join(workDir, "media"));
  await demo.open();
  const tabs = (d) => d.page.getByRole("navigation", { name: "Sections" });
  const TAB_URLS = { Jobs: "/vendor", Messages: "/vendor/messages", Alerts: "/vendor/notifications", Profile: "/vendor/profile" };
  const openTab = async (d, name) => {
    if (!(await d.click(tabs(d).getByRole("link", { name }), { after: 1500 }))) await d.go(TAB_URLS[name]);
    await d.idle();
  };

  await prep.inviteQuote();

  // Scene 1: sign in, what needs you now, send a quote
  await demo.segment({ device: "phone", intro: true, options: phoneOptions }, async (d) => {
    await d.start("/login", { card: ["Taamara Taamara · for vendors", "Your jobs, on your phone", "A short guide for our vendor partners: quotes, work orders, proof and payments."] });
    await d.page.evaluate(() => sessionStorage.removeItem("tt-intro"));
    await d.page.reload({ waitUntil: "domcontentloaded" });
    await d.wait(3600);

    await d.card("Step 1", "Sign in", "Open the link we send you. Add it to your home screen to use it like an app.");
    await d.caption("Type the <b>mobile number</b> we have for your company.");
    await d.type('input[name="login"]', "98110 00005", { delay: 90 });
    await d.caption("Then your <b>password</b>. Forgot it? Call the office and we'll reset it.", 3200);
    await d.type('input[name="password"]', "Taamara@2026", { delay: 70 });
    await d.click('button[type="submit"]', { after: 300 });
    await d.page.waitForURL(/\/vendor/, { timeout: 20000 });
    await d.idle();
    await d.wait(1200);

    await d.card("Step 2", "What needs you now", "The top of your home screen always shows what to do next.");
    await d.caption("Here: <b>1 thing needs you</b>. We'd like a quote for a new job.");
    await d.point(d.page.getByText(/needs you/i).first(), { hold: 1500 });
    await d.unhl();
    await d.caption("Below it are <b>all your upcoming jobs</b>, with the place, date and time.");
    await d.point(d.page.getByText(/Upcoming jobs/).first(), { hold: 1200 });
    await d.unhl();
    await d.caption("The <b>tab bar</b> at the bottom: Jobs, Messages, Alerts and your Profile.");
    await d.point(tabs(d), { hold: 2200 });
    await d.unhl();

    await d.card("Step 3", "Send a quote", "Add each item and its rate. GST is worked out for you.");
    await d.click(d.page.getByRole("link", { name: /Send your quote/ }), { after: 1500 });
    await d.idle();
    await d.caption("The job shows <b>when and where</b> it is, and who your manager is.");
    await d.scroll(260);
    await d.caption("Fill in the first line: what you'll supply, how many, and the rate.", 3000);
    await d.type('input[name="d-0"]', "LED uplighters with operator", { delay: 45 });
    await d.type('input[name="q-0"]', "12");
    await d.type('input[name="u-0"]', "pcs");
    await d.type('input[name="r-0"]', "1500");
    await d.caption("Need another item? Tap <b>+ Add a line</b>.", 2400);
    await d.click(d.page.getByRole("button", { name: "+ Add a line" }));
    await d.type('input[name="d-1"]', "Generator, 25 kVA", { delay: 45 });
    await d.type('input[name="r-1"]', "6000");
    await d.caption("The <b>total with GST</b> updates as you type.");
    await d.point('dd[aria-live="polite"]', { hold: 1800 });
    await d.unhl();
    await d.click(d.page.getByRole("button", { name: "Send quote" }), { after: 2500 });
    await d.caption("Sent! The team sees it straight away and a host approves it.", 3800);
    await d.scrollTop();
    await d.wait(1200);
  });

  await prep.approveAndOrder();

  // Scene 2: accept the work order, proof, work done
  await demo.segment({ device: "phone", login: VENDOR, options: phoneOptions }, async (d) => {
    await d.start("/vendor", { card: ["Step 4", "Accept the work order", "Once your quote is approved, you get a numbered work order to accept."] });
    await d.caption("Your quote was approved. The home screen now asks you to <b>accept the work order</b>.");
    await d.point(d.page.getByText(/needs you/i).first(), { hold: 1200 });
    await d.unhl();
    await d.click(d.page.locator("a", { hasText: prep.SCOPE }).first(), { after: 1500 });
    await d.idle();
    await d.caption("Check the work order: the amount, the payment terms and the dates.");
    const accept = d.page.getByRole("button", { name: /Accept work order WO-/ });
    await d.point(accept, { hold: 1500 });
    await d.caption("Happy with it? Tap <b>Accept</b>. You're booked!", 2600);
    await d.click(accept, { after: 2500 });

    await d.card("Step 5", "On the day: proof and done", "Tell us when you start, send photos of the setup, and mark the work done.");
    await d.caption("When your team starts at the venue, tap <b>We've started</b>.");
    await d.click(d.page.getByRole("button", { name: "We've started" }), { after: 2500 });
    await d.caption("Now send <b>proof of work</b>: tap <b>Take photo</b> and snap the setup.");
    await d.upload(d.page.getByRole("button", { name: "Take photo" }), media.photo, 'input[type="file"][accept="image/*"]');
    await d.page.getByRole("button", { name: /Send 1 as proof/ }).waitFor({ timeout: 30000 }).catch(() => {});
    await d.caption("Add a short note so the team knows what they're looking at.", 2800);
    await d.type(d.page.locator('input[placeholder="Stage drapes done, left side"]'), "Uplighters on the fort wall", { delay: 45 });
    await d.click(d.page.getByRole("button", { name: /Send 1 as proof/ }), { after: 2500 });
    await d.caption("Sent. The time and place are saved with the photo, and the team checks it.", 3800);
    await d.caption("All finished? Write a line about it and tap <b>Work is done</b>.", 3000);
    await d.type(d.page.locator('input[placeholder="All lights tested"]'), "All 12 uplighters tested", { delay: 45 });
    await d.click(d.page.getByRole("button", { name: "Work is done" }), { after: 2500 });
    await d.page.getByText("The team is checking your work").waitFor({ timeout: 15000 }).catch(() => {});
    await d.caption("Now the team checks your work and signs it off.", 3400);
  });

  await prep.signOff();
  await prep.messageVendor("Lovely work at Nahargarh! Please send your invoice when you're ready.");

  // Scene 3: invoice, payments, messages, alerts, profile
  await demo.segment({ device: "phone", login: VENDOR, options: phoneOptions }, async (d) => {
    await d.start("/vendor", { card: ["Step 6", "Invoices and payments", "Send your invoice from the job, and see what has been paid."] });
    await d.click(d.page.locator("a", { hasText: prep.SCOPE }).first(), { after: 1500 });
    await d.idle();
    await d.caption("The team has <b>signed off</b> your work. Thank you!");
    await d.point(d.page.getByText(/Signed off/).first(), { hold: 1200 });
    await d.unhl();
    const invoices = d.page.locator("section", { has: d.page.getByRole("heading", { name: /^Invoices/ }) });
    await d.point(invoices, { hold: 600, hl: false });
    await d.caption("To get paid, send your <b>invoice</b> here: its number and the amount before GST.");
    await d.type('input[name="invoiceNumber"]', "RL/1187", { delay: 80 });
    await d.type('input[name="taxable"]', "24000");
    await d.caption("Attach the invoice: a PDF, or simply a clear photo of the paper.", 3000);
    const attach = invoices.getByRole("button", { name: /photo|PDF|Choose|Attach/i });
    await d.upload(attach, media.invoice, 'input[aria-label="The invoice (PDF or a clear photo)"]');
    await d.page.getByText(/attached/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await d.click(d.page.getByRole("button", { name: "Send invoice" }), { after: 2500 });
    await d.caption("The accountant checks it against the work order. You'll see its status here.", 3800);

    await openTab(d, "Jobs");
    await d.caption("Back on <b>Jobs</b>, <b>Payments</b> shows what has been paid to you so far.");
    await d.point(d.page.getByText(/Paid to you so far/).first(), { hold: 2000 });
    await d.unhl();

    await d.card("Step 7", "Messages", "Talk to your manager about a job. No more lost WhatsApp threads.");
    await openTab(d, "Messages");
    await d.caption("Each job has its own conversation with the team.");
    await d.click(d.page.locator("main a").filter({ hasText: /Roshni Lights/ }).first(), { after: 1500 });
    await d.idle();
    await d.caption("Priya wrote to you. Type a reply and send it.", 2600);
    const box = d.page.locator("main textarea, main input[type=text]").last();
    await d.type(box, "Thank you! Invoice RL/1187 is sent.", { delay: 50 });
    const send = d.page.getByRole("button", { name: /Send/ }).last();
    if (!(await d.click(send, { after: 1500 }))) await box.press("Enter");
    await d.wait(1500);

    await d.card("Step 8", "Alerts", "New jobs, approvals and payments come to you as alerts.");
    await openTab(d, "Alerts");
    await d.caption("Every alert says what happened. Tap one to open that job.");
    await d.scroll(200);
    await d.wait(800);

    await d.card("Step 9", "Your profile and bank details", "Keep your contact, GST and bank details up to date.");
    await openTab(d, "Profile");
    await d.caption("Your company, contact person, address, <b>GSTIN</b> and PAN.");
    await d.scroll(320);
    await d.caption("Changed bank? Tap <b>Change bank details</b>.", 2400);
    await d.click(d.page.getByRole("button", { name: /bank details/ }), { after: 1200 });
    await d.type('input[name="accountName"]', "Roshni Lights", { delay: 45 });
    await d.type('input[name="accountNumber"]', "38120045679012", { delay: 60 });
    await d.type('input[name="ifsc"]', "SBIN0031234", { delay: 60 });
    await d.click(d.page.getByRole("button", { name: "Save bank details" }), { after: 2200 });
    await d.caption("For your safety, the office <b>calls you to confirm</b> before any payment goes to the new account.", 5200);
    await d.scrollTop();
    await d.page.evaluate(() => window.__demo.card("Thank you", "That's all!", "Questions? Message your manager in the app, or call the Taamara Taamara office."));
    d.marks.push({ t: Date.now(), title: "Thank you", kicker: "" });
    await d.wait(5000);
  });

  await demo.close();
})();
