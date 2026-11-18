import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RemoveUnavailable, UnavailableForm } from "@/components/directory-forms";
import { PortalShell } from "@/components/portal-shell";
import { ButtonLink, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { formatCalendarDate, formatINR, todayAsDate, todayInIndia, toNumber } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { can } from "@/modules/identity/policy";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Me" };

/** The crew member's own page: details, days they can't work, paid history, password. */
export default async function CrewMePage() {
  const actor = await requireActor();
  if (actor.accountType !== "LABOUR" || !actor.workerId) redirect(homePathFor(actor));
  const seesPay = can(actor, "crew.pay.view");
  const w = await db.worker.findUniqueOrThrow({
    where: { id: actor.workerId },
    include: {
      skills: { select: { skill: { select: { name: true } } } },
      unavailability: { where: { date: { gte: todayAsDate() } }, orderBy: { date: "asc" } },
    },
  });
  const paid = seesPay
    ? await db.payment.findMany({ where: { workerId: w.id, direction: "OUT", status: "PAID" }, orderBy: { paidOn: "desc" }, take: 10, select: { id: true, amount: true, paidOn: true, method: true, event: { select: { name: true } } } })
    : [];
  return (
    <PortalShell title="Me" subtitle="Taamara Taamara · crew" back={{ href: "/crew", label: "Today" }}>
      <div className="flex flex-col gap-3.5">
        <Panel title="My details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[15px]">
            <dt className="text-ink-quiet">Name</dt>
            <dd className="font-semibold">{w.name}</dd>
            <dt className="text-ink-quiet">Phone</dt>
            <dd>{formatPhone(w.phone)}</dd>
            <dt className="text-ink-quiet">Skills</dt>
            <dd>{w.skills.map((s) => s.skill.name).join(", ") || "—"}</dd>
          </dl>
          <p className="border-t border-rule-soft px-3.5 py-2 text-[12.5px] text-ink-quiet">Something wrong? Tell your manager.</p>
        </Panel>
        <Panel title="Days I can't work">
          {w.unavailability.length === 0 ? (
            <p className="px-3.5 pt-3 text-[14px] text-ink-quiet">None marked. Mark a day so you are not booked for it.</p>
          ) : (
            <ul>
              {w.unavailability.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 border-b border-rule-soft px-3.5 py-2 text-[15px]">
                  <span>
                    <strong>{formatCalendarDate(u.date, { weekday: "short", day: "numeric", month: "short" })}</strong>
                    {u.reason ? ` · ${u.reason}` : ""}
                  </span>
                  <RemoveUnavailable workerId={w.id} id={u.id} />
                </li>
              ))}
            </ul>
          )}
          <UnavailableForm workerId={w.id} today={todayInIndia()} />
        </Panel>
        {seesPay && paid.length > 0 && (
          <Panel title="Paid to me">
            <ul>
              {paid.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 text-[14.5px] last:border-b-0">
                  <span>
                    {p.event?.name ?? "Payment"}
                    <span className="block text-[12.5px] text-ink-quiet">
                      {p.paidOn ? formatCalendarDate(p.paidOn, { day: "numeric", month: "short" }) : ""} · {p.method.toLowerCase()}
                    </span>
                  </span>
                  <span className="font-mono font-semibold">{formatINR(toNumber(p.amount))}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <ButtonLink href="/set-password" variant="secondary" className="min-h-12">
          Change my password
        </ButtonLink>
      </div>
    </PortalShell>
  );
}
