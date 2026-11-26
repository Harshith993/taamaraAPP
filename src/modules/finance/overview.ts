/**
 * Reading money: one booking's ledger, and the company overview.
 *
 * Shown only to people allowed to see it: client billing and margin need finance.billing (owners,
 * accountant; never managers, D11); costs need finance.budget; crew pay needs crew.pay.view; the
 * company overview needs finance.company. Amounts are as recorded: vendor costs include the GST on
 * their invoices; client charges are shown before GST with the GST beside them.
 */
import type { Db } from "@/lib/db";
import { toNumber } from "@/lib/format";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, paymentWhere } from "@/modules/identity/policy";
import { bookingFigures } from "./figures";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function bookingLedger(db: Db, actor: Actor, eventId: string) {
  const billing = can(actor, "finance.billing");
  const costs = can(actor, "finance.budget");
  if (actor.accountType !== "INTERNAL" || (!billing && !costs)) return null;
  await assertEventAccess(db, actor, eventId, costs ? "finance.budget" : "bookings.view");
  const seesPay = can(actor, "crew.pay.view");

  const [charges, payments, jobs, crew] = await Promise.all([
    billing ? db.clientCharge.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } }) : [],
    db.payment.findMany({
      where: { AND: [{ eventId }, paymentWhere(actor)] },
      orderBy: { createdAt: "desc" },
      include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } }, client: { select: { name: true } }, vendorInvoice: { select: { invoiceNumber: true } } },
    }),
    costs
      ? db.vendorAssignment.findMany({
          where: { eventId, status: { notIn: ["DECLINED", "CANCELLED", "INVITED", "QUOTED"] } },
          orderBy: { createdAt: "asc" },
          include: {
            vendor: { select: { companyName: true } },
            workOrders: {
              select: {
                number: true,
                amount: true,
                invoices: { orderBy: { createdAt: "asc" }, include: { file: { select: MEDIA_SELECT }, payments: { select: { amount: true, status: true } } } },
              },
            },
            _count: { select: { proofs: { where: { status: "APPROVED" } } } },
          },
        })
      : [],
    costs && seesPay
      ? db.crewAssignment.findMany({
          where: { eventId, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } },
          orderBy: { createdAt: "asc" },
          include: {
            worker: { select: { name: true } },
            adjustments: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, amount: true, reason: true, state: true } },
            payments: { select: { amount: true, status: true } },
            _count: { select: { shifts: true } },
          },
        })
      : [],
  ]);

  const sum = (xs: { amount: unknown; status: string }[], statuses: string[]) => round2(xs.filter((x) => statuses.includes(x.status)).reduce((s, x) => s + toNumber(x.amount as number), 0));
  const chargeRows = charges.map((c) => ({ id: c.id, description: c.description, amount: toNumber(c.amount), gstRate: toNumber(c.gstRate), gst: round2((toNumber(c.amount) * toNumber(c.gstRate)) / 100) }));
  const billed = round2(chargeRows.reduce((s, c) => s + c.amount, 0));
  const billedGst = round2(chargeRows.reduce((s, c) => s + c.gst, 0));
  const received = sum(payments.filter((p) => p.direction === "IN") as never, ["PAID"]);
  const tds = round2(payments.filter((p) => p.direction === "IN" && p.status === "PAID").reduce((s, p) => s + toNumber(p.tdsAmount), 0));

  const vendorRows = jobs.map((j) => {
    const invoices = j.workOrders.flatMap((w) =>
      w.invoices.map((i) => {
        const paid = sum(i.payments as never, ["PAID"]);
        const waiting = sum(i.payments as never, ["PENDING_APPROVAL", "APPROVED"]);
        return { id: i.id, number: i.invoiceNumber, status: i.status, total: toNumber(i.total), paid, waiting, left: round2(toNumber(i.total) - paid - waiting), file: i.file ? mediaView(actor.userId, i.file, { original: true }) : null, workOrder: w.number };
      }),
    );
    const live = invoices.filter((i) => !["DISPUTED", "VOID"].includes(i.status));
    return {
      id: j.id,
      vendor: j.vendor.companyName,
      scope: j.scopeOfWork,
      status: j.status,
      agreed: j.agreedAmount ? toNumber(j.agreedAmount) : 0,
      invoiced: round2(live.reduce((s, i) => s + i.total, 0)),
      // Everything paid to this vendor on the booking, including advances paid before any invoice.
      paid: round2(payments.filter((p) => p.direction === "OUT" && p.status === "PAID" && p.vendorId === j.vendorId).reduce((s, p) => s + toNumber(p.amount), 0)),
      approvedProof: j._count.proofs,
      invoices,
    };
  });

  const crewRows = crew.map((a) => {
    const approved = a.adjustments.filter((x) => x.state === "APPROVED");
    const extras = approved.reduce((s, x) => s + (x.type === "EXTRA" ? 1 : -1) * toNumber(x.amount), 0);
    const total = round2(toNumber(a.agreedPay) + extras);
    const paid = sum(a.payments as never, ["PAID"]);
    const waiting = sum(a.payments as never, ["PENDING_APPROVAL", "APPROVED"]);
    return {
      id: a.id,
      status: a.status,
      name: a.worker.name,
      duty: a.duty,
      agreed: toNumber(a.agreedPay),
      extras: round2(extras),
      total,
      paid,
      waiting,
      left: round2(total - paid - waiting),
      shifts: a._count.shifts,
      adjustments: a.adjustments.map((x) => ({ ...x, amount: toNumber(x.amount) })),
    };
  });

  const vendorCost = round2(vendorRows.reduce((s, v) => s + v.agreed, 0));
  // No-shows are listed but not paid, so they are not a cost.
  const crewCost = round2(crewRows.filter((c) => c.status !== "NO_SHOW").reduce((s, c) => s + c.total, 0));
  const expenseCost = costs ? round2(toNumber((await db.expense.aggregate({ where: { eventId, status: { in: ["APPROVED", "REIMBURSED"] } }, _sum: { amount: true } }))._sum.amount)) : 0;
  const paidOut = sum(payments.filter((p) => p.direction === "OUT") as never, ["PAID"]);

  return {
    billing,
    seesPay,
    charges: chargeRows,
    billed,
    billedGst,
    received,
    tds,
    clientBalance: billing ? round2(billed + billedGst - received - tds) : null,
    vendors: vendorRows,
    crew: crewRows,
    vendorCost,
    crewCost,
    expenseCost,
    paidOut,
    // Before taxes and overheads: what the client pays (before GST) minus vendor, crew and approved expenses.
    margin: billing ? round2(billed - vendorCost - crewCost - expenseCost) : null,
    payments: payments.map((p) => ({
      id: p.id,
      direction: p.direction,
      party: p.vendor?.companyName ?? p.worker?.name ?? p.client?.name ?? p.partyName ?? p.partyType,
      amount: toNumber(p.amount),
      method: p.method,
      reference: p.reference,
      status: p.status,
      paidOn: p.paidOn,
      createdAt: p.createdAt,
      invoice: p.vendorInvoice?.invoiceNumber ?? null,
      tds: toNumber(p.tdsAmount),
      note: p.note,
      voidReason: p.voidReason,
    })),
  };
}

