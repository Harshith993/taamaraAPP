import type { Metadata } from "next";
import { WaitingAnnouncements } from "@/components/messages";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, CalendarDays, IndianRupee, MessageCircle, MoonStar, Sparkles, Wallet } from "lucide-react";
import { EmptyState, FeatureCard, Notice, Panel, Tag } from "@/components/ui";
import { unreadTotal } from "@/modules/communication/chat";
import { db } from "@/lib/db";
import { firstName, formatCalendarDate, formatDate, formatINR, formatTime, greeting, todayAsDate, toNumber } from "@/lib/format";
import { EVENT_STATUS_TONE } from "@/modules/events/labels";
import { spendableAdvances } from "@/modules/finance/advances";
import { ROLES } from "@/modules/identity/permissions";
import { can, eventWhere, scopeOf, taskWhere } from "@/modules/identity/policy";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string; stay?: string }> }) {
  const actor = await requireActor();
  const { denied, stay } = await searchParams;
  const today = todayAsDate();
  // Supervisors open straight into Event day when one of their bookings is on today (screen map).
  if (!stay && !denied && !actor.isOwner && actor.roles.includes("SUPERVISOR") && !actor.roles.includes("EVENT_MANAGER")) {
    const onToday = await db.eventFunction.count({ where: { date: today, event: { AND: [eventWhere(actor), { status: { notIn: ["CANCELLED", "POSTPONED"] } }] } } });
    if (onToday) redirect("/event-day");
  }
  const seesBilling = can(actor, "finance.billing");

  const [events, tasks, approvals, toApprove] = await Promise.all([
    db.event.findMany({
      where: { AND: [eventWhere(actor), { status: { notIn: ["CANCELLED"] } }, { OR: [{ endDate: { gte: today } }, { endDate: null }] }] },
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
      take: 12,
      include: {
        category: { select: { name: true, color: true } },
        functions: { orderBy: { startsAt: "asc" }, select: { id: true, name: true, startsAt: true, date: true } },
        _count: { select: { vendorAssignments: true, crewAssignments: true } },
      },
    }),
    db.task.findMany({
      where: { AND: [taskWhere(actor), { assigneeId: actor.userId }, { status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
      orderBy: [{ dueAt: "asc" }],
      take: 8,
      include: { event: { select: { name: true } } },
    }),
    can(actor, "approvals.decide") ? db.approvalRequest.findMany({ where: { state: "PENDING" }, orderBy: { createdAt: "desc" }, take: 6 }) : Promise.resolve([]),
    can(actor, "payments.prepare") && !can(actor, "approvals.decide") ? db.payment.count({ where: { status: "PENDING_APPROVAL" } }) : Promise.resolve(0),
  ]);

  // Client billing per booking: only for people who may see it (owners, accountant).
  const billing = new Map<string, { billed: number; received: number }>();
  if (seesBilling && events.length) {
    const ids = events.map((e) => e.id);
    const [charges, received] = await Promise.all([
      db.clientCharge.groupBy({ by: ["eventId"], where: { eventId: { in: ids } }, _sum: { amount: true } }),
      db.payment.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, direction: "IN", status: "PAID" }, _sum: { amount: true } }),
    ]);
    for (const id of ids) billing.set(id, { billed: 0, received: 0 });
    for (const c of charges) if (c.eventId) billing.get(c.eventId)!.billed = toNumber(c._sum.amount);
    for (const r of received) if (r.eventId) billing.get(r.eventId)!.received = toNumber(r._sum.amount);
  }

  // Company cash this manager or supervisor is carrying (D57).
  const myAdvances = can(actor, "payments.prepare") ? [] : await spendableAdvances(db, actor);
  const cashWithMe = myAdvances.reduce((s, a) => s + a.left + a.waiting, 0);
  const bookingScope = scopeOf(actor, "bookings.view");
  const unread = await unreadTotal(db, actor);
  const toPay = can(actor, "finance.company") ? await db.payment.count({ where: { direction: "OUT", status: "APPROVED" } }) : 0;
  const nextFn = events.flatMap((e) => e.functions.map((f) => ({ ...f, event: e.name }))).filter((f) => f.startsAt >= new Date()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  // A row of the places people go most, each with what is waiting there.
  const cards = [
    can(actor, "approvals.decide") && { href: "/approvals", icon: <BadgeCheck className="size-5" aria-hidden />, tint: "violet" as const, title: "Approvals", text: approvals.length ? "Quotes, payments and extras waiting for you." : "Nothing waiting — you're all caught up.", count: approvals.length },
    can(actor, "finance.company") && { href: "/money", icon: <IndianRupee className="size-5" aria-hidden />, tint: "green" as const, title: "Money", text: toPay ? "Approved payments to send out." : "Billing, payments and the monthly P&L.", count: toPay },
    myAdvances.length > 0 && { href: "/advances", icon: <Wallet className="size-5" aria-hidden />, tint: "yellow" as const, title: "Company cash with you", text: `${formatINR(cashWithMe)} in ${myAdvances.length} advance${myAdvances.length === 1 ? "" : "s"}. Record spending with the bill; return the rest.`, count: formatINR(cashWithMe) },
    { href: "/messages", icon: <MessageCircle className="size-5" aria-hidden />, tint: "sky" as const, title: "Messages", text: unread ? "New messages from the team, vendors and crew." : "Team chats, vendor threads and announcements.", count: unread },
    can(actor, "bookings.view") && { href: "/calendar", icon: <CalendarDays className="size-5" aria-hidden />, tint: "pink" as const, title: "Calendar", text: nextFn ? `Next: ${nextFn.name} — ${nextFn.event}, ${formatDate(nextFn.startsAt, { weekday: "short", day: "numeric", month: "short" })}.` : "Every function this month at a glance." },
    can(actor, "eventDay.run") && { href: "/event-day", icon: <MoonStar className="size-5" aria-hidden />, tint: "orange" as const, title: "Event day", text: "Night mode for the venue: cues, crew and proof." },
  ].filter(Boolean) as Parameters<typeof FeatureCard>[0][];
  const roleNames = actor.isOwner ? actor.hostTitle! : actor.roles.map((r) => ROLES[r].name).join(", ");

  return (
    <div className="flex flex-col gap-5">
      {denied && <Notice tone="error">That page is not part of your access. Ask a host if you need it.</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">
            {greeting()}, <span className="rainbow-text">{firstName(actor.name)}</span>
            <Sparkles aria-hidden className="ml-2 inline size-7 animate-twinkle align-[-2px] text-[#a855f7]" />
          </h1>
          <p className="mt-1 text-[15px] text-ink-quiet">
            {formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })} · {events.length} upcoming booking{events.length === 1 ? "" : "s"}
            {bookingScope === "ASSIGNED" ? " assigned to you" : ""}
          </p>
        </div>
      </div>

      <ul aria-label="Shortcuts" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <li key={c.href} className="flex">
            <FeatureCard {...c} />
          </li>
        ))}
      </ul>

      <WaitingAnnouncements actor={actor} />

      <div className="flex flex-wrap items-start gap-4">
        <Panel title={`Upcoming bookings · ${events.length}`} className="min-w-0 flex-[999_1_560px]">
          {events.length === 0 ? (
            <EmptyState title="No upcoming bookings">{bookingScope === "ASSIGNED" ? "When a host assigns you to a booking it appears here." : "New bookings appear here."}</EmptyState>
          ) : (
            <ul>
              {events.map((e) => {
                const next = e.functions.find((f) => f.startsAt >= new Date()) ?? e.functions[0];
                const money = billing.get(e.id);
                return (
                  <li key={e.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                    <span className="h-9 w-2.5" style={{ background: e.category.color }} aria-hidden="true" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/bookings/${e.id}`} className="text-[15px] font-bold text-ink">{e.name}</Link>
                        <Tag tone={EVENT_STATUS_TONE[e.status]}>{e.status.replace("_", " ")}</Tag>
                      </span>
                      <span className="text-[13px] text-ink-quiet">
                        {e.category.name} · {e.code} · {formatCalendarDate(e.startDate)}
                        {e.endDate && e.startDate && e.endDate.getTime() !== e.startDate.getTime() ? ` – ${formatCalendarDate(e.endDate)}` : ""} · {e.functions.length} function{e.functions.length === 1 ? "" : "s"}
                      </span>
                      {next && (
                        <span className="text-[13px]">
                          Next: <strong>{next.name}</strong> {formatDate(next.startsAt)} {formatTime(next.startsAt)}
                        </span>
                      )}
                    </span>
                    <span className="text-right font-mono text-[12.5px] leading-tight">
                      {money ? (
                        <>
                          <span className="block font-semibold">{formatINR(money.billed)}</span>
                          <span className="block text-ink-quiet">received {formatINR(money.received)}</span>
                        </>
                      ) : (
                        <>
                          <span className="block">{e._count.vendorAssignments} vendors</span>
                          <span className="block text-ink-quiet">{e._count.crewAssignments} crew</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          {can(actor, "approvals.decide") && (
            <Panel title={`Approvals waiting · ${approvals.length}`} action={approvals.length ? <Link href="/approvals" className="group inline-flex items-center gap-1 text-[13.5px] font-semibold text-plum no-underline">Open <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-1">→</span></Link> : undefined}>
              {approvals.length === 0 ? (
                <EmptyState title="Nothing waiting" />
              ) : (
                <ul>
                  {approvals.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                      <span className="flex flex-col leading-tight">
                        <span className="text-[14px] font-semibold">{a.summary}</span>
                        <span className="label-mono text-[10.5px] text-ink-quiet">{a.type.replace("_", " ")}</span>
                      </span>
                      {a.amount && <span className="font-mono text-[13.5px] font-semibold">{formatINR(a.amount)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {toApprove > 0 && <Notice tone="info">{toApprove} payment{toApprove === 1 ? " is" : "s are"} waiting for an owner&apos;s approval.</Notice>}

          <Panel title={`My tasks · ${tasks.length}`}>
            {tasks.length === 0 ? (
              <EmptyState title="No open tasks" />
            ) : (
              <ul>
                {tasks.map((t) => (
                  <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-[14px] font-semibold">{t.title}</span>
                      <span className="text-[12.5px] text-ink-quiet">
                        {t.event?.name ?? "General"}
                        {t.dueAt ? ` · due ${formatDate(t.dueAt)} ${formatTime(t.dueAt)}` : ""}
                      </span>
                    </span>
                    <Tag tone={t.status === "DELAYED" ? "now" : t.status === "UNDER_REVIEW" ? "look" : t.status === "IN_PROGRESS" ? "plum" : "outline"}>{t.status.replace("_", " ")}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your access">
            <div className="flex flex-col gap-1.5 px-3.5 py-3 text-[13.5px]">
              <p>
                Signed in as <strong>{roleNames}</strong>.
              </p>
              <p>{bookingScope === "ALL" ? "You can see every booking." : bookingScope === "ASSIGNED" ? "You can see the bookings you are assigned to." : "You cannot see bookings."}</p>
              <p>{seesBilling ? "You can see client billing and margins." : "Client billing and margins are hidden from your role."}</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
