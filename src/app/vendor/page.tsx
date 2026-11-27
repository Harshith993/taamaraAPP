import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WaitingAnnouncements } from "@/components/messages";
import { ArrowRight, Camera, ChevronRight, FileSignature, PartyPopper, Send } from "lucide-react";
import { PortalShell } from "@/components/portal-shell";
import { EmptyState, IconTile, Panel, Tag, type Tint } from "@/components/ui";
import { db } from "@/lib/db";
import {
  formatCalendarDate,
  formatDate,
  formatINR,
  formatTime,
  todayAsDate,
} from "@/lib/format";
import {
  can,
  paymentWhere,
  vendorAssignmentWhere,
} from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Your jobs" };

const STAGE_WORDS: Record<string, string> = {
  INVITED: "Please send your quote",
  QUOTED: "Quote sent · waiting for approval",
  APPROVED: "Quote approved · accept the work order",
  ACCEPTED: "Booked",
  IN_PROGRESS: "Work in progress",
  DELIVERED: "Delivered · waiting for sign-off",
  COMPLETED: "Completed",
};

/** Stages where the vendor has something to do (quote, or accept a work order). */
const NEEDS_YOU = new Set(["INVITED", "APPROVED"]);

/** What the vendor does next on a job, in plain words, for the "needs you now" cards. */
const NEXT_STEP: Record<string, { verb: string; icon: typeof Send; tint: Tint }> = {
  INVITED: { verb: "Send your quote", icon: Send, tint: "yellow" },
  APPROVED: { verb: "Accept the work order", icon: FileSignature, tint: "violet" },
  IN_PROGRESS: { verb: "Add photos and mark it done", icon: Camera, tint: "sky" },
};