export type BookingLedger = NonNullable<Awaited<ReturnType<typeof bookingLedger>>>;

/** The owners' and accountant's view across every booking. */
export async function moneyOverview(db: Db, actor: Actor) {
  assertCan(actor, "finance.company", "Only hosts and the accountant see company money.");
  const [toPay, waiting, readyInvoices, events, inSum, outSum] = await Promise.all([
    db.payment.findMany({ where: { direction: "OUT", status: "APPROVED" }, orderBy: { approvedAt: "asc" }, include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } }, event: { select: { id: true, name: true } }, vendorInvoice: { select: { invoiceNumber: true } } } }),
    db.payment.count({ where: { direction: "OUT", status: "PENDING_APPROVAL" } }),
    db.vendorInvoice.findMany({ where: { status: { in: ["VERIFIED", "PART_PAID", "APPROVED"] } }, include: { vendor: { select: { companyName: true } }, payments: { select: { amount: true, status: true } }, workOrder: { select: { number: true, assignment: { select: { event: { select: { id: true, name: true } }, _count: { select: { proofs: { where: { status: "APPROVED" } } } } } } } } } }),
    db.event.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { startDate: "desc" }, take: 60, select: { id: true, name: true, code: true, status: true, startDate: true, client: { select: { name: true } } } }),
    db.payment.aggregate({ where: { direction: "IN", status: "PAID" }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { direction: "OUT", status: "PAID" }, _sum: { amount: true } }),
  ]);
  const figures = await bookingFigures(db, events.map((e) => e.id));

  const bookings = events.map((e) => {
    const f = figures.get(e.id)!;
    return {
      id: e.id,
      name: e.name,
      code: e.code,
      status: e.status,
      startDate: e.startDate,
      client: e.client.name,
      billed: f.billed,
      due: f.due,
      received: f.received,
      costs: round2(f.vendorCost + f.crewCost + f.expenseCost),
      paidOut: f.paidOut,
      margin: f.margin,
    };
  });

  const ready = readyInvoices
    .map((i) => {
      const paid = i.payments.filter((p) => p.status === "PAID").reduce((s, p) => s + toNumber(p.amount), 0);
      const waitingAmt = i.payments.filter((p) => p.status === "PENDING_APPROVAL" || p.status === "APPROVED").reduce((s, p) => s + toNumber(p.amount), 0);
      return { id: i.id, vendor: i.vendor.companyName, number: i.invoiceNumber, total: toNumber(i.total), left: round2(toNumber(i.total) - paid - waitingAmt), event: i.workOrder?.assignment.event ?? null, approvedProof: i.workOrder?.assignment._count.proofs ?? 0 };
    })
    .filter((i) => i.left > 0.005);

  return {
    totals: {
      billed: round2(bookings.reduce((s, b) => s + b.billed, 0)),
      received: round2(toNumber(inSum._sum.amount)),
      due: round2(bookings.reduce((s, b) => s + Math.max(0, b.due), 0)),
      paidOut: round2(toNumber(outSum._sum.amount)),
      toPay: round2(toPay.reduce((s, p) => s + toNumber(p.amount), 0)),
      margin: round2(bookings.reduce((s, b) => s + b.margin, 0)),
    },
    waitingApproval: waiting,
    toPay: toPay.map((p) => ({ id: p.id, party: p.vendor?.companyName ?? p.worker?.name ?? p.partyName ?? p.partyType, amount: toNumber(p.amount), method: p.method, event: p.event, invoice: p.vendorInvoice?.invoiceNumber ?? null, approvedAt: p.approvedAt })),
    readyInvoices: ready,
    bookings,
  };
}
