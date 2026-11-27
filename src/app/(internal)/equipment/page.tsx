import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Armchair, CalendarClock, Lightbulb, Speaker, Sparkles, Sofa, type LucideIcon } from "lucide-react";
import { ItemForm, ResolveIssue } from "@/components/equipment-controls";
import { EmptyState, IconTile, Panel, Tag, type Tint } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { EQUIPMENT_CATEGORIES, categoryLabel, equipmentReport, listEquipment } from "@/modules/equipment/service";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Equipment" };

const LOOK: Record<string, { icon: LucideIcon; tint: Tint }> = {
  DECOR: { icon: Sparkles, tint: "pink" },
  FURNITURE: { icon: Sofa, tint: "orange" },
  LIGHTING: { icon: Lightbulb, tint: "yellow" },
  SOUND: { icon: Speaker, tint: "sky" },
  OTHER: { icon: Armchair, tint: "violet" },
};
const CONDITION = { GOOD: { tone: "ok", words: "Good" }, WORN: { tone: "look", words: "Worn" }, NEEDS_REPAIR: { tone: "now", words: "Needs repair" }, RETIRED: { tone: "quiet", words: "Retired" } } as const;
const d = (x: Date | null) => (x ? formatDate(x, { timeZone: "UTC", day: "numeric", month: "short" }) : "?");

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; retired?: string }> }) {
  const actor = await requirePermission("equipment.view");
  const sp = await searchParams;
  const category = EQUIPMENT_CATEGORIES.some((c) => c.key === sp.category) ? sp.category! : "all";
  const [items, report] = await Promise.all([listEquipment(db, actor, { q: sp.q, category, showRetired: sp.retired === "1" }), equipmentReport(db, actor)]);
  const manages = can(actor, "equipment.manage");
  const owned = items.reduce((s, i) => s + i.quantity, 0);
  const out = items.reduce((s, i) => s + i.out, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[26px] leading-tight tracking-[-0.03em] sm:text-[30px]">Equipment</h1>
        <p className="mt-1 max-w-prose text-[15px] text-ink-quiet">
          The company&apos;s own decor, furniture, lights and sound. Book it out from a booking&apos;s Equipment tab; check it out and back in with notes. {owned} pieces across {items.length} items · {out} out now.
        </p>
      </div>

      {(report.issues.length > 0 || report.overdue.length > 0 || report.clashes.length > 0) && (
        <div className="flex flex-wrap items-start gap-4">
          {report.issues.length > 0 && (
            <Panel title={`Missing or damaged · ${report.issues.length}`} className="min-w-0 flex-[1_1_420px]">
              <ul aria-label="Missing or damaged equipment">
                {report.issues.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle aria-hidden className="size-4 text-now" /> {i.item}: {[i.missing ? `${i.missing} missing` : "", i.damaged ? `${i.damaged} damaged` : ""].filter(Boolean).join(", ")}
                      </span>
                      <span className="text-[12.5px] text-ink-quiet">
                        <Link href={`/bookings/${i.event.id}?tab=equipment`}>{i.event.name}</Link>
                        {i.returnedAt ? ` · back ${formatDate(i.returnedAt, { day: "numeric", month: "short" })}` : ""}
                        {i.note ? ` · ${i.note}` : ""}
                      </span>
                    </span>
                    {manages && <ResolveIssue id={i.id} />}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {report.overdue.length > 0 && (
            <Panel title={`Overdue back · ${report.overdue.length}`} className="min-w-0 flex-[1_1_320px]">
              <ul>
                {report.overdue.map((o) => (
                  <li key={o.id} className="flex flex-col border-b border-rule-soft px-3.5 py-2.5 leading-tight last:border-b-0">
                    <span className="font-semibold">
                      {o.quantity} × {o.item}
                    </span>
                    <span className="text-[12.5px] text-ink-quiet">
                      <Link href={`/bookings/${o.event.id}?tab=equipment`}>{o.event.name}</Link> · due back {d(o.due)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {report.clashes.length > 0 && (
            <Panel title={`Clashes ahead · ${report.clashes.length}`} className="min-w-0 flex-[1_1_320px]">
              <ul aria-label="Equipment clashes">
                {report.clashes.map((c, n) => (
                  <li key={n} className="flex flex-col border-b border-rule-soft px-3.5 py-2.5 leading-tight last:border-b-0">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <CalendarClock aria-hidden className="size-4 text-plum" /> {c.itemName}: {c.short} short
                    </span>
                    <span className="text-[12.5px] text-ink-quiet">
                      {c.bookings.map((b, k) => (
                        <span key={k}>
                          {k ? " · " : ""}
                          <Link href={`/bookings/${b.id}?tab=equipment`}>{b.name}</Link> {b.quantity} ({d(b.from)}–{d(b.to)})
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {manages && <ItemForm />}

      <nav aria-label="Equipment categories" className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
        {[{ key: "all", label: "All" }, ...EQUIPMENT_CATEGORIES].map((c) => (
          <Link
            key={c.key}
            href={c.key === "all" ? "/equipment" : `/equipment?category=${c.key}`}
            aria-current={c.key === category ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-full px-3.5 no-underline transition ${c.key === category ? "bg-ink text-white" : "border border-line bg-white text-ink hover:-translate-y-px"}`}
          >
            {c.label}
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-1.5" action="/equipment">
          {category !== "all" && <input type="hidden" name="category" value={category} />}
          <input type="search" name="q" defaultValue={sp.q} placeholder="Search items" aria-label="Search items" className="min-h-10 rounded-full border border-line bg-white px-3.5 text-[14px]" />
        </form>
      </nav>

      {items.length === 0 ? (
        <Panel>
          <EmptyState title="Nothing in the register yet">{manages ? "Add the company's decor, furniture, lights and sound above." : "Hosts and managers add the company's equipment here."}</EmptyState>
        </Panel>
      ) : (
        <ul aria-label="Equipment register" className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-3.5">
          {items.map((i) => {
            const look = LOOK[i.category ?? "OTHER"] ?? LOOK.OTHER;
            return (
              <li key={i.id} aria-label={i.name} className="lift flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
                {i.photo?.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.photo.thumbUrl} alt={i.name} className="h-36 w-full object-cover" />
                ) : (
                  <div aria-hidden className="rainbow-soft grid h-20 place-items-center">
                    <IconTile tint={look.tint}>
                      <look.icon className="size-5" />
                    </IconTile>
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-3.5">
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex flex-col leading-tight">
                      <span className="text-[15.5px] font-bold">{i.name}</span>
                      <span className="text-[12.5px] text-ink-quiet">
                        {categoryLabel(i.category)}
                        {i.location ? ` · ${i.location}` : ""}
                      </span>
                    </span>
                    <Tag tone={CONDITION[i.condition].tone}>{CONDITION[i.condition].words}</Tag>
                  </span>
                  <dl className="grid grid-cols-3 gap-1.5 text-center text-[12px]">
                    <div className="rounded-xl bg-ground py-1.5">
                      <dt className="text-ink-quiet">Owned</dt>
                      <dd className="font-condensed text-[22px] leading-none">{i.quantity}</dd>
                    </div>
                    <div className="rounded-xl bg-ground py-1.5">
                      <dt className="text-ink-quiet">In store</dt>
                      <dd className="font-condensed text-[22px] leading-none">{i.inStore}</dd>
                    </div>
                    <div className="rounded-xl bg-ground py-1.5">
                      <dt className="text-ink-quiet">Out</dt>
                      <dd className="font-condensed text-[22px] leading-none">{i.out}</dd>
                    </div>
                  </dl>
                  {(i.missing > 0 || i.damaged > 0) && (
                    <span className="text-[12.5px] font-semibold text-now">{[i.missing ? `${i.missing} missing` : "", i.damaged ? `${i.damaged} damaged` : ""].filter(Boolean).join(" · ")}</span>
                  )}
                  {i.notes && <p className="text-[13px] text-ink-quiet">{i.notes}</p>}
                  {(i.outAt.length > 0 || i.upcoming.length > 0) && (
                    <ul className="flex flex-col gap-0.5 border-t border-rule-soft pt-1.5 text-[12.5px]">
                      {i.outAt.map((a) => (
                        <li key={a.id} className={a.overdue ? "font-semibold text-now" : ""}>
                          Out: {a.quantity} at <Link href={`/bookings/${a.event.id}?tab=equipment`}>{a.event.name}</Link> · back by {d(a.to)}
                          {a.overdue ? " (overdue)" : ""}
                        </li>
                      ))}
                      {i.upcoming.slice(0, 3).map((a) => (
                        <li key={a.id}>
                          Booked: {a.quantity} for <Link href={`/bookings/${a.event.id}?tab=equipment`}>{a.event.name}</Link> · {d(a.from)}–{d(a.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {manages && (
                    <div className="mt-auto pt-1">
                      <ItemForm item={{ id: i.id, name: i.name, category: i.category, quantity: i.quantity, condition: i.condition, location: i.location, notes: i.notes, photoFileId: i.photoFileId }} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link href={sp.retired === "1" ? "/equipment" : "/equipment?retired=1"} className="label-mono self-start text-[12px]">
        {sp.retired === "1" ? "Hide retired items" : "Show retired items too"}
      </Link>
    </div>
  );
}
