import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Notice, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import {
  formatCalendarDate,
  formatDate,
  formatINR,
  formatTime,
} from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";
import { getJob } from "@/modules/vendors/jobs";
import { ProofGrid } from "@/components/proof-grid";
import { ProofUploader } from "@/components/proof-uploader";
import { listProof, openRedoRequests } from "@/modules/proof/service";
import { todayInIndia } from "@/lib/format";
import { invoicesForJob, workOrderBalance } from "@/modules/vendors/invoices";
import { AcceptWorkOrder, DeclineJob, ProgressButton } from "./job-actions";
import { InvoiceForm } from "./invoice-form";
import { QuoteForm } from "./quote-form";

export const metadata: Metadata = { title: "Job" };

const QUOTE_TONE = {
  SUBMITTED: "look",
  APPROVED: "ok",
  REJECTED: "now",
  REVISION_REQUESTED: "plum",
  WITHDRAWN: "quiet",
} as const;
const QUOTE_WORDS = {
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  REVISION_REQUESTED: "Please revise",
  WITHDRAWN: "Replaced",
} as const;

const INVOICE_WORDS: Record<string, string> = {
  SUBMITTED: "Being checked",
  VERIFIED: "Checked · waiting for payment",
  APPROVED: "Approved for payment",
  PART_PAID: "Part paid",
  PAID: "Paid",
  DISPUTED: "Please correct",
  VOID: "Cancelled",
};

/** The one thing the vendor should do next, in plain words. */
function nextStep(job: Awaited<ReturnType<typeof getJob>>) {
  const openWO = job.workOrders.find((w) => w.status === "ISSUED");
  switch (job.status) {
    case "INVITED":
      return job.quotes[0]?.status === "REVISION_REQUESTED"
        ? { tone: "look", text: "Please send a revised quote." }
        : { tone: "look", text: "Please send your quote." };
    case "QUOTED":
      return {
        tone: "info",
        text: "Quote sent. The owners will approve it or ask for changes.",
      };
    case "APPROVED":
      return openWO
        ? {
            tone: "look",
            text: `Your quote is approved. Please accept work order ${openWO.number}.`,
          }
        : {
            tone: "info",
            text: "Your quote is approved. The work order is on its way.",
          };
    case "ACCEPTED":
      return {
        tone: "info",
        text: "You're booked. Tap “We've started” when work begins on site.",
      };
    case "IN_PROGRESS":
      return {
        tone: "info",
        text: "Work in progress. Tap “Work is done” when you finish.",
      };
    case "DELIVERED":
      return {
        tone: "info",
        text: "Marked done. The team is checking your work.",
      };
    case "COMPLETED":
      return { tone: "ok", text: "Signed off. Thank you!" };
    case "DECLINED":
      return {
        tone: "info",
        text: `You declined this job${job.declineReason ? `: ${job.declineReason}` : "."}`,
      };
    case "CANCELLED":
      return {
        tone: "info",
        text: `This job was withdrawn${job.declineReason ? `: ${job.declineReason}` : "."}`,
      };
  }
}

