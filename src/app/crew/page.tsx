import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RespondButtons } from "@/components/crew-controls";
import { WaitingAnnouncements } from "@/components/messages";
import { PortalShell } from "@/components/portal-shell";
import { TaskButtons } from "@/components/task-controls";
import { Camera, MapPin, MessageCircle, Phone, Sparkles } from "lucide-react";
import { ButtonLink, EmptyState, MovingArrow, Notice, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { firstName, formatDate, formatINR, formatTime, toNumber } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { can, crewAssignmentWhere, taskWhere } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";
import { taskActions } from "@/modules/tasks/service";
import { DocumentList } from "@/components/document-list";
import { crewDocuments } from "@/modules/documents/service";

export const metadata: Metadata = { title: "Today" };

const SHIFT_INCLUDE = {
  assignment: { select: { id: true, duty: true, eventId: true, event: { select: { name: true } } } },
  function: { select: { name: true, venueText: true, venue: { select: { name: true, address: true, mapUrl: true } } } },
} as const;

export default async function CrewHome() {
  const actor = await requireActor();
  if (actor.accountType !== "LABOUR") redirect(homePathFor(actor));
  const now = new Date();
  const seesPay = can(actor, "crew.pay.view");
  const mine = crewAssignmentWhere(actor);

  const [offers, shifts, tasks, assignments] = await Promise.all([
    db.crewAssignment.findMany({
      where: { AND: [mine, { status: "ASSIGNED" }] },
      orderBy: { createdAt: "desc" },
      include: { event: { select: { name: true } }, shifts: { orderBy: { reportAt: "asc" }, include: { function: { select: { name: true, venueText: true, venue: { select: { name: true } } } } } } },
    }),
    // Shifts that are not over yet (a shift stays "current" until 18 hours after reporting).
    db.crewShift.findMany({
      where: { assignment: { AND: [mine, { status: "CONFIRMED" }] }, reportAt: { gte: new Date(now.getTime() - 18 * 3600_000) } },
      orderBy: { reportAt: "asc" },
      take: 10,
      include: SHIFT_INCLUDE,
    }),
    db.task.findMany({
      where: { AND: [taskWhere(actor), { status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
      orderBy: { dueAt: "asc" },
      take: 8,
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        needsProof: true,
        assigneeId: true,
        eventId: true,
        comments: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
        _count: { select: { proofs: { where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } } } } },
      },
    }),
    seesPay
      ? db.crewAssignment.findMany({
          where: { AND: [crewAssignmentWhere(actor, "crew.pay.view"), { status: { in: ["CONFIRMED", "COMPLETED"] } }] },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { event: { select: { name: true } }, adjustments: { select: { type: true, amount: true, state: true } }, payments: { where: { status: "PAID" }, select: { amount: true } } },
        })
      : Promise.resolve([]),
  ]);

  const documents = await crewDocuments(db, actor);
  const [next, ...later] = shifts;
  const contacts = next
    ? await db.eventMember.findMany({
        where: { eventId: next.assignment.eventId },
        orderBy: { role: "desc" },
        select: { role: true, user: { select: { name: true, phoneNumber: true } } },
      })
    : [];
  // India date of a moment, to say "Today" on a shift that reports today.
  const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const isToday = next ? istDay(next.reportAt) === istDay(now) : false;
  const venue = next?.function?.venue;

  return (
    <PortalShell title={`Hi ${firstName(actor.name)}`} subtitle={`${formatDate(now, { weekday: "short", day: "numeric", month: "short" })} · ${shifts.length} shift${shifts.length === 1 ? "" : "s"} coming up`}>
      <div className="flex flex-col gap-3.5">
        <Link href="/crew/me" className="group inline-flex items-center gap-1 self-end text-[13.5px] font-medium text-ink-quiet no-underline hover:text-ink">
          Me: days off, pay, password <MovingArrow />
        </Link>
        <WaitingAnnouncements actor={actor} />
        {offers.map((o) => (
          <section key={o.id} aria-label={`New booking: ${o.event.name}`} className="flex flex-col gap-2.5 rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper p-3.5">
            <span className="flex items-center justify-between gap-2">
              <span className="label-mono text-[11.5px]">New booking · please answer</span>
              <Tag tone="look">NEW</Tag>
            </span>
            <span className="text-[18px] leading-tight font-bold">{o.event.name}</span>
            <span className="text-[14.5px]">{o.duty}</span>
            <ul className="flex flex-col gap-1 text-[14px]">
              {o.shifts.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 border-t border-rule-soft pt-1">
                  <span>
                    <strong>{s.function?.name ?? "Shift"}</strong> · {s.function?.venue?.name ?? s.function?.venueText ?? "Venue to be confirmed"}
                  </span>
                  <span className="font-mono text-[13px]">
                    {formatDate(s.reportAt, { weekday: "short", day: "numeric", month: "short" })} {formatTime(s.reportAt)}
                  </span>
                </li>
              ))}
            </ul>
            {seesPay && (
              <span className="text-[14px]">
                Pay for the event <strong className="font-condensed text-[26px] text-plum">{formatINR(o.agreedPay)}</strong>
              </span>
            )}
            <RespondButtons assignmentId={o.id} />
          </section>
        ))}

        {next ? (
          <section aria-label="Your next shift" className="overflow-hidden rounded-[24px] border border-line bg-white shadow-[var(--shadow-lift)]">
            <div aria-hidden className="rainbow h-1.5" />
            <div className="flex flex-col gap-2.5 p-4">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-pastel-violet px-2.5 py-0.5 text-[12px] font-semibold text-[#5b21b6]">
                <Sparkles aria-hidden className="size-3.5 animate-twinkle" /> {isToday ? "Today" : "Your next shift"}
              </span>
              <span className="text-[17px] leading-tight font-bold">
                {next.assignment.event.name}
                {next.function ? ` · ${next.function.name}` : ""}
              </span>
              <span className="text-[14px] text-ink-quiet">{next.assignment.duty}</span>
              <span className="flex items-end justify-between gap-3">
                <span className="flex flex-col">
                  <span className="label-mono text-[11.5px] text-ink-quiet">Report by</span>
                  <span className="font-condensed rainbow-text text-[64px] leading-[0.95] tabular-nums">{formatTime(next.reportAt)}</span>
                </span>
                <span className="text-right text-[13px] text-ink-quiet">{formatDate(next.reportAt, { weekday: "long", day: "numeric", month: "short" })}</span>
              </span>
              <span className="flex flex-col rounded-2xl bg-ground px-3.5 py-3 text-[15px]">
                <strong className="flex items-center gap-1.5">
                  <MapPin aria-hidden className="size-4 text-[#db2777]" />
                  {venue?.name ?? next.function?.venueText ?? "Venue to be confirmed"}
                </strong>
                {next.location && <span>Report at: {next.location}</span>}
                {venue?.address && <span className="text-[13px] text-ink-quiet">{venue.address}</span>}
                {venue?.mapUrl && (
                  <a href={venue.mapUrl} target="_blank" rel="noopener noreferrer" className="group mt-1 inline-flex items-center gap-1 text-[14px] font-semibold">
                    Directions <MovingArrow />
                  </a>
                )}
              </span>
              {can(actor, "proof.upload") && (
                <ButtonLink href={`/crew/proof?a=${next.assignment.id}`} variant="look" className="min-h-[58px] w-full text-[15px]">
                  <Camera aria-hidden className="size-5" /> Add proof of work
                </ButtonLink>
              )}
              {can(actor, "chat.direct") && (
                <a href={`/api/v1/channels/open?type=CREW&eventId=${next.assignment.eventId}`} className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-ink no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-px">
                  <MessageCircle aria-hidden className="size-[18px] text-[#0284c7]" /> Crew chat · {next.assignment.event.name}
                </a>
              )}
              {contacts.filter((c) => c.user.phoneNumber).length > 0 && (
                <span className="grid grid-cols-1 gap-1.5 pt-1">
                  {contacts
                    .filter((c) => c.user.phoneNumber)
                    .map((c) => (
                      <a key={`${c.role}-${c.user.name}`} href={`tel:${c.user.phoneNumber}`} className="flex min-h-12 items-center justify-between rounded-2xl border border-line px-3.5 text-[14px] text-ink no-underline transition hover:bg-ground">
                        <span className="flex items-center gap-2">
                          <Phone aria-hidden className="size-4 text-[#16a34a]" />
                          Call {c.role === "SUPERVISOR" ? "supervisor" : "manager"} · <strong>{firstName(c.user.name)}</strong>
                        </span>
                        <span className="font-mono text-[12.5px]">{formatPhone(c.user.phoneNumber!)}</span>
                      </a>
                    ))}
                </span>
              )}
            </div>
          </section>
        ) : (
          offers.length === 0 && (
            <Panel title="Shifts">
              <EmptyState title="No shifts coming up">When you are booked for an event it appears here.</EmptyState>
            </Panel>
          )
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
              {tasks.map((t) => {
                const actions = taskActions(actor, t, { onBooking: false, proofCount: t._count.proofs });
                return (
                  <li key={t.id} className="flex flex-col gap-2 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                    <span className="flex items-start justify-between gap-3">
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
                          {t.needsProof ? (t._count.proofs ? " · photo sent" : " · needs a photo") : ""}
                        </span>
                      </span>
                      <Tag tone={t.status === "UNDER_REVIEW" ? "look" : t.status === "IN_PROGRESS" ? "plum" : t.status === "DELAYED" ? "now" : "outline"}>
                        {t.status === "UNDER_REVIEW" ? "BEING CHECKED" : t.status === "IN_PROGRESS" ? "STARTED" : t.status === "DELAYED" ? "LATE" : "TO DO"}
                      </Tag>
                    </span>
                    {t.comments[0] && t.status === "IN_PROGRESS" && <Notice tone="error">{t.comments[0].body}</Notice>}
                    <TaskButtons taskId={t.id} actions={actions} proofHref={`/crew/proof?t=${t.id}`} size="large" />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {documents.length > 0 && (
          <Panel title={`Plans and documents · ${documents.length}`}>
            <DocumentList docs={documents} staff={false} />
          </Panel>
        )}

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
