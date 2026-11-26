import type { Metadata } from "next";
import Link from "next/link";
import { AddVendor } from "@/components/directory-forms";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";
import { listVendors } from "@/modules/vendors/directory";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; status?: string }> }) {
  const actor = await requirePermission("vendors.view");
  const sp = await searchParams;
  const departments = await db.vendorCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true } });
  const dept = departments.find((d) => d.id === sp.dept)?.id;
  const status = sp.status === "all" ? "all" : "ACTIVE";
  const vendors = await listVendors(db, actor, { q: sp.q, categoryId: dept, status });
  const href = (p: { dept?: string | null; status?: string }) => {
    const q = new URLSearchParams();
    if (sp.q) q.set("q", sp.q);
    const d = p.dept === undefined ? dept : p.dept;
    if (d) q.set("dept", d);
    const s = p.status ?? (status === "all" ? "all" : undefined);
    if (s) q.set("status", s);
    return `/vendors${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95]">Vendors</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">Caterers, decorators, lights, sound, photographers and everyone else you book.</p>
        </div>
        {can(actor, "vendors.create") && <AddVendor departments={departments} seesTax={can(actor, "vendors.bank")} />}
      </div>
      <form className="flex flex-wrap items-center gap-2" action="/vendors">
        <input name="q" defaultValue={sp.q} placeholder="Search name, phone or service" aria-label="Search vendors" className="min-h-11 min-w-[240px] flex-1 rounded-xl border border-line bg-paper px-3 text-[15px]" />
        {dept && <input type="hidden" name="dept" value={dept} />}
        <button type="submit" className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-[14px] font-semibold text-ink no-underline shadow-[0_1px_2px_rgb(22_20_31/0.05)] transition hover:-translate-y-px hover:bg-ground">
          Search
        </button>
      </form>
      <nav aria-label="Departments" className="flex flex-wrap gap-1.5 text-[13px]">
        <Link href={href({ dept: null })} aria-current={!dept ? "page" : undefined} className={`flex min-h-10 items-center rounded-xl border px-3 no-underline ${!dept ? "border-line bg-look" : "border-rule-soft"}`}>
          All
        </Link>
        {departments.map((d) => (
          <Link key={d.id} href={href({ dept: d.id })} aria-current={dept === d.id ? "page" : undefined} className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 no-underline ${dept === d.id ? "border-line bg-look" : "border-rule-soft"}`}>
            <span className="h-3 w-3" style={{ background: d.color }} aria-hidden="true" />
            {d.name}
          </Link>
        ))}
        <Link href={href({ status: status === "all" ? "" : "all" })} className="ml-auto flex min-h-10 items-center px-2 text-[12.5px]">
          {status === "all" ? "Hide inactive" : "Show inactive too"}
        </Link>
      </nav>
      <Panel title={`Vendors · ${vendors.length}`}>
        {vendors.length === 0 ? (
          <EmptyState title="No vendors match">Try another search, or add a vendor.</EmptyState>
        ) : (
          <ul>
            {vendors.map((v) => (
              <li key={v.id} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
                <span className="h-9 w-2" style={{ background: v.departments[0]?.color ?? "#E6DCCB" }} aria-hidden="true" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <Link href={`/vendors/${v.id}`} className="text-[15px] font-bold">
                    {v.company}
                  </Link>
                  <span className="truncate text-[12.5px] text-ink-quiet">
                    {v.departments.map((d) => d.name).join(", ")} · {v.contact}
                    {v.phone ? ` · ${formatPhone(v.phone)}` : ""}
                    {v.city ? ` · ${v.city}` : ""}
                  </span>
                  {v.services && <span className="truncate text-[12.5px]">{v.services}</span>}
                </span>
                <span className="flex flex-col items-end gap-1">
                  {v.status !== "ACTIVE" && <Tag tone={v.status === "BLACKLISTED" ? "now" : "quiet"}>{v.status}</Tag>}
                  {v.activeJobs > 0 && <span className="font-mono text-[11.5px]">{v.activeJobs} booked</span>}
                  {v.hasLogin ? <span className="font-mono text-[11px] text-ok-text">HAS APP LOGIN</span> : <span className="font-mono text-[11px] text-ink-quiet">NO LOGIN</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