export default async function VendorHome() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  const today = todayAsDate();

  const vendor = actor.vendorIds.length
    ? await db.vendor.findUnique({
        where: { id: actor.vendorIds[0] },
        select: { companyName: true },
      })
    : null;
  const jobs = await db.vendorAssignment.findMany({
    where: {
      AND: [
        vendorAssignmentWhere(actor),
        { status: { notIn: ["DECLINED", "CANCELLED"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true, color: true } },
      event: { select: { name: true, startDate: true, endDate: true } },
      functions: {
        include: {
          function: { include: { venue: { select: { name: true } } } },
        },
      },
      // Their own quotes only (the where above already limits jobs to their vendor).
      quotations: can(actor, "quotes.view")
        ? {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true, total: true, status: true },
          }
        : false,
    },
  });
  const upcoming = jobs.filter(
    (j) => !j.event.endDate || j.event.endDate >= today,
  );
  const past = jobs.filter((j) => j.event.endDate && j.event.endDate < today);
  const todo = upcoming.filter((j) => j.status in NEXT_STEP);

  const paid = can(actor, "payments.status")
    ? await db.payment.aggregate({
        where: { AND: [paymentWhere(actor), { status: "PAID" }] },
        _sum: { amount: true },
      })
    : null;

  return (
    <PortalShell
      title={vendor?.companyName ?? actor.name}
      subtitle="Taamara Taamara · vendor"
    >
      <div className="flex flex-col gap-3.5">
        <section aria-label="What needs you now" className="flex flex-col gap-2.5">
          <h2 className="font-condensed text-[22px] leading-tight">{todo.length ? `${todo.length} thing${todo.length === 1 ? "" : "s"} need${todo.length === 1 ? "s" : ""} you` : "You're all caught up"}</h2>
          {todo.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-[20px] border border-line bg-white p-4 text-[15px] shadow-[var(--shadow-card)]">
              <IconTile tint="green">
                <PartyPopper aria-hidden className="size-5" />
              </IconTile>
              {upcoming.length ? "Nothing to do right now. Your next jobs are below." : "When Taamara Taamara asks you for a quote, it appears here."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {todo.map((j) => {
                const step = NEXT_STEP[j.status];
                return (
                  <li key={j.id}>
                    <Link href={`/vendor/jobs/${j.id}`} className="lift group flex items-center gap-3.5 rounded-[20px] border border-line bg-white p-4 text-ink no-underline shadow-[var(--shadow-card)]">
                      <IconTile tint={step.tint}>
                        <step.icon aria-hidden className="size-5" />
                      </IconTile>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-[16.5px] font-bold">{step.verb}</span>
                        <span className="truncate text-[13.5px] text-ink-quiet">
                          {j.scopeOfWork} · {j.event.name}
                        </span>
                      </span>
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white transition-transform group-hover:translate-x-0.5">
                        <ArrowRight aria-hidden className="size-5" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <WaitingAnnouncements actor={actor} />
        <Panel title={`Upcoming jobs · ${upcoming.length}`}>
          {upcoming.length === 0 ? (
            <EmptyState title="No jobs right now">
              When Taamara Taamara asks you for a quote, it appears here.
            </EmptyState>
          ) : (
            <ul>
              {upcoming.map((j) => {
                const fns = j.functions
                  .map((f) => f.function)
                  .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
                const first = fns[0];
                const quote = Array.isArray(j.quotations)
                  ? j.quotations[0]
                  : undefined;
                return (
                  <li
                    key={j.id}
                    className="border-b border-rule-soft last:border-b-0"
                  >
                    <Link
                      href={`/vendor/jobs/${j.id}`}
                      className={`group relative flex flex-col gap-1.5 px-4 py-3.5 pr-10 text-ink no-underline transition hover:bg-ground ${NEEDS_YOU.has(j.status) ? "border-l-4 border-[#f59e0b]" : ""}`}
                    >
                      <ChevronRight aria-hidden className="absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink-quiet transition-transform group-hover:translate-x-1" />
                      <span className="flex items-center gap-2">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                          style={{ background: j.category?.color ?? "#E6DCCB" }}
                        >
                          {j.category?.name ?? "Job"}
                        </span>
                        <span className="label-mono text-[11px] text-ink-quiet">
                          {STAGE_WORDS[j.status] ?? j.status}
                        </span>
                      </span>
                      <span className="text-[17px] font-bold leading-tight">
                        {j.scopeOfWork}
                      </span>
                      <span className="text-[14px] text-ink-quiet">
                        {j.event.name} ·{" "}
                        {fns.map((f) => f.name).join(", ") ||
                          "date to be confirmed"}
                      </span>
                      {first && (
                        <span className="text-[14px]">
                          <strong>
                            {first.venue?.name ??
                              first.venueText ??
                              "Venue to be confirmed"}
                          </strong>{" "}
                          · {formatDate(first.startsAt)}{" "}
                          {formatTime(first.startsAt)}
                        </span>
                      )}
                      {quote && (
                        <span className="flex items-center gap-2 text-[13.5px]">
                          Your quote v{quote.version}:{" "}
                          <strong className="font-mono">
                            {formatINR(quote.total)}
                          </strong>
                          <Tag
                            tone={
                              quote.status === "APPROVED"
                                ? "ok"
                                : quote.status === "REJECTED"
                                  ? "now"
                                  : "look"
                            }
                          >
                            {quote.status.replace("_", " ")}
                          </Tag>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {paid && (
          <Panel title="Payments">
            <p className="px-3.5 py-3 text-[14.5px]">
              Paid to you so far:{" "}
              <strong className="font-mono">
                {formatINR(paid._sum.amount)}
              </strong>
            </p>
          </Panel>
        )}

        {past.length > 0 && (
          <Panel title={`Past jobs · ${past.length}`}>
            <ul>
              {past.map((j) => (
                <li
                  key={j.id}
                  className="flex justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 text-[14px] last:border-b-0"
                >
                  <span>
                    {j.scopeOfWork} · {j.event.name}
                  </span>
                  <span className="text-ink-quiet">
                    {formatCalendarDate(j.event.endDate)}
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
