/**
 * Email through Amazon SES in Mumbai (Phase 10, D44): off unless EMAIL_DRIVER=ses. Each person also
 * chooses per kind of notification (email is off by default), and only people with a real email
 * address get any.
 *
 *   EMAIL_DRIVER=ses  EMAIL_FROM="Taamara Taamara <no-reply@taamara.in>"  AWS_REGION=ap-south-1
 *   APP_URL (or BETTER_AUTH_URL) makes the link in each email absolute.
 *
 * The email says only what the bell says (title, a line of text, a link). Nothing else from the
 * app is put in emails, so nothing private sits in someone's inbox.
 */
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { DeliveryDriver, OutgoingNotification } from "../delivery";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emailContent(n: OutgoingNotification, appUrl: string) {
  const link = n.link ? new URL(n.link, appUrl).toString() : appUrl;
  const subject = n.title.slice(0, 180);
  const text = [`Hi ${n.user.name},`, "", n.title, ...(n.body ? [n.body] : []), "", `Open it: ${link}`, "", "Taamara Taamara · You can turn these emails off in the app."].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#16141f;line-height:1.5">
<p>Hi ${escape(n.user.name)},</p>
<p style="font-size:17px;font-weight:600;margin:0">${escape(n.title)}</p>
${n.body ? `<p style="margin:4px 0 0">${escape(n.body)}</p>` : ""}
<p><a href="${escape(link)}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:999px;background:#16141f;color:#fff;text-decoration:none">Open in the app</a></p>
<p style="color:#6b6880;font-size:12.5px">Taamara Taamara · You can turn these emails off in the app.</p>
</div>`;
  return { subject, text, html };
}

export function sesEmailDriver(opts: { from: string; appUrl: string; client?: SESv2Client; region?: string }): DeliveryDriver {
  if (!opts.from) throw new Error("EMAIL_FROM is not set.");
  const client = opts.client ?? new SESv2Client({ region: opts.region ?? "ap-south-1" });
  return {
    channel: "email",
    async deliver(n) {
      const { subject, text, html } = emailContent(n, opts.appUrl);
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: opts.from,
          Destination: { ToAddresses: [n.user.email] },
          Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } } } },
        }),
      );
    },
  };
}