export default async function VendorJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  const { id } = await params;
  let job;
  try {
    job = await getJob(db, actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const proofOpen = ["ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED"].includes(job.status);
  const proof = proofOpen ? await listProof(db, actor, { target: { kind: "vendorJob", id: job.id } }) : [];
  const redo = openRedoRequests(proof);
  const acceptedWO = job.workOrders.find((w) => w.status === "ACKNOWLEDGED" || w.status === "CLOSED");
  const invoices = acceptedWO ? await invoicesForJob(db, actor, job.id) : [];
  const balance = acceptedWO ? await workOrderBalance(db, acceptedWO.id) : null;
  const approvedQuote = job.quotes.find((q) => q.status === "APPROVED");
  const step = nextStep(job);
  const latest = job.quotes[0];
  const openWO = job.workOrders.find((w) => w.status === "ISSUED");
  const canQuote =
    can(actor, "quotes.submit") &&
    (job.status === "INVITED" || job.status === "QUOTED");
  const responds = can(actor, "jobs.respond");

  return (
    <PortalShell
      title={job.vendor}
      subtitle="Taamara Taamara · vendor"
      back={{ href: "/vendor", label: "All jobs" }}
    >
      <div className="flex flex-col gap-3.5">
        <section className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            {job.department && (
              <span
                className="px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase"
                style={{ background: job.department.color }}
              >
                {job.department.name}
              </span>
            )}
            <span className="label-mono text-[11px] text-ink-quiet">
              {job.event.name}
            </span>
          </span>
          <h1 className="font-condensed text-[34px] leading-[0.95] uppercase">
            {job.scope}
          </h1>
          {job.reportingAt && (
            <p className="text-[15px]">
              Report at{" "}
              <strong className="font-mono">
                {formatTime(job.reportingAt)}
              </strong>{" "}
              on{" "}
              {formatDate(job.reportingAt, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          )}
        </section>

        {step && (
          <Notice tone={step.tone === "ok" ? "ok" : "info"}>{step.text}</Notice>
        )}

        {openWO && responds && job.status === "APPROVED" && (
          <Panel title={`Work order ${openWO.number}`}>
            <div className="flex flex-col gap-3 px-3.5 py-3">
              <p className="text-[15px]">
                Amount{" "}
                <strong className="font-mono text-[18px]">
                  {formatINR(openWO.amount)}
                </strong>
              </p>
              {openWO.terms && (
                <p className="text-[14px] whitespace-pre-line">
                  {openWO.terms}
                </p>
              )}
              <AcceptWorkOrder jobId={job.id} number={openWO.number} />
            </div>
          </Panel>
        )}

        {responds &&
          (job.status === "ACCEPTED" || job.status === "IN_PROGRESS") && (
            <Panel title="On the day">
              <div className="px-3.5 py-3">
                {/* Keyed by stage so the next button appears as soon as the page refreshes. */}
                <ProgressButton
                  key={job.status}
                  jobId={job.id}
                  stage={
                    job.status === "ACCEPTED" ? "IN_PROGRESS" : "DELIVERED"
                  }
                />
              </div>
            </Panel>
          )}

        {proofOpen && (
          <Panel title={`Photos and videos of the work${proof.length ? ` · ${proof.length}` : ""}`}>
            <div className="flex flex-col gap-3 p-3.5">
              {redo.length > 0 && (
                <Notice tone="error">
                  The team asked you to redo {redo.length === 1 ? "one item" : `${redo.length} items`}: {redo.map((r) => r.reviewNote).join(" · ")}
                </Notice>
              )}
              {can(actor, "proof.upload") && job.status !== "COMPLETED" && (
                <ProofUploader
                  target={{ kind: "vendorJob", id: job.id }}
                  allowGallery={actor.switches.proofFromGallery}
                  maxVideoSeconds={actor.switches.maxVideoSeconds}
                  prompt="Send photos or a short video of the finished setup. The manager or supervisor checks them; payment needs approved proof."
                />
              )}
              {proof.length > 0 && <ProofGrid items={proof} showAbout={false} uploaderView />}
            </div>
          </Panel>
        )}

        <Panel title={`When and where · ${job.functions.length}`}>
          <ul>
            {job.functions.map((f) => (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-rule-soft px-3.5 py-3 last:border-b-0"
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-[16px] font-bold">{f.name}</span>
                  <span className="text-[14px]">
                    {f.venue ?? "Venue to be confirmed"}
                  </span>
                  {f.address && (
                    <span className="text-[13px] text-ink-quiet">
                      {f.address}
                    </span>
                  )}
                  {f.mapUrl && (
                    <a
                      href={f.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 text-[13.5px] font-semibold"
                    >
                      Open map
                    </a>
                  )}
                </span>
                <span className="text-right font-mono text-[13px]">
                  {formatDate(f.startsAt, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  <br />
                  {formatTime(f.startsAt)}
                  {f.endsAt ? `–${formatTime(f.endsAt)}` : ""}
                  {f.guests ? (
                    <>
                      <br />
                      {f.guests} guests
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {job.requirements.length > 0 && (
          <Panel title="What's needed">
            <ul>
              {job.requirements.map((r) => (
                <li
                  key={r.id}
                  className="border-b border-rule-soft px-3.5 py-2.5 text-[14.5px] last:border-b-0"
                >
                  <strong>{r.title}</strong>
                  {r.quantity
                    ? ` · ${r.quantity}${r.unit ? ` ${r.unit}` : ""}`
                    : ""}
                  {r.description && (
                    <span className="block text-[13px] text-ink-quiet">
                      {r.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {canQuote && (
          <Panel title={latest ? "Send a new quote" : "Your quote"}>
            {job.status === "QUOTED" && (
              <p className="border-b border-rule-soft px-3.5 py-2.5 text-[13.5px] text-ink-quiet">
                Sending a new quote replaces the one that is waiting.
              </p>
            )}
            {latest?.reviewNote && latest.status === "REVISION_REQUESTED" && (
              <p className="border-b border-rule-soft bg-look/20 px-3.5 py-2.5 text-[14px]">
                <span className="label-mono text-[11px]">What to change</span>
                <br />
                {latest.reviewNote}
              </p>
            )}
            <QuoteForm
              jobId={job.id}
              isRevision={Boolean(latest)}
              startFrom={latest?.items ?? []}
            />
          </Panel>
        )}

        {responds && (job.status === "INVITED" || job.status === "QUOTED") && (
          <DeclineJob jobId={job.id} />
        )}

        {job.quotes.length > 0 && (
          <Panel title={`Your quotes · ${job.quotes.length}`}>
            <ul>
              {job.quotes.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-col gap-1.5 border-b border-rule-soft px-3.5 py-3 last:border-b-0"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-semibold">
                      v{q.version} ·{" "}
                      {formatDate(q.createdAt, {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <Tag tone={QUOTE_TONE[q.status]}>
                      {QUOTE_WORDS[q.status]}
                    </Tag>
                  </span>
                  <table className="w-full text-[13.5px]">
                    <tbody>
                      {q.items.map((i, n) => (
                        <tr key={n}>
                          <td className="py-0.5 pr-2">
                            {i.description}
                            <span className="text-ink-quiet">
                              {" "}
                              · {i.quantity}
                              {i.unit ? ` ${i.unit}` : ""} × {formatINR(i.rate)}{" "}
                              · GST {i.gstRate}%
                            </span>
                          </td>
                          <td className="py-0.5 text-right font-mono">
                            {formatINR(i.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-right text-[13.5px]">
                    GST {formatINR(q.tax)} ·{" "}
                    <strong className="font-mono text-[15px]">
                      Total {formatINR(q.total)}
                    </strong>
                  </p>
                  {q.validUntil && (
                    <p className="text-[12.5px] text-ink-quiet">
                      Valid until {formatCalendarDate(q.validUntil)}
                    </p>
                  )}
                  {q.reviewNote && q.status !== "REVISION_REQUESTED" && (
                    <p className="text-[13px]">
                      Note from Taamara Taamara: {q.reviewNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {job.workOrders.length > 0 &&
          !(openWO && job.status === "APPROVED") && (
            <Panel title="Work order">
              {job.workOrders.map((w) => (
                <p key={w.id} className="px-3.5 py-3 text-[14.5px]">
                  <strong className="font-mono">{w.number}</strong> ·{" "}
                  {formatINR(w.amount)} ·{" "}
                  {w.status === "ACKNOWLEDGED"
                    ? `accepted ${w.acknowledgedAt ? formatDate(w.acknowledgedAt, { day: "numeric", month: "short" }) : ""}`
                    : w.status.toLowerCase()}
                  {w.terms && (
                    <span className="block text-[13px] text-ink-quiet whitespace-pre-line">
                      {w.terms}
                    </span>
                  )}
                </p>
              ))}
            </Panel>
          )}

        {acceptedWO && balance && (
          <Panel title={`Invoices${invoices.length ? ` · ${invoices.length}` : ""}`}>
            {invoices.length > 0 && (
              <ul>
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-col gap-1 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold">
                        {inv.number} · {formatCalendarDate(inv.date, { day: "numeric", month: "short" })}
                      </span>
                      <Tag tone={inv.status === "VERIFIED" || inv.status === "APPROVED" || inv.status === "PAID" ? "ok" : inv.status === "DISPUTED" ? "now" : inv.status === "VOID" ? "quiet" : "look"}>
                        {INVOICE_WORDS[inv.status] ?? inv.status}
                      </Tag>
                    </span>
                    <span className="text-[13.5px]">
                      {formatINR(inv.taxable)} + GST {formatINR(inv.gst)} = <strong className="font-mono">{formatINR(inv.total)}</strong>
                      {inv.file?.originalUrl && (
                        <>
                          {" · "}
                          <a href={inv.file.originalUrl} target="_blank" rel="noopener">
                            View file
                          </a>
                        </>
                      )}
                    </span>
                    {inv.note && <span className={`text-[13px] ${inv.status === "DISPUTED" ? "font-semibold text-now" : "text-ink-quiet"}`}>{inv.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {can(actor, "quotes.submit") && balance.left > 0.5 ? (
              <div className={`px-3.5 py-3 ${invoices.length ? "border-t-2 border-ink" : ""}`}>
                <p className="mb-3 text-[13.5px] text-ink-quiet">
                  {acceptedWO.number}: {formatINR(balance.amount)}, invoiced {formatINR(balance.invoiced)} so far. Send an invoice for the advance or the balance.
                </p>
                <InvoiceForm jobId={job.id} left={balance.left} defaultGstRate={approvedQuote?.items[0]?.gstRate ?? 18} today={todayInIndia()} />
              </div>
            ) : (
              <p className="px-3.5 py-3 text-[13.5px] text-ink-quiet">The whole work order ({formatINR(balance.amount)}) has been invoiced.</p>
            )}
          </Panel>
        )}

        <Panel title="Your contacts">
          <ul className="text-[14.5px]">
            {job.team.map((t) => (
              <li
                key={`${t.role}-${t.name}`}
                className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0"
              >
                <span>
                  <span className="label-mono text-[11px] text-ink-quiet">
                    {t.role === "MANAGER" ? "Manager" : "On site"}
                  </span>
                  <br />
                  <strong>{t.name}</strong>
                </span>
                {t.phone && (
                  <a
                    href={`tel:${t.phone}`}
                    className="inline-flex min-h-11 items-center rounded-[3px] border-2 border-ink px-3 font-mono text-[13px] font-semibold no-underline"
                  >
                    {formatPhone(t.phone)}
                  </a>
                )}
              </li>
            ))}
            {job.host && (
              <li className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span>
                  <span className="label-mono text-[11px] text-ink-quiet">
                    Host
                  </span>
                  <br />
                  <strong>{job.host.name}</strong>
                </span>
                {job.host.phone && (
                  <span className="font-mono text-[13px]">
                    {formatPhone(job.host.phone)}
                  </span>
                )}
              </li>
            )}
          </ul>
        </Panel>

        {job.progress.length > 0 && (
          <Panel title="Updates">
            <ul>
              {job.progress.map((p, i) => (
                <li
                  key={i}
                  className="flex justify-between gap-3 border-b border-rule-soft px-3.5 py-2 text-[14px] last:border-b-0"
                >
                  <span>{p.note}</span>
                  <span className="font-mono text-[12px] text-ink-quiet">
                    {formatDate(p.createdAt, {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    {formatTime(p.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}
