import type { Metadata } from "next";
import { MessageCircle, MessagesSquare, Camera, CheckSquare, Clock3, FileText, IndianRupee, LayoutDashboard, ListChecks, Store, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, EmptyState, Notice, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  formatCalendarDate,
  formatDate,
  formatINR,
  formatTime,
} from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import {
  EVENT_STATUS_TONE,
  VENDOR_STAGES,
  VENDOR_STAGE_WORDS,
  vendorStageIndex,
} from "@/modules/events/labels";
import {
  getBookingCrew,
  getBookingHeader,
  getBookingMoney,
  getBookingSchedule,
  getBookingTasks,
  getBookingVendors,
} from "@/modules/events/workspace";
import { can } from "@/modules/identity/policy";
import { requirePermission } from "@/modules/identity/session";
import { listProof } from "@/modules/proof/service";
import { invitableVendors } from "@/modules/vendors/jobs";
import { ProofGrid } from "@/components/proof-grid";
import { AddCrewForm, AttendanceButtons, RemoveCrew } from "@/components/crew-controls";
import { AddTaskForm, TaskButtons } from "@/components/task-controls";
import { attendanceWindow, crewForBooking } from "@/modules/crew/service";
import { assignableForBooking, taskActions } from "@/modules/tasks/service";
import { getRequirements, teamCandidates } from "@/modules/events/planning";
import { listDocuments } from "@/modules/documents/service";
import { bookingLedger } from "@/modules/finance/overview";
import { budgetView } from "@/modules/finance/budgets";
import { BudgetButtons, BudgetLineForm, RemoveBudgetLine } from "@/components/budget-controls";
import { AdjustmentForm, ChargeForm, MarkPaid, PreparePayment, ReceiptForm, RemoveCharge, ReopenBooking, SettleBooking, VoidPayment } from "@/components/finance-controls";
import { settlementView, type SettlementView } from "@/modules/finance/settlement";
import { bookingInvoices, type BookingInvoices } from "@/modules/finance/client-invoices";
import { BillingDetailsForm, CancelInvoice, DeleteDraft, IssueInvoice, NewInvoiceForm } from "@/components/client-invoice-controls";
import { todayInIndia } from "@/lib/format";
import { DocumentList } from "@/components/document-list";
import { AddDocumentForm } from "@/components/document-controls";
import { CancelBooking, DetailsEditor, DoneToggle, FunctionEditor, RequirementEditor, ScheduleEditor, TeamEditor } from "./planning-controls";
import { InviteVendorForm, VendorRowActions } from "./vendor-controls";

