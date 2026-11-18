import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import Link from "next/link";
import { ButtonLink, EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { firstName, formatDate, formatINR, formatTime, todayAsDate, toNumber } from "@/lib/format";
import { can, crewAssignmentWhere, taskWhere } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Today" };

export default async function CrewHome() {
  const actor = await requireActor();
  if (actor.accountType !== "LABOUR") redirect(homePathFor(actor));
  const today = todayAsDate();
  const seesPay = can(actor, "crew.pay.view");

  const [shifts, tasks, assignments] = await Promise.all([
    db.crewShift.findMany({
      where: { assignment: crewAssignmentWhere(actor), date: { gte: today } },
      orderBy: { reportAt: "asc" },
      take: 10,
      include: {
        assignment: { select: { id: true, duty: true, event: { select: { name: true } } } },
        function: { select: { name: true, venueText: true, venue: { select: { name: true, address: true } } } },
      },
    }),
    db.task.findMany({
      where: { AND: [taskWhere(actor), { status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
      orderBy: { dueAt: "asc" },
      take: 6,
      select: { id: true, title: true, dueAt: true, status: true, needsProof: true },
    }),
    seesPay
      ? db.crewAssignment.findMany({
          where: crewAssignmentWhere(actor, "crew.pay.view"),
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { event: { select: { name: true } }, adjustments: { select: { type: true, amount: true, state: true } }, payments: { where: { status: "PAID" }, select: { amount: true } } },
        })
      : Promise.resolve([]),
  ]);

  const [next, ...later] = shifts;

  return (
    <PortalShell title={`Hi ${firstName(actor.name)}`} subtitle={`${formatDate(new Date(), { weekday: "short", day: "numeric", month: "short" })} · ${shifts.length} shift${shifts.length === 1 ? "" : "s"} coming up`}>
      <div className="flex flex-col gap-3.5">
        {next ? (
          <section aria-label="Your next shift" className="overflow-hidden rounded-[4px] border-2 border-ink bg-paper">
            <div className="flex flex-col gap-2.5 p-3.5">
              <span className="label-mono text-[11.5px]">Your next shift</span>
              <span className="text-[17px] leading-tight font-bold">
                {next.assignment.event.name}
                {next.function ? ` · ${next.function.name}` : ""}
              </span>
              <span className="text-[14px] text-ink-quiet">{next.assignment.duty}</span>
              <span className="flex items-end justify-between gap-3">
                <span className="flex flex-col">
                  <span className="label-mono text-[11.5px] text-ink-quiet">Report by</span>
                  <span className="font-condensed text-[64px] leading-[0.85] text-plum tabular-nums">{formatTime(next.reportAt)}</span>
                </span>
                <span className="text-right text-[13px] text-ink-quiet">{formatDate(next.reportAt, { weekday: "long", day: "numeric", month: "short" })}</span>
              </span>
              <span className="text-[15px]">
                <strong>{next.function?.venue?.name ?? next.function?.venueText ?? "Venue to be confirmed"}</strong>
                {next.location ? ` · ${next.location}` : ""}
              </span>
            </div>
            {can(actor, "proof.upload") && (
              <div className="px-3.5 pb-3.5">
                <ButtonLink href={`/crew/proof?a=${next.assignment.id}`} variant="look" className="min-h-[58px] w-full text-[13px]">
                  Add proof of work
                </ButtonLink>
              </div>
            )}
            <div className={`flex min-h-[34px] items-center px-3.5 font-mono text-[12px] font-semibold tracking-[0.04em] ${next.attendance === "PRESENT" ? "bg-ok" : "bg-ground"}`}>
              {next.attendance === "PRESENT" ? `CHECKED IN${next.checkInAt ? ` ${formatTime(next.checkInAt)}` : ""}` : "NOT CHECKED IN YET"}
            </div>
          </section>
        ) : (
          <Panel title="Shifts">
            <EmptyState title="No shifts coming up">When you are booked for an event it appears here.</EmptyState>
          </Panel>
        )}

        {later.length > 0 && (
          <Panel title="Later">
            <ul>
              {later.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 text-[14px] last:border-b-0">
                  <span>
                    <strong>{s.assignment.event.name}</strong>
                    {s.function ? ` · ${s.function.name}` : ""}
                  </span>
                  <span className="font-mono text-[13px]">
                    {formatDate(s.reportAt)} {formatTime(s.reportAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title={`My tasks · ${tasks.length}`}>
          {tasks.length === 0 ? (
            <EmptyState title="No tasks" />
          ) : (
            <ul>
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                  <span className="flex flex-col leading-tight">
                    {t.needsProof && can(actor, "proof.upload") ? (
                      <Link href={`/crew/proof?t=${t.id}`} className="text-[15px] font-semibold">
                        {t.title}
                      </Link>
                    ) : (
                      <span className="text-[15px] font-semibold">{t.title}</span>
                    )}
                    <span className="text-[13px] text-ink-quiet">
                      {t.dueAt ? `By ${formatTime(t.dueAt)}, ${formatDate(t.dueAt)}` : "No deadline"}
                      {t.needsProof ? " · needs a photo" : ""}
                    </span>
                  </span>
                  <Tag tone={t.status === "UNDER_REVIEW" ? "look" : "outline"}>{t.status === "UNDER_REVIEW" ? "REVIEW" : "TO DO"}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {seesPay && assignments.length > 0 && (
          <Panel title="My pay">
            <ul>
              {assignments.map((a) => {
                const extras = a.adjustments.filter((x) => x.state === "APPROVED").reduce((sum, x) => sum + (x.type === "EXTRA" ? 1 : -1) * toNumber(x.amount), 0);
                const waiting = a.adjustments.filter((x) => x.state === "PENDING");
                const paid = a.payments.reduce((sum, p) => sum + toNumber(p.amount), 0);
                const total = toNumber(a.agreedPay) + extras;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                    <span className="flex flex-col leading-tight">
                      <span className="text-[15px] font-semibold">{a.event.name}</span>
                      <span className="text-[13px] text-ink-quiet">
                        {paid >= total && total > 0 ? "Paid" : paid > 0 ? `Paid ${formatINR(paid)} so far` : "Paid after the event"}
                        {waiting.length ? ` · ${waiting.map((w) => `+${formatINR(w.amount)} waiting for approval`).join(", ")}` : ""}
                      </span>
                    </span>
                    <span className="font-condensed text-[30px] leading-none text-plum">{formatINR(total)}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}
