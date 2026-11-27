import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it } from "vitest";
import type { OutgoingNotification } from "@/modules/notifications/delivery";
import { emailContent, sesEmailDriver } from "@/modules/notifications/drivers/email";

const n: OutgoingNotification = {
  id: "n1",
  userId: "u1",
  type: "approval.requested",
  title: "Payment waiting: <Annapurna> ₹1,20,000",
  body: "Aditi & Karan",
  link: "/approvals",
  user: { name: "Radhika", email: "radhika@example.in", hasRealEmail: true, phoneNumber: null },
};

describe("email through Amazon SES (Phase 10)", () => {
  it("says only what the bell says, with an absolute link, and escapes the HTML", () => {
    const c = emailContent(n, "https://app.taamara.in");
    expect(c.subject).toBe("Payment waiting: <Annapurna> ₹1,20,000");
    expect(c.text).toContain("Open it: https://app.taamara.in/approvals");
    expect(c.html).toContain("&lt;Annapurna&gt;");
    expect(c.html).toContain("Aditi &amp; Karan");
    expect(c.html).not.toContain("<Annapurna>");
  });

  it("sends one email to the person, from the company address", async () => {
    const ses = mockClient(SESv2Client);
    ses.on(SendEmailCommand).resolves({ MessageId: "m1" });
    const driver = sesEmailDriver({ from: "Taamara Taamara <no-reply@taamara.in>", appUrl: "https://app.taamara.in", client: new SESv2Client({ region: "ap-south-1" }) });
    expect(driver.channel).toBe("email");
    await driver.deliver(n);
    const calls = ses.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({ FromEmailAddress: "Taamara Taamara <no-reply@taamara.in>", Destination: { ToAddresses: ["radhika@example.in"] } });
    ses.restore();
  });

  it("a failure is thrown, so the outbox tries again later", async () => {
    const ses = mockClient(SESv2Client);
    ses.on(SendEmailCommand).rejects(new Error("Throttling"));
    const driver = sesEmailDriver({ from: "no-reply@taamara.in", appUrl: "https://app.taamara.in", client: new SESv2Client({ region: "ap-south-1" }) });
    await expect(driver.deliver(n)).rejects.toThrow(/Throttling/);
    ses.restore();
    expect(() => sesEmailDriver({ from: "", appUrl: "x" })).toThrow(/EMAIL_FROM/);
  });
});
