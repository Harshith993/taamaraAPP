import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel } from "@/components/ui";
import { ProofGrid } from "@/components/proof-grid";
import { db } from "@/lib/db";
import { eventWhere } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";
import { listProof, type ProofItem } from "@/modules/proof/service";

export const metadata: Metadata = { title: "Proof" };

const STATES = [
  { key: "PENDING_REVIEW", label: "To check" },
  { key: "REJECTED", label: "Redo asked" },
  { key: "APPROVED", label: "Approved" },
  { key: "all", label: "All" },
] as const;
type StateKey = (typeof STATES)[number]["key"];

export default async function ProofPage({ searchParams }: { searchParams: Promise<{ state?: string; booking?: string }> }) {
  const actor = await requirePermission("proof.view");
  const sp = await searchParams;
  const state: StateKey = STATES.find((s) => s.key === sp.state)?.key ?? "PENDING_REVIEW";
  const bookings = await db.event.findMany({
    where: { AND: [eventWhere(actor, "proof.view"), { proofs: { some: {} } }] },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, code: true },
    take: 100,
  });
  const booking = bookings.find((b) => b.id === sp.booking) ?? null;
  const items = await listProof(db, actor, { eventId: booking?.id, status: state === "all" ? undefined : state });

  // Group by booking when looking across bookings.
  const groups = new Map<string, { name: string; code: string; items: ProofItem[] }>();
  for (const p of items) {
    const g = groups.get(p.event.id) ?? { name: p.event.name, code: p.event.code, items: [] };
    g.items.push(p);
    groups.set(p.event.id, g);
  }
  const href = (s: StateKey, b: string | null) => `/proof?state=${s}${b ? `&booking=${b}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95] uppercase">Proof of work</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">Photos and videos from vendors and crew. Approve each one, or ask for it to be redone with a note.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Filter by state" className="flex flex-wrap border-2 border-ink font-mono text-[12.5px] font-semibold tracking-[0.06em] uppercase">
          {STATES.map((s) => (
            <Link key={s.key} href={href(s.key, booking?.id ?? null)} aria-current={s.key === state ? "page" : undefined} className={`flex min-h-10 items-center px-3.5 no-underline ${s.key === state ? "bg-ink text-[#F6EFE0]" : "text-ink hover:bg-paper"}`}>
              {s.label}
            </Link>
          ))}
        </nav>
        {bookings.length > 1 && (
          <nav aria-label="Filter by booking" className="flex flex-wrap gap-1.5 text-[13px]">
            <Link href={href(state, null)} aria-current={!booking ? "page" : undefined} className={`flex min-h-10 items-center rounded-[3px] border-2 px-3 no-underline ${!booking ? "border-ink bg-look" : "border-rule-soft"}`}>
              Every booking
            </Link>
            {bookings.map((b) => (
              <Link key={b.id} href={href(state, b.id)} aria-current={booking?.id === b.id ? "page" : undefined} className={`flex min-h-10 items-center rounded-[3px] border-2 px-3 no-underline ${booking?.id === b.id ? "border-ink bg-look" : "border-rule-soft"}`}>
                {b.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {items.length === 0 ? (
        <Panel>
          <EmptyState title={state === "PENDING_REVIEW" ? "Nothing to check" : "No proof here"}>
            {state === "PENDING_REVIEW" ? "New photos and videos from vendors and crew appear here, and you get a notification." : "Try another filter."}
          </EmptyState>
        </Panel>
      ) : (
        [...groups.entries()].map(([id, g]) => (
          <Panel key={id} title={`${g.name} · ${g.items.length}`} action={<Link href={`/bookings/${id}?tab=proof`} className="label-mono text-[11.5px] no-underline">Booking →</Link>}>
            <div className="p-3.5">
              <ProofGrid items={g.items} />
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