export const metadata: Metadata = { title: "Booking" };

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "schedule", label: "Schedule", icon: Clock3 },
  { key: "needs", label: "Needs", icon: ListChecks },
  { key: "vendors", label: "Vendors", icon: Store },
  { key: "crew", label: "Crew", icon: UsersRound },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "proof", label: "Proof", icon: Camera },
  { key: "docs", label: "Docs", icon: FileText },
  { key: "money", label: "Money", icon: IndianRupee },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string }>;
}) {
  const actor = await requirePermission("bookings.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ??
    "overview") as TabKey;

  let header;
  try {
    header = await getBookingHeader(db, actor, id);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const counts: Partial<Record<TabKey, number>> = {
    vendors: header.counts.vendorAssignments,
    crew: header.counts.crewAssignments,
    tasks: header.counts.tasks,
    proof: header.counts.proofs,
  };
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {sp.created && (
        <Notice tone="ok">
          Booking created. Its checklist tasks are on the Tasks tab.
        </Notice>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/bookings"
            className="label-mono text-[12px] no-underline"
          >
            ← Bookings
          </Link>
          <h1 className="font-condensed text-[clamp(30px,3.6vw,42px)] leading-[0.95]">
            {header.name} · {header.category.name}
          </h1>
          <p className="text-[13.5px] text-ink-quiet">
            {header.code} ·{" "}
            {formatCalendarDate(header.startDate, {
              day: "numeric",
              month: "short",
            })}
            {header.endDate &&
            header.startDate &&
            header.endDate.getTime() !== header.startDate.getTime()
              ? `–${formatCalendarDate(header.endDate, { day: "numeric", month: "short" })}`
              : ""}{" "}
            · {header.functions.length} function
            {header.functions.length === 1 ? "" : "s"}
            {header.managers.length
              ? ` · Lead ${header.managers.join(", ")}`
              : ""}
            {header.client ? ` · Client ${header.client.name}` : ""}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {actor.accountType === "INTERNAL" && can(actor, "chat.booking") && (
            <a href={`/api/v1/channels/open?type=BOOKING_TEAM&eventId=${header.id}`} className="group inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13.5px] font-semibold text-ink no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-px">
              <MessagesSquare aria-hidden className="size-4 text-[#7c3aed]" /> Team chat
            </a>
          )}
          {actor.accountType === "INTERNAL" && can(actor, "chat.direct") && (
            <a href={`/api/v1/channels/open?type=CREW&eventId=${header.id}`} className="group inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13.5px] font-semibold text-ink no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-px">
              <MessageCircle aria-hidden className="size-4 text-[#0284c7]" /> Crew chat
            </a>
          )}
          <Tag tone={EVENT_STATUS_TONE[header.status]}>{header.status}</Tag>
        </span>
      </div>

      <ul
        aria-label="Functions"
        className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2"
      >
        {header.functions.map((f) => {
          const live = f.startsAt <= now && (f.endsAt ?? f.startsAt) >= now;
          const done = (f.endsAt ?? f.startsAt) < now;
          return (
            <li
              key={f.id}
              className={`flex flex-col gap-0.5 rounded-xl border border-line px-2.5 py-2 ${live ? "bg-ink text-[#F6EFE0]" : "bg-paper"}`}
            >
              <span
                className={`font-mono text-[11.5px] font-semibold uppercase ${live ? "text-look" : "text-ink-quiet"}`}
              >
                {formatDate(f.startsAt, { weekday: "short", day: "numeric" })} ·{" "}
                {live ? "now" : done ? "done" : formatTime(f.startsAt)}
              </span>
              <span className="text-[14.5px] font-bold">{f.name}</span>
              <span
                className={`text-[12px] ${live ? "text-[#D9C7CF]" : "text-ink-quiet"}`}
              >
                {f.venue ?? "Venue to be confirmed"}
              </span>
            </li>
          );
        })}
      </ul>

      <nav
        aria-label="Booking sections"
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-[22px] border border-line bg-ground p-1 text-[13.5px] font-medium"
      >
        {TABS.filter((t) => (t.key === "money" ? can(actor, "finance.budget") || can(actor, "finance.billing") : t.key === "docs" ? can(actor, "documents.view") : true)).map((t) => (
          <Link
            key={t.key}
            href={`/bookings/${id}?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`group flex min-h-10 items-center gap-1.5 rounded-full px-3.5 no-underline transition duration-150 ${t.key === tab ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-ink-quiet hover:-translate-y-px hover:text-ink"}`}
          >
            <t.icon aria-hidden className="size-4 transition-transform group-hover:scale-110" />
            {t.label}
            {counts[t.key] !== undefined ? <span className="rounded-full bg-pastel-violet px-1.5 text-[11.5px] font-semibold text-[#5b21b6]">{counts[t.key]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview actor={actor} header={header} />}
      {tab === "schedule" && <Schedule actor={actor} eventId={id} />}
      {tab === "needs" && <Needs actor={actor} eventId={id} />}
      {tab === "vendors" && <Vendors actor={actor} eventId={id} />}
      {tab === "crew" && <Crew actor={actor} eventId={id} />}
      {tab === "tasks" && <Tasks actor={actor} eventId={id} />}
      {tab === "proof" && <Proof actor={actor} eventId={id} />}
      {tab === "docs" && <Docs actor={actor} eventId={id} />}
      {tab === "money" && <Money actor={actor} eventId={id} />}
    </div>
  );
}

type Actor = Awaited<ReturnType<typeof requirePermission>>;
type Header = Awaited<ReturnType<typeof getBookingHeader>>;

async function Overview({ actor, header }: { actor: Actor; header: Header }) {
  const onBooking = await isOnBooking(actor, header.id);
  const edits = actor.accountType === "INTERNAL" && can(actor, "bookings.edit") && (actor.grants.get("bookings.edit") === "ALL" || onBooking) && !["CANCELLED", "SETTLED"].includes(header.status);
  const assignsTeam = can(actor, "bookings.assignTeam") && header.status !== "CANCELLED";
  const [money, fnRows, venues, categories, event, members, candidates] = await Promise.all([
    getBookingMoney(db, actor, header.id),
    edits ? db.eventFunction.findMany({ where: { eventId: header.id }, select: { id: true, venueId: true, venueText: true, notes: true, date: true, _count: { select: { crewShifts: true, vendorLinks: true, proofs: true } } } }) : [],
    edits ? db.venue.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 300 }) : [],
    edits ? db.eventCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
    edits ? db.event.findUnique({ where: { id: header.id }, select: { categoryId: true, shareHostContactWithVendors: true } }) : null,
    assignsTeam ? db.eventMember.findMany({ where: { eventId: header.id }, select: { userId: true, role: true } }) : [],
    assignsTeam ? teamCandidates(db) : [],
  ]);
  const fnExtra = new Map(fnRows.map((f) => [f.id, f]));
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        <Panel title="Functions">
          <ul>
            {header.functions.map((f) => (
              <li
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0"
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-bold">{f.name}</span>
                  <span className="text-[13px] text-ink-quiet">
                    {f.venue ?? "Venue to be confirmed"}
                    {f.guests ? ` · ${f.guests} guests` : ""}
                  </span>
                </span>
                <span className="text-right font-mono text-[12.5px]">
                  {formatDate(f.startsAt, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  <br />
                  {formatTime(f.startsAt)}
                  {f.endsAt ? `–${formatTime(f.endsAt)}` : ""}
                </span>
                {edits && fnExtra.get(f.id) && (
                  <span className="col-span-2">
                    <FunctionEditor
                      eventId={header.id}
                      venues={venues}
                      canRemove={header.functions.length > 1 && Object.values(fnExtra.get(f.id)!._count).every((n) => n === 0)}
                      fn={{
                        id: f.id,
                        name: f.name,
                        date: fnExtra.get(f.id)!.date.toISOString().slice(0, 10),
                        startTime: formatTime(f.startsAt),
                        endTime: f.endsAt ? formatTime(f.endsAt) : "",
                        venueId: fnExtra.get(f.id)!.venueId,
                        venueText: fnExtra.get(f.id)!.venueText,
                        guests: f.guests,
                        notes: fnExtra.get(f.id)!.notes,
                      }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {edits && (
            <div className="border-t border-line px-3.5 py-3">
              <FunctionEditor eventId={header.id} venues={venues} />
            </div>
          )}
        </Panel>
        {edits && event && (
          <DetailsEditor
            eventId={header.id}
            categories={categories}
            initial={{ name: header.name, categoryId: event.categoryId, status: header.status, expectedGuests: header.expectedGuests, description: header.description, shareHostContactWithVendors: event.shareHostContactWithVendors }}
          />
        )}
        {header.description && (
          <Panel title="Notes">
            <p className="px-3.5 py-3 text-[14.5px] whitespace-pre-line">
              {header.description}
            </p>
          </Panel>
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
        {money && (
          <Panel title="Money">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[14px]">
              {money.billed !== null && (
                <>
                  <dt className="text-ink-quiet">Billed to client</dt>
                  <dd className="text-right font-mono font-semibold">
                    {formatINR(money.billed)}
                  </dd>
                  <dt className="text-ink-quiet">Received</dt>
                  <dd className="text-right font-mono text-ok-text">
                    {formatINR(money.received)}
                  </dd>
                </>
              )}
              <dt className="text-ink-quiet">Committed costs</dt>
              <dd className="text-right font-mono">
                {formatINR(money.committedCosts)}
              </dd>
              {money.budget !== null && (
                <>
                  <dt className="text-ink-quiet">Approved cost budget</dt>
                  <dd className="text-right font-mono">
                    {formatINR(money.budget)}
                  </dd>
                </>
              )}
              <dt className="text-ink-quiet">Paid out</dt>
              <dd className="text-right font-mono">
                {formatINR(money.paidOut)}
              </dd>
              {money.expectedProfit !== null && (
                <>
                  <dt className="border-t border-line pt-1.5 font-semibold">
                    Expected profit
                  </dt>
                  <dd className="border-t border-line pt-1.5 text-right font-mono font-semibold">
                    {formatINR(money.expectedProfit)}
                  </dd>
                </>
              )}
            </dl>
          </Panel>
        )}
        {header.client && (
          <Panel title="Client">
            <div className="flex flex-col gap-1 px-3.5 py-3 text-[14px]">
              <p className="font-bold">{header.client.name}</p>
              {header.client.phone && <p>{formatPhone(header.client.phone)}</p>}
              {header.client.contacts.map((c) => (
                <p key={`${c.name}-${c.phone}`} className="text-ink-quiet">
                  {c.name}
                  {c.relation ? ` (${c.relation})` : ""}
                  {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                </p>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Team">
          <div className="flex flex-col gap-1 px-3.5 py-3 text-[14px]">
            <p>
              <span className="text-ink-quiet">Manager:</span>{" "}
              {header.managers.join(", ") || "not assigned"}
            </p>
            <p>
              <span className="text-ink-quiet">Supervisor:</span>{" "}
              {header.supervisors.join(", ") || "not assigned"}
            </p>
          </div>
          {assignsTeam && (
            <TeamEditor
              eventId={header.id}
              candidates={candidates}
              managerIds={members.filter((m) => m.role === "MANAGER").map((m) => m.userId)}
              supervisorIds={members.filter((m) => m.role === "SUPERVISOR").map((m) => m.userId)}
            />
          )}
        </Panel>
        {can(actor, "bookings.cancel") && !["CANCELLED", "SETTLED", "COMPLETED"].includes(header.status) && <CancelBooking eventId={header.id} />}
        {header.status === "CANCELLED" && <Notice tone="info">This booking was cancelled.</Notice>}
      </div>
    </div>
  );
}

async function Schedule({ actor, eventId }: { actor: Actor; eventId: string }) {
  const [items, onBooking, functions] = await Promise.all([
    getBookingSchedule(db, actor, eventId),
    isOnBooking(actor, eventId),
    db.eventFunction.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, select: { id: true, name: true, date: true } }),
  ]);
  const staff = actor.accountType === "INTERNAL";
  const edits = staff && can(actor, "schedule.edit") && (actor.grants.get("schedule.edit") === "ALL" || onBooking);
  const ticks = staff && (edits || (can(actor, "attendance.mark") && onBooking));
  const fnOptions = functions.map((f) => ({ id: f.id, name: f.name, date: f.date.toISOString().slice(0, 10) }));
  const add = edits ? <ScheduleEditor eventId={eventId} functions={fnOptions} defaultDate={fnOptions[0]?.date ?? ""} /> : null;
  if (!items.length)
    return (
      <div className="flex flex-col gap-3">
        {add}
        <Panel>
          <EmptyState title="No run sheet yet">
            Setup, reporting times, ceremonies and dismantling for each function. Mark which ones vendors and crew see.
          </EmptyState>
        </Panel>
      </div>
    );
  const now = new Date();
  return (
    <div className="flex flex-col gap-3">
      {add}
      <Panel title={`Run sheet · ${items.length}`}>
        <ol>
          {items.map((s) => {
            const past = (s.endsAt ?? s.startsAt) < now;
            return (
              <li
                key={s.id}
                className={`grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 ${past || s.done ? "text-ink-quiet" : ""}`}
              >
                <span className="font-mono text-[13.5px] font-semibold">
                  {formatTime(s.startsAt)}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className={`text-[14.5px] font-semibold ${s.done ? "line-through" : ""}`}>{s.title}</span>
                  <span className="text-[12.5px] text-ink-quiet">
                    {s.function?.name ?? "Whole booking"} ·{" "}
                    {formatDate(s.startsAt)}
                    {s.endsAt ? `–${formatTime(s.endsAt)}` : ""}
                    {s.location ? ` · ${s.location}` : ""}
                    {s.visibleToVendors ? " · vendors see this" : ""}
                    {s.visibleToCrew ? " · crew see this" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="label-mono hidden text-[10.5px] sm:inline">
                    {s.type.replace("_", " ")}
                  </span>
                  {ticks && <DoneToggle itemId={s.id} done={s.done} />}
                </span>
                {edits && (
                  <span className="col-span-3">
                    <ScheduleEditor
                      eventId={eventId}
                      functions={fnOptions}
                      defaultDate={fnOptions[0]?.date ?? ""}
                      item={{
                        id: s.id,
                        functionId: s.function?.id ?? null,
                        type: s.type,
                        title: s.title,
                        date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(s.startsAt),
                        time: formatTime(s.startsAt),
                        endTime: s.endsAt ? formatTime(s.endsAt) : "",
                        location: s.location,
                        visibleToVendors: s.visibleToVendors,
                        visibleToCrew: s.visibleToCrew,
                      }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}

const NEED_TONE = { OPEN: "look", QUOTING: "plum", COVERED: "ok", DROPPED: "quiet" } as const;
const NEED_WORDS = { OPEN: "Open", QUOTING: "Being quoted", COVERED: "Covered", DROPPED: "Dropped" } as const;

async function Needs({ actor, eventId }: { actor: Actor; eventId: string }) {
  const [rows, onBooking] = await Promise.all([getRequirements(db, actor, eventId), isOnBooking(actor, eventId)]);
  const edits = actor.accountType === "INTERNAL" && can(actor, "requirements.edit") && (actor.grants.get("requirements.edit") === "ALL" || onBooking);
  const [functions, categories, jobs] = edits
    ? await Promise.all([
        db.eventFunction.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, select: { id: true, name: true } }),
        db.vendorCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
        db.vendorAssignment.findMany({ where: { eventId, status: { notIn: ["DECLINED", "CANCELLED"] } }, select: { id: true, scopeOfWork: true, vendor: { select: { companyName: true } } } }),
      ])
    : [[], [], []];
  const jobOptions = jobs.map((j) => ({ id: j.id, label: `${j.vendor.companyName} · ${j.scopeOfWork}` }));
  const add = edits ? <RequirementEditor eventId={eventId} functions={functions} categories={categories} jobs={jobOptions} /> : null;
  if (!rows.length)
    return (
      <div className="flex flex-col gap-3">
        {add}
        <Panel>
          <EmptyState title="No requirements yet">
            What each function needs: from the client or our own plan. Link one to a vendor and they see it in their app.
          </EmptyState>
        </Panel>
      </div>
    );
  const open = rows.filter((r) => r.status === "OPEN").length;
  return (
    <div className="flex flex-col gap-3">
      {add}
      <Panel title={`Requirements · ${rows.length}${open ? ` · ${open} open` : ""}`}>
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
              <span className="mt-0.5 h-8 w-2" style={{ background: r.vendorCategory?.color ?? "#E6DCCB" }} aria-hidden="true" />
              <span className="flex flex-col leading-tight">
                <span className="text-[14.5px] font-semibold">
                  {r.title}
                  {r.quantity ? ` · ${Number(r.quantity)}${r.unit ? ` ${r.unit}` : ""}` : ""}
                </span>
                <span className="text-[12.5px] text-ink-quiet">
                  {r.function?.name ?? "Whole booking"}
                  {r.vendorCategory ? ` · ${r.vendorCategory.name}` : ""}
                  {r.source === "CLIENT" ? " · asked by the client" : ""}
                  {r.vendorAssignment ? ` · ${r.vendorAssignment.vendor.companyName}` : ""}
                </span>
                {r.description && <span className="text-[13px]">{r.description}</span>}
              </span>
              <Tag tone={NEED_TONE[r.status]}>{NEED_WORDS[r.status]}</Tag>
              {edits && (
                <span className="col-span-3 col-start-2">
                  <RequirementEditor
                    eventId={eventId}
                    functions={functions}
                    categories={categories}
                    jobs={jobOptions}
                    req={{ id: r.id, functionId: r.functionId, vendorCategoryId: r.vendorCategoryId, title: r.title, description: r.description, quantity: r.quantity ? Number(r.quantity) : null, unit: r.unit, source: r.source, status: r.status, vendorAssignmentId: r.vendorAssignmentId }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

async function Vendors({ actor, eventId }: { actor: Actor; eventId: string }) {
  const rows = await getBookingVendors(db, actor, eventId);
  const seesMoney = can(actor, "quotes.view");
  const staff = actor.accountType === "INTERNAL";
  const canRequest = staff && can(actor, "quotes.request");
  const canIssue = staff && can(actor, "workOrders.issue");
  const canSignOff = staff && can(actor, "proof.review");
  const [vendors, departments, functions] = canRequest
    ? await Promise.all([
        invitableVendors(db, actor),
        db.vendorCategory.findMany({
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        }),
        db.eventFunction.findMany({
          where: { eventId },
          orderBy: { startsAt: "asc" },
          select: { id: true, name: true, startsAt: true },
        }),
      ])
    : [[], [], []];
  const invite = canRequest ? (
    <InviteVendorForm
      eventId={eventId}
      vendors={vendors}
      departments={departments}
      functions={functions.map((f) => ({
        id: f.id,
        name: f.name,
        when: `${formatDate(f.startsAt, { weekday: "short", day: "numeric", month: "short" })} ${formatTime(f.startsAt)}`,
      }))}
    />
  ) : null;
  if (!rows.length)
    return (
      <div className="flex flex-col gap-3">
        {invite}
        <Panel>
          <EmptyState title="No vendors yet">
            Vendors asked to quote or booked for this event appear here.
          </EmptyState>
        </Panel>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {invite}
      <Panel
        title={`Vendors · ${rows.length}`}
        action={
          can(actor, "approvals.decide") ? (
            <ButtonLink href="/approvals" variant="ghost">
              Approvals →
            </ButtonLink>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13.5px]">
            <thead>
              <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  Vendor
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Work · functions
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Stage
                </th>
                {seesMoney && (
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-semibold"
                  >
                    Agreed / quote
                  </th>
                )}
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Proof
                </th>
                {staff && (
                  <th
                    scope="col"
                    className="px-3.5 py-2 text-right font-semibold"
                  >
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const step = vendorStageIndex(r.status);
                const needsYou = r.status === "QUOTED";
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-rule-soft last:border-b-0 ${needsYou ? "bg-look/15" : ""}`}
                  >
                    <td className="px-3.5 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <span
                          className="h-8 w-2 shrink-0"
                          style={{ background: r.color }}
                          aria-hidden="true"
                        />
                        <span className="flex flex-col leading-tight">
                          <span className="font-bold">{r.vendor}</span>
                          <span className="text-[12px] text-ink-quiet">
                            {r.department ?? ""}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col leading-tight">
                        <span>{r.scope}</span>
                        <span className="text-[12px] text-ink-quiet">
                          {r.functions.join(" · ") || "—"}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col gap-1">
                        <span
                          role="img"
                          aria-label={`Stage ${step} of ${VENDOR_STAGES.length}`}
                          className="grid w-36 grid-cols-6 gap-0.5"
                        >
                          {VENDOR_STAGES.map((st, i) => (
                            <span
                              key={st}
                              className={`h-1.5 ${i < step ? "bg-ink" : "bg-rule-soft"}`}
                            />
                          ))}
                        </span>
                        <span
                          className={`font-mono text-[11px] font-semibold uppercase ${needsYou ? "text-plum" : ""}`}
                        >
                          {VENDOR_STAGE_WORDS[r.status] ?? r.status}
                        </span>
                        {r.workOrder && (
                          <span className="font-mono text-[11px] text-ink-quiet">
                            {r.workOrder.number}
                            {r.workOrder.status === "ISSUED"
                              ? " · waiting for vendor"
                              : ""}
                          </span>
                        )}
                      </span>
                    </td>
                    {seesMoney && (
                      <td className="px-3 py-2.5 text-right font-mono">
                        {r.agreed !== null
                          ? formatINR(r.agreed)
                          : r.latestQuote
                            ? `${formatINR(r.latestQuote.total)} (v${r.latestQuote.version})`
                            : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right font-mono">
                      {r.proofCount ? (
                        <Link href={`/bookings/${eventId}?tab=proof`}>
                          {r.proofCount}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    {staff && (
                      <td className="px-3.5 py-2.5 text-right">
                        {can(actor, "chat.direct") && !["DECLINED", "CANCELLED"].includes(r.status) && (
                          <a href={`/api/v1/channels/open?type=VENDOR_THREAD&eventId=${eventId}&vendorId=${r.vendorId}`} className="label-mono mr-2 inline-flex min-h-9 items-center text-[11.5px] font-semibold">
                            Message
                          </a>
                        )}
                        <VendorRowActions
                          eventId={eventId}
                          jobId={r.id}
                          vendor={r.vendor}
                          canIssue={
                            canIssue && r.status === "APPROVED" && !r.workOrder
                          }
                          canSignOff={canSignOff && r.status === "DELIVERED"}
                          canWithdraw={
                            canRequest &&
                            ["INVITED", "QUOTED", "APPROVED"].includes(r.status)
                          }
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

async function Crew({ actor, eventId }: { actor: Actor; eventId: string }) {
  const staff = actor.accountType === "INTERNAL";
  const [rows, onBooking] = await Promise.all([
    getBookingCrew(db, actor, eventId),
    isOnBooking(actor, eventId),
  ]);
  const seesPay = can(actor, "crew.pay.view");
  const canAssign = staff && can(actor, "crew.assign") && (actor.grants.get("crew.assign") === "ALL" || onBooking);
  const canMark = staff && can(actor, "attendance.mark") && (actor.grants.get("attendance.mark") === "ALL" || onBooking);
  const [workers, functions] = canAssign
    ? await Promise.all([
        crewForBooking(db, actor, eventId),
        db.eventFunction.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, select: { id: true, name: true, startsAt: true } }),
      ])
    : [[], []];
  const add = canAssign ? (
    <AddCrewForm
      eventId={eventId}
      seesPay={seesPay}
      workers={workers}
      functions={functions.map((f) => ({
        id: f.id,
        name: f.name,
        when: `${formatDate(f.startsAt, { weekday: "short", day: "numeric", month: "short" })} ${formatTime(f.startsAt)}`,
        defaultReport: formatTime(new Date(f.startsAt.getTime() - 2 * 3600_000)),
      }))}
    />
  ) : null;
  const active = rows.filter((r) => !["DECLINED", "CANCELLED"].includes(r.status));
  const closed = rows.filter((r) => ["DECLINED", "CANCELLED"].includes(r.status));
  if (!rows.length)
    return (
      <div className="flex flex-col gap-3">
        {add}
        <Panel>
          <EmptyState title="No crew yet">
            Crew booked for this event appear here.
          </EmptyState>
        </Panel>
      </div>
    );
  const now = new Date();
  const waiting = active.filter((r) => r.status === "ASSIGNED").length;
  return (
    <div className="flex flex-col gap-3">
      {add}
      <Panel title={`Crew · ${active.length}${waiting ? ` · ${waiting} not answered yet` : ""}`}>
        <ul>
          {active.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-1 gap-2 border-b border-rule-soft px-3.5 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-start"
            >
              <span className="flex flex-col leading-tight">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.name}</span>
                  {r.status === "ASSIGNED" && <Tag tone="look">Not answered</Tag>}
                  {r.status === "CONFIRMED" && <Tag tone="ok">Confirmed</Tag>}
                </span>
                <span className="text-[12.5px] text-ink-quiet">
                  {r.duty}
                  {r.skills.length ? ` · ${r.skills.join(", ")}` : ""} ·{" "}
                  {formatPhone(r.phone)}
                </span>
              </span>
              <ul className="flex flex-col gap-2">
                {r.shifts.map((s) => {
                  const window = attendanceWindow(s.reportAt, now);
                  return (
                    <li key={s.id} className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_260px]">
                      <span className="text-[13px]">
                        <strong>{s.function ?? "Shift"}</strong> ·{" "}
                        {formatDate(s.reportAt, { weekday: "short", day: "numeric" })}{" "}
                        <span className="font-mono">{formatTime(s.reportAt)}</span>
                        {s.location ? ` · ${s.location}` : ""}
                        {s.checkInAt ? (
                          <span className="text-ink-quiet"> · in at {formatTime(s.checkInAt)}{s.selfCheckIn ? " (self)" : ""}</span>
                        ) : null}
                      </span>
                      {canMark ? (
                        <AttendanceButtons
                          shiftId={s.id}
                          name={r.name}
                          current={s.attendance}
                          disabledReason={window === "early" ? "Opens on the day" : window === "closed" && !actor.isOwner ? "Shift over" : null}
                        />
                      ) : (
                        <Tag tone={s.attendance === "PRESENT" ? "ok" : s.attendance === "LATE" ? "look" : s.attendance === "ABSENT" ? "now" : "quiet"}>{s.attendance}</Tag>
                      )}
                    </li>
                  );
                })}
              </ul>
              <span className="flex flex-col items-end gap-1 text-right">
                {seesPay && (
                  <span className="font-mono text-[13.5px]">
                    {formatINR(r.pay)}
                    {r.pendingExtras ? (
                      <span className="block text-[11.5px] text-plum">
                        {r.pendingExtras} extra waiting
                      </span>
                    ) : null}
                  </span>
                )}
                {canAssign && r.shifts.every((s) => s.attendance === "PENDING") && <RemoveCrew assignmentId={r.id} name={r.name} />}
                {(canAssign || canMark) && r.status === "CONFIRMED" && <AdjustmentForm assignmentId={r.id} name={r.name} />}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      {closed.length > 0 && (
        <Panel title={`Declined or taken off · ${closed.length}`}>
          <ul>
            {closed.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-rule-soft px-3.5 py-2 text-[13.5px] text-ink-quiet last:border-b-0">
                <span>
                  <strong className="text-ink">{r.name}</strong> · {r.duty}
                </span>
                <span>
                  {r.status === "DECLINED" ? "Declined" : "Taken off"}
                  {r.declineReason ? `: ${r.declineReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

async function isOnBooking(actor: Actor, eventId: string) {
  if (actor.isOwner) return true;
  return (await db.eventMember.count({ where: { eventId, userId: actor.userId } })) > 0;
}

async function Tasks({ actor, eventId }: { actor: Actor; eventId: string }) {
  const [tasks, onBooking] = await Promise.all([
    getBookingTasks(db, actor, eventId),
    isOnBooking(actor, eventId),
  ]);
  const canCreate = actor.accountType === "INTERNAL" && can(actor, "tasks.create") && (actor.grants.get("tasks.create") === "ALL" || onBooking);
  const [people, functions] = canCreate
    ? await Promise.all([
        assignableForBooking(db, eventId),
        db.eventFunction.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, select: { id: true, name: true } }),
      ])
    : [[], []];
  const add = canCreate ? <AddTaskForm eventId={eventId} people={people} functions={functions} /> : null;
  if (!tasks.length)
    return (
      <div className="flex flex-col gap-3">
        {add}
        <Panel>
          <EmptyState title="No tasks" />
        </Panel>
      </div>
    );
  const tone = (s: string) =>
    s === "DELAYED"
      ? "now"
      : s === "UNDER_REVIEW"
        ? "look"
        : s === "IN_PROGRESS"
          ? "plum"
          : s === "COMPLETED"
            ? "ok"
            : s === "PENDING"
              ? "quiet"
              : "outline";
  const waiting = tasks.filter((t) => t.status === "UNDER_REVIEW").length;
  return (
    <div className="flex flex-col gap-3">
      {add}
      <Panel title={`Tasks · ${tasks.length}${waiting ? ` · ${waiting} to check` : ""}`}>
        <ul>
          {tasks.map((t) => {
            const actions = taskActions(actor, t, { onBooking, proofCount: t._count.proofs });
            return (
              <li
                key={t.id}
                className="grid grid-cols-1 items-center gap-2 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-[14.5px] font-semibold">{t.title}</span>
                  <span className="text-[12.5px] text-ink-quiet">
                    {t.function?.name ? `${t.function.name} · ` : ""}
                    {t.assignee?.name ?? "Not assigned"}
                    {t.dueAt
                      ? ` · due ${formatDate(t.dueAt)} ${formatTime(t.dueAt)}`
                      : ""}
                    {t.needsProof ? " · needs proof" : ""}
                    {t._count.proofs ? (
                      <>
                        {" · "}
                        <Link href={`/bookings/${eventId}?tab=proof`}>{t._count.proofs} proof sent</Link>
                      </>
                    ) : null}
                  </span>
                  {t.comments[0] && t.status !== "COMPLETED" && (
                    <span className="text-[12.5px] font-semibold text-now">
                      {t.comments[0].author?.name ?? "Team"}: {t.comments[0].body}
                    </span>
                  )}
                </span>
                <Tag tone={tone(t.status)}>{t.status.replace("_", " ")}</Tag>
                <TaskButtons taskId={t.id} actions={actions} />
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

async function Proof({ actor, eventId }: { actor: Actor; eventId: string }) {
  const items = can(actor, "proof.view")
    ? await listProof(db, actor, { eventId })
    : [];
  if (!items.length)
    return (
      <Panel>
        <EmptyState title="No proof yet">
          Photos and videos that vendors and crew send for this booking
          appear here.
        </EmptyState>
      </Panel>
    );
  const waiting = items.filter((p) => p.status === "PENDING_REVIEW").length;
  return (
    <Panel
      title={`Proof · ${items.length}${waiting ? ` · ${waiting} to check` : ""}`}
    >
      <div className="p-3.5">
        <ProofGrid items={items} />
      </div>
    </Panel>
  );
}

async function Docs({ actor, eventId }: { actor: Actor; eventId: string }) {
  if (!can(actor, "documents.view"))
    return (
      <Panel>
        <EmptyState title="Documents are not part of your access" />
      </Panel>
    );
  const [docs, vendors] = await Promise.all([
    listDocuments(db, actor, eventId),
    db.vendorAssignment.findMany({ where: { eventId, status: { notIn: ["DECLINED", "CANCELLED"] } }, select: { vendor: { select: { id: true, companyName: true } } } }),
  ]);
  const uploads = actor.accountType === "INTERNAL" && can(actor, "documents.upload");
  const vendorOptions = [...new Map(vendors.map((v) => [v.vendor.id, { id: v.vendor.id, name: v.vendor.companyName }])).values()];
  return (
    <div className="flex flex-col gap-3">
      {uploads && <AddDocumentForm eventId={eventId} vendors={vendorOptions} ownerOnly={can(actor, "documents.confidential")} />}
      <Panel title={`Documents · ${docs.length}`}>
        {docs.length ? (
          <DocumentList docs={docs} staff />
        ) : (
          <EmptyState title="No documents yet">
            Contracts, layouts, designs and menus. Choose who sees each one; share plans with the vendors or crew who need them.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}

const PAY_TONE: Record<string, "look" | "ok" | "now" | "quiet" | "plum" | "outline"> = { PENDING_APPROVAL: "look", APPROVED: "plum", PAID: "ok", REJECTED: "quiet", VOIDED: "quiet" };
const PAY_WORDS: Record<string, string> = { PENDING_APPROVAL: "Waiting for host", APPROVED: "Approved · to pay", PAID: "Paid", REJECTED: "Not approved", VOIDED: "Void" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "now" }) {
  return (
    <div className="lift rounded-[18px] border border-line bg-white px-4 py-3 shadow-[var(--shadow-card)]">
      <dt className="text-[13px] font-medium text-ink-quiet">{label}</dt>
      <dd className={`font-condensed text-[24px] leading-tight tabular-nums ${tone === "ok" ? "text-ok-text" : tone === "now" ? "text-now" : ""}`}>{value}</dd>
    </div>
  );
}

async function Money({ actor, eventId }: { actor: Actor; eventId: string }) {
  const [ledger, budget, settlement, invoices, ev] = await Promise.all([bookingLedger(db, actor, eventId), budgetView(db, actor, eventId), settlementView(db, actor, eventId), bookingInvoices(db, actor, eventId), db.event.findUnique({ where: { id: eventId }, select: { status: true } })]);
  if (!ledger)
    return (
      <Panel>
        <EmptyState title="Money is not part of your access" />
      </Panel>
    );
  const today = todayInIndia();
  // A settled booking's money is locked (an owner can reopen it).
  const locked = ev?.status === "SETTLED";
  const prepares = can(actor, "payments.prepare") && !locked;
  const pays = can(actor, "payments.markPaid") && !locked;
  const voids = (can(actor, "payments.markPaid") || actor.isOwner) && !locked;
  const receipts = ledger.payments.filter((p) => p.direction === "IN");
  const outs = ledger.payments.filter((p) => p.direction === "OUT");
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ledger.billing && <Stat label="Billed (before GST)" value={formatINR(ledger.billed)} />}
        {ledger.billing && <Stat label="Received" value={formatINR(ledger.received)} tone="ok" />}
        {ledger.billing && <Stat label="Client still owes" value={formatINR(ledger.clientBalance!)} tone={ledger.clientBalance! > 0 ? "now" : undefined} />}
        <Stat label="Vendor costs" value={formatINR(ledger.vendorCost)} />
        {ledger.seesPay && <Stat label="Crew pay" value={formatINR(ledger.crewCost)} />}
        {ledger.expenseCost > 0 && <Stat label="Expenses" value={formatINR(ledger.expenseCost)} />}
        <Stat label="Paid out" value={formatINR(ledger.paidOut)} />
        {ledger.margin !== null && <Stat label="Margin before tax" value={formatINR(ledger.margin)} tone={ledger.margin < 0 ? "now" : "ok"} />}
      </dl>

      {settlement ? <SettlementPanel eventId={eventId} s={settlement} /> : locked ? <Notice tone="ok">This booking is settled. Its money is final and locked.</Notice> : null}

      {budget && <BudgetPanel eventId={eventId} budget={budget} />}

      {ledger.billing && (
        <div className="flex flex-wrap items-start gap-4">
          <Panel title="Client charges" className="min-w-0 flex-[1_1_420px]">
            <ul>
              {ledger.charges.map((c) => (
                <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2 text-[14px]">
                  <span>{c.description}</span>
                  <span className="text-right font-mono">
                    {formatINR(c.amount)}
                    <span className="block text-[11.5px] text-ink-quiet">+ GST {c.gstRate}% {formatINR(c.gst)}</span>
                  </span>
                  {can(actor, "finance.billing") && !locked ? <RemoveCharge id={c.id} /> : <span />}
                </li>
              ))}
              {ledger.charges.length === 0 && <li className="px-3.5 py-3 text-[14px] text-ink-quiet">Nothing charged yet.</li>}
            </ul>
            {!locked && (
              <div className="border-t border-line px-3.5 py-2.5">
                <ChargeForm eventId={eventId} />
              </div>
            )}
          </Panel>
          <Panel title="Received from the client" className="min-w-0 flex-[1_1_420px]">
            <ul>
              {receipts.map((p) => (
                <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2 text-[14px]">
                  <span className="flex flex-col leading-tight">
                    <span className={p.status === "VOIDED" ? "line-through" : ""}>
                      {p.paidOn ? formatCalendarDate(p.paidOn, { day: "numeric", month: "short", year: "numeric" }) : ""} · {p.method.toLowerCase()}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    {p.tds > 0 && <span className="text-[12.5px] text-ink-quiet">+ TDS kept by the client {formatINR(p.tds, { decimals: true })}</span>}
                    {p.voidReason && <span className="text-[12.5px] text-now">Void: {p.voidReason}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{formatINR(p.amount)}</span>
                    {voids && p.status === "PAID" && <VoidPayment paymentId={p.id} />}
                  </span>
                </li>
              ))}
              {receipts.length === 0 && <li className="px-3.5 py-3 text-[14px] text-ink-quiet">No payments received yet.</li>}
            </ul>
            {can(actor, "payments.recordIn") && !locked && (
              <div className="border-t border-line px-3.5 py-2.5">
                <ReceiptForm eventId={eventId} today={today} />
              </div>
            )}
          </Panel>
        </div>
      )}

      {invoices && <ClientInvoicesPanel eventId={eventId} inv={invoices} locked={locked} today={today} />}

      <Panel title={`Vendors · ${ledger.vendors.length}`}>
        {ledger.vendors.length === 0 ? (
          <EmptyState title="No booked vendors yet" />
        ) : (
          <ul>
            {ledger.vendors.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 border-b border-rule-soft px-3.5 py-3 last:border-b-0">
                <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <span className="flex flex-col leading-tight">
                    <span className="font-bold">{v.vendor}</span>
                    <span className="text-[12.5px] text-ink-quiet">
                      {v.scope} · {v.approvedProof ? `${v.approvedProof} approved proof` : "no approved proof yet"}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[13px]">
                    Agreed {formatINR(v.agreed)}
                    <span className="block text-ink-quiet">invoiced {formatINR(v.invoiced)} · paid {formatINR(v.paid)}</span>
                  </span>
                </span>
                {v.invoices.length > 0 && (
                  <ul className="flex flex-col gap-1.5 border-l-2 border-rule-soft pl-3">
                    {v.invoices.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                        <span>
                          {i.file?.originalUrl ? (
                            <a href={i.file.originalUrl} target="_blank" rel="noopener" className="font-mono font-semibold">
                              {i.number}
                            </a>
                          ) : (
                            <span className="font-mono font-semibold">{i.number}</span>
                          )}{" "}
                          · {formatINR(i.total)} · <span className="font-mono text-[11.5px] uppercase">{i.status.replace("_", " ")}</span>
                          {i.waiting ? ` · ${formatINR(i.waiting)} waiting` : ""}
                        </span>
                        {prepares && ["VERIFIED", "APPROVED", "PART_PAID"].includes(i.status) && i.left > 0.005 && <PreparePayment kind="VENDOR_INVOICE" id={i.id} left={i.left} />}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {ledger.seesPay && (
        <Panel title={`Crew pay · ${ledger.crew.length}`}>
          {ledger.crew.length === 0 ? (
            <EmptyState title="No confirmed crew yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                    <th scope="col" className="px-3.5 py-2 font-semibold">Crew</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Worked</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Agreed</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Extras</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Paid</th>
                    <th scope="col" className="px-3.5 py-2 text-right font-semibold"><span className="sr-only">Pay</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.crew.map((c) => (
                    <tr key={c.id} className="border-b border-rule-soft align-top last:border-b-0">
                      <td className="px-3.5 py-2.5">
                        <span className="font-bold">{c.name}</span>
                        <span className="block text-[12px] text-ink-quiet">{c.duty}</span>
                        {c.adjustments.map((a) => (
                          <span key={a.id} className="block text-[12px]">
                            {a.type === "EXTRA" ? "+" : "−"}
                            {formatINR(a.amount)} {a.reason} · <span className={a.state === "APPROVED" ? "text-ok-text" : a.state === "PENDING" ? "text-plum" : "text-ink-quiet"}>{a.state.toLowerCase()}</span>
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {c.worked}/{c.shifts}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatINR(c.agreed)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{c.extras ? formatINR(c.extras) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{formatINR(c.total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {formatINR(c.paid)}
                        {c.waiting ? <span className="block text-[11.5px] text-plum">{formatINR(c.waiting)} waiting</span> : null}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        {prepares && c.left > 0.005 ? (
                          <PreparePayment kind="CREW" id={c.id} left={c.left} label="Pay" />
                        ) : c.left <= 0.005 && c.paid >= c.total - 0.005 ? (
                          <Tag tone="ok">SETTLED</Tag>
                        ) : c.left <= 0.005 ? (
                          <Tag tone="look">BEING PAID</Tag>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title={`Payments out · ${outs.length}`}>
        {outs.length === 0 ? (
          <EmptyState title="No payments yet" />
        ) : (
          <ul>
            {outs.map((p) => (
              <li key={p.id} className="grid grid-cols-1 items-center gap-2 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <span className="flex flex-col leading-tight">
                  <span className="font-semibold">
                    {p.party}
                    {p.invoice ? <span className="font-mono text-[12px] text-ink-quiet"> · {p.invoice}</span> : null}
                  </span>
                  <span className="text-[12.5px] text-ink-quiet">
                    {p.paidOn ? `Paid ${formatCalendarDate(p.paidOn, { day: "numeric", month: "short" })} · ` : `Prepared ${formatDate(p.createdAt, { day: "numeric", month: "short" })} · `}
                    {p.method.toLowerCase()}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                  {p.voidReason && <span className="text-[12.5px] text-now">Void: {p.voidReason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`font-mono font-semibold ${p.status === "VOIDED" ? "line-through" : ""}`}>{formatINR(p.amount)}</span>
                  <Tag tone={PAY_TONE[p.status] ?? "outline"}>{PAY_WORDS[p.status] ?? p.status}</Tag>
                </span>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {pays && p.status === "APPROVED" && <MarkPaid paymentId={p.id} method={p.method} today={today} />}
                  {voids && ["PENDING_APPROVAL", "APPROVED", "PAID"].includes(p.status) && <VoidPayment paymentId={p.id} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const INVOICE_TONE: Record<string, "ok" | "look" | "quiet" | "plum" | "outline"> = { DRAFT: "outline", ISSUED: "plum", PART_PAID: "look", PAID: "ok", CANCELLED: "quiet" };

function ClientInvoicesPanel({ eventId, inv, locked, today }: { eventId: string; inv: BookingInvoices; locked: boolean; today: string }) {
  const manage = inv.manages && !locked;
  const c = inv.client;
  return (
    <Panel title={`Client GST invoices · ${inv.invoices.filter((i) => i.status !== "DRAFT").length}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 text-[13.5px]">
        <span className="flex flex-col leading-snug">
          <span className="label-mono text-[11px] text-ink-quiet">Bill to</span>
          <span className="font-semibold">
            {c.name}
            {c.gstin ? <span className="font-mono text-[12.5px]"> · GSTIN {c.gstin}</span> : <span className="text-ink-quiet"> · not GST registered</span>}
          </span>
          <span className="text-ink-quiet">{[c.address, c.city, c.state].filter(Boolean).join(", ") || "No billing address yet"}</span>
          <span>
            Place of supply: {c.placeName ?? "not known"} · {c.interState ? "IGST" : "CGST + SGST"}
          </span>
        </span>
        {manage && <BillingDetailsForm eventId={eventId} client={c} />}
      </div>
      {inv.manages && !inv.companyReady && (
        <p className="border-b border-rule-soft px-3.5 py-2 text-[13px] text-now">
          Add the company&apos;s GSTIN and address in <Link href="/settings">Settings</Link> before issuing invoices.
        </p>
      )}
      <ul>
        {inv.invoices.map((i) => (
          <li key={i.id} className="flex flex-col gap-1.5 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">
                  <Link href={`/invoices/client/${i.id}`} className={`font-mono ${i.status === "CANCELLED" ? "line-through" : ""}`}>
                    {i.number ?? "Draft"}
                  </Link>{" "}
                  · {i.type.toLowerCase()} · <span className="font-mono">{formatINR(i.total, { decimals: true })}</span>
                </span>
                <span className="text-[12.5px] text-ink-quiet">
                  {i.issueDate ? `${formatCalendarDate(i.issueDate, { day: "numeric", month: "short", year: "numeric" })} · ` : ""}
                  {formatINR(i.subtotal)} + GST {formatINR(i.tax, { decimals: true })} · {i.lines.map((l) => l.description).join(", ")}
                </span>
                {i.cancelReason && <span className="text-[12.5px] text-now">Cancelled: {i.cancelReason}</span>}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <Tag tone={INVOICE_TONE[i.status] ?? "outline"}>{i.status.replace("_", " ")}</Tag>
                {manage && i.status === "DRAFT" && <IssueInvoice invoiceId={i.id} today={today} />}
                {manage && i.status === "DRAFT" && <DeleteDraft invoiceId={i.id} />}
                {manage && ["ISSUED", "PART_PAID", "PAID"].includes(i.status) && <CancelInvoice invoiceId={i.id} />}
              </span>
            </span>
          </li>
        ))}
        {inv.invoices.length === 0 && <li className="px-3.5 py-3 text-[14px] text-ink-quiet">No invoices yet.</li>}
      </ul>
      {manage && (
        <div className="border-t border-line px-3.5 py-2.5">
          <NewInvoiceForm eventId={eventId} charges={inv.charges} />
        </div>
      )}
    </Panel>
  );
}

function SettlementPanel({ eventId, s }: { eventId: string; s: SettlementView }) {
  if (s.settled) {
    const f = s.settled.figures;
    return (
      <Panel title="Settled" tone="paper" action={s.canSettle ? <ReopenBooking eventId={eventId} /> : <Tag tone="ok">LOCKED</Tag>}>
        <div className="flex flex-col gap-1 px-3.5 py-3 text-[14px]">
          <p>
            Settled {formatDate(s.settled.at, { day: "numeric", month: "short", year: "numeric" })}
            {s.settled.by ? ` by ${s.settled.by}` : ""}. The figures below are final and the booking&apos;s money is locked.
            {s.settled.note ? <span className="text-ink-quiet"> · {s.settled.note}</span> : null}
          </p>
          <p className="font-mono text-[13px]">
            Billed {formatINR(f.billed)} + GST {formatINR(f.gst)} · received {formatINR(f.received)} · costs {formatINR(f.vendorCost + f.crewCost + f.expenseCost)} · paid out {formatINR(f.paidOut)} · margin <strong>{formatINR(f.margin)}</strong>
          </p>
        </div>
      </Panel>
    );
  }
  const open = s.checks.filter((c) => !c.ok && c.level === "block").length;
  return (
    <Panel title={s.ready ? "Ready to settle" : `Settlement · ${open} to clear`} action={s.canSettle ? <SettleBooking eventId={eventId} ready={s.ready} /> : undefined}>
      <ul aria-label="Settlement checklist">
        {s.checks.map((c, i) => (
          <li key={`${c.key}-${i}`} className="flex gap-3 border-b border-rule-soft px-3.5 py-2 text-[14px] last:border-b-0">
            <span aria-hidden className={`label-mono w-5 shrink-0 text-center font-bold ${c.ok ? "text-ok-text" : c.level === "warn" ? "text-plum" : "text-now"}`}>
              {c.ok ? "✓" : c.level === "warn" ? "!" : "✗"}
            </span>
            <span className="flex flex-col leading-snug">
              <span className={c.ok ? "" : "font-semibold"}>
                <span className="sr-only">{c.ok ? "Done: " : c.level === "warn" ? "Note: " : "To do: "}</span>
                {c.label}
              </span>
              {c.details.map((d) => (
                <span key={d} className="text-[12.5px] text-ink-quiet">
                  {d}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {!s.canSettle && s.ready && <p className="border-t border-rule-soft px-3.5 py-2 text-[13px] text-ink-quiet">Everything is clear. A host can settle it.</p>}
    </Panel>
  );
}

function BudgetPanel({ eventId, budget }: { eventId: string; budget: NonNullable<Awaited<ReturnType<typeof budgetView>>> }) {
  const editing = budget.draft && !budget.pending;
  return (
    <Panel
      title={`Budget${budget.approved ? ` · v${budget.approved.version} approved` : budget.draft ? " · draft" : ""}`}
      action={budget.pending ? <Tag tone="look">WAITING FOR A HOST</Tag> : undefined}
    >
      {budget.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
            <thead>
              <tr className="label-mono border-b border-line text-left text-[11px] text-ink-quiet">
                <th scope="col" className="px-3.5 py-2 font-semibold">Kind of cost</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Estimate</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Actual so far</th>
                <th scope="col" className="px-3.5 py-2 text-right font-semibold">Left</th>
              </tr>
            </thead>
            <tbody>
              {budget.rows.map((r) => (
                <tr key={r.category} className={`border-b border-rule-soft ${r.over ? "bg-[#B5391C10]" : ""}`}>
                  <td className="px-3.5 py-2">{r.category}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.estimate ? formatINR(r.estimate) : "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.over ? "font-semibold text-now" : ""}`}>{formatINR(r.actual)}</td>
                  <td className={`px-3.5 py-2 text-right font-mono ${r.over ? "text-now" : ""}`}>{r.estimate ? formatINR(r.estimate - r.actual) : "—"}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3.5 py-2">Total</td>
                <td className="px-3 py-2 text-right font-mono">{formatINR(budget.estimateTotal)}</td>
                <td className={`px-3 py-2 text-right font-mono ${budget.actualTotal > budget.estimateTotal && budget.estimateTotal > 0 ? "text-now" : ""}`}>{formatINR(budget.actualTotal)}</td>
                <td className="px-3.5 py-2 text-right font-mono">{budget.estimateTotal ? formatINR(budget.estimateTotal - budget.actualTotal) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {budget.draft && (
        <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3">
          <p className="label-mono text-[11.5px]">
            Draft v{budget.draft.version} · {formatINR(budget.draft.total)}
            {budget.approved ? ` (approved: ${formatINR(budget.approved.total)})` : ""}
          </p>
          <ul className="flex flex-col">
            {budget.draft.lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 border-b border-rule-soft py-1 text-[13.5px]">
                <span>
                  {l.category}
                  {l.description ? <span className="text-ink-quiet"> · {l.description}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{formatINR(l.amount)}</span>
                  {editing && <RemoveBudgetLine eventId={eventId} lineId={l.id} />}
                </span>
              </li>
            ))}
          </ul>
          {editing && <BudgetLineForm eventId={eventId} categories={budget.categories} />}
          {editing && budget.draft.lines.length > 0 && <BudgetButtons eventId={eventId} mode="submit" />}
        </div>
      )}
      {!budget.draft && (
        <div className="flex flex-col gap-2 px-3.5 py-3">
          {!budget.approved && <p className="text-[14px] text-ink-quiet">No budget yet. Add what each kind of cost should come to; the hosts approve it.</p>}
          {budget.approved ? <BudgetButtons eventId={eventId} mode="revise" /> : <BudgetLineForm eventId={eventId} categories={budget.categories} />}
        </div>
      )}
    </Panel>
  );
}
