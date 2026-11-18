import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatDate, formatINR, formatTime, todayAsDate } from "@/lib/format";
import { can, paymentWhere, vendorAssignmentWhere } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Your jobs" };

const STAGE_WORDS: Record<string, string> = {
  INVITED: "Please send your quote",
  QUOTED: "Quote sent · waiting for approval",
  APPROVED: "Quote approved · work order coming",
  ACCEPTED: "Booked",
  IN_PROGRESS: "Work in progress",
  DELIVERED: "Delivered · waiting for sign-off",
  COMPLETED: "Completed",
};

export default async function VendorHome() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  const today = todayAsDate();

  const vendor = actor.vendorIds.length ? await db.vendor.findUnique({ where: { id: actor.vendorIds[0] }, select: { companyName: true } }) : null;
  const jobs = await db.vendorAssignment.findMany({
    where: { AND: [vendorAssignmentWhere(actor), { status: { notIn: ["DECLINED", "CANCELLED"] } }] },
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true, color: true } },
      event: { select: { name: true, startDate: true, endDate: true } },
      functions: { include: { function: { include: { venue: { select: { name: true } } } } } },
      // Their own quotes only (the where above already limits jobs to their vendor).
      quotations: can(actor, "quotes.view") ? { orderBy: { version: "desc" }, take: 1, select: { version: true, total: true, status: true } } : false,
    },
  });
  const upcoming = jobs.filter((j) => !j.event.endDate || j.event.endDate >= today);
  const past = jobs.filter((j) => j.event.endDate && j.event.endDate < today);

  const paid = can(actor, "payments.status")
    ? await db.payment.aggregate({ where: { AND: [paymentWhere(actor), { status: "PAID" }] }, _sum: { amount: true } })
    : null;

  return (
    <PortalShell title={vendor?.companyName ?? actor.name} subtitle="Taamara Taamara · vendor">
      <div className="flex flex-col gap-3.5">
        <Panel title={`Upcoming jobs · ${upcoming.length}`}>
          {upcoming.length === 0 ? (
            <EmptyState title="No jobs right now">When Taamara Taamara asks you for a quote, it appears here.</EmptyState>
          ) : (
            <ul>
              {upcoming.map((j) => {
                const fns = j.functions.map((f) => f.function).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
                const first = fns[0];
                const quote = Array.isArray(j.quotations) ? j.quotations[0] : undefined;
                return (
                  <li key={j.id} className="flex flex-col gap-1.5 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                    <span className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase" style={{ background: j.category?.color ?? "#E6DCCB" }}>
                        {j.category?.name ?? "Job"}
                      </span>
                      <span className="label-mono text-[11px] text-ink-quiet">{STAGE_WORDS[j.status] ?? j.status}</span>
                    </span>
                    <span className="text-[17px] font-bold leading-tight">{j.scopeOfWork}</span>
                    <span className="text-[14px] text-ink-quiet">
                      {j.event.name} · {fns.map((f) => f.name).join(", ") || "date to be confirmed"}
                    </span>
                    {first && (
                      <span className="text-[14px]">
                        <strong>{first.venue?.name ?? first.venueText ?? "Venue to be confirmed"}</strong> · {formatDate(first.startsAt)} {formatTime(first.startsAt)}
                      </span>
                    )}
                    {quote && (
                      <span className="flex items-center gap-2 text-[13.5px]">
                        Your quote v{quote.version}: <strong className="font-mono">{formatINR(quote.total)}</strong>
                        <Tag tone={quote.status === "APPROVED" ? "ok" : quote.status === "REJECTED" ? "now" : "look"}>{quote.status.replace("_", " ")}</Tag>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {paid && (
          <Panel title="Payments">
            <p className="px-3.5 py-3 text-[14.5px]">
              Paid to you so far: <strong className="font-mono">{formatINR(paid._sum.amount)}</strong>
            </p>
          </Panel>
        )}

        {past.length > 0 && (
          <Panel title={`Past jobs · ${past.length}`}>
            <ul>
              {past.map((j) => (
                <li key={j.id} className="flex justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 text-[14px] last:border-b-0">
                  <span>
                    {j.scopeOfWork} · {j.event.name}
                  </span>
                  <span className="text-ink-quiet">{formatCalendarDate(j.event.endDate)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}
