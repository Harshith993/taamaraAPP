/**
 * The owners' approvals inbox: vendor quotes, payments and crew pay extras.
 *
 * Rules:
 *  - only owners decide (approvals.decide);
 *  - an owner cannot approve a payment they prepared while another owner is active;
 *  - a vendor's final payment needs approved proof of work when the company switch is on;
 *  - rejecting needs a reason; every decision is audited and the requester is notified.
 */
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatINR, toNumber } from "@/lib/format";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { MEDIA_SELECT, mediaView } from "@/modules/files/media";
import { decideBudget } from "@/modules/finance/budgets";
import type { Actor } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/policy";

export type Decision = "APPROVE" | "REJECT" | "REVISE";

async function otherActiveOwners(db: DbTx, userId: string) {
  return db.user.count({ where: { id: { not: userId }, status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { isOwner: true } } } } });
}

/** Everything an owner needs to decide, per pending request. */
export async function listPendingApprovals(db: Db, actor: Actor) {
  assertCan(actor, "approvals.decide", "Only owners can see approvals.");
  const requests = await db.approvalRequest.findMany({
    where: { state: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { requestedBy: { select: { name: true } } },
  });

  return Promise.all(
    requests.map(async (r) => {
      const base = { id: r.id, type: r.type, summary: r.summary, amount: r.amount ? toNumber(r.amount) : null, requestedBy: r.requestedBy?.name ?? null, createdAt: r.createdAt, selfPrepared: false as boolean };
      if (r.type === "QUOTATION") {
        const q = await db.quotation.findUnique({
          where: { id: r.entityId },
          include: {
            items: { orderBy: { sortOrder: "asc" } },
            vendor: { select: { companyName: true } },
            assignment: { include: { event: { select: { id: true, name: true } }, category: { select: { name: true } }, functions: { include: { function: { select: { name: true } } } } } },
          },
        });
        if (!q) return { ...base, kind: "missing" as const };
        // Other vendors' latest quotes for the same department on the same booking, for comparison.
        const rivals = await db.vendorAssignment.findMany({
          where: { eventId: q.assignment.eventId, categoryId: q.assignment.categoryId, id: { not: q.assignmentId }, status: { notIn: ["CANCELLED", "DECLINED"] } },
          include: { vendor: { select: { companyName: true } }, quotations: { orderBy: { version: "desc" }, take: 1, select: { total: true, version: true, status: true } } },
        });
        return {
          ...base,
          kind: "quote" as const,
          event: q.assignment.event,
          vendor: q.vendor.companyName,
          department: q.assignment.category?.name ?? null,
          scope: q.assignment.scopeOfWork,
          functions: q.assignment.functions.map((f) => f.function.name),
          version: q.version,
          subtotal: toNumber(q.subtotal),
          tax: toNumber(q.taxAmount),
          total: toNumber(q.total),
          items: q.items.map((i) => ({ description: i.description, amount: toNumber(i.amount) })),
          rivals: rivals.map((v) => ({ vendor: v.vendor.companyName, total: v.quotations[0] ? toNumber(v.quotations[0].total) : null, version: v.quotations[0]?.version ?? null })),
        };
      }
      if (r.type === "PAYMENT") {
        const p = await db.payment.findUnique({
          where: { id: r.entityId },
          include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } }, event: { select: { id: true, name: true } }, vendorInvoice: { select: { invoiceNumber: true, total: true } } },
        });
        if (!p) return { ...base, kind: "missing" as const };
        const paidSoFar =
          p.vendorId && p.eventId
            ? toNumber((await db.payment.aggregate({ where: { vendorId: p.vendorId, eventId: p.eventId, direction: "OUT", status: "PAID" }, _sum: { amount: true } }))._sum.amount)
            : 0;
        const agreed =
          p.vendorId && p.eventId
            ? toNumber((await db.vendorAssignment.aggregate({ where: { vendorId: p.vendorId, eventId: p.eventId, status: { notIn: ["CANCELLED", "DECLINED"] } }, _sum: { agreedAmount: true } }))._sum.agreedAmount)
            : 0;
        const approvedProof = p.vendorId && p.eventId ? await db.workProof.count({ where: { eventId: p.eventId, status: "APPROVED", vendorAssignment: { vendorId: p.vendorId } } }) : 0;
        return {
          ...base,
          kind: "payment" as const,
          selfPrepared: p.requestedById === actor.userId,
          event: p.event,
          party: p.vendor?.companyName ?? p.worker?.name ?? p.partyName ?? p.partyType,
          method: p.method,
          note: p.note,
          invoice: p.vendorInvoice ? { number: p.vendorInvoice.invoiceNumber, total: toNumber(p.vendorInvoice.total) } : null,
          paidSoFar,
          agreed,
          approvedProof,
          isFinal: agreed > 0 && paidSoFar + toNumber(p.amount) >= agreed,
        };
      }
      if (r.type === "CREW_ADJUSTMENT") {
        const a = await db.crewPayAdjustment.findUnique({
          where: { id: r.entityId },
          include: { assignment: { include: { worker: { select: { name: true } }, event: { select: { id: true, name: true } } } } },
        });
        if (!a) return { ...base, kind: "missing" as const };
        return {
          ...base,
          kind: "crew" as const,
          event: a.assignment.event,
          worker: a.assignment.worker.name,
          duty: a.assignment.duty,
          agreedPay: toNumber(a.assignment.agreedPay),
          adjustmentType: a.type,
          reason: a.reason,
        };
      }
      if (r.type === "BUDGET") {
        const b = await db.budget.findUnique({ where: { id: r.entityId }, include: { event: { select: { id: true, name: true } }, lines: { include: { category: { select: { name: true } } } } } });
        if (!b) return { ...base, kind: "missing" as const };
        const previous = await db.budget.findFirst({ where: { eventId: b.eventId, status: "APPROVED", version: { lt: b.version } }, orderBy: { version: "desc" }, include: { lines: { select: { estimatedAmount: true } } } });
        return {
          ...base,
          kind: "budget" as const,
          event: b.event,
          version: b.version,
          lines: b.lines.map((l) => ({ category: l.category.name, description: l.description, amount: toNumber(l.estimatedAmount) })),
          previousTotal: previous ? previous.lines.reduce((s, l) => s + toNumber(l.estimatedAmount), 0) : null,
        };
      }
      if (r.type === "EXPENSE") {
        const e = await db.expense.findUnique({ where: { id: r.entityId }, include: { category: { select: { name: true } }, event: { select: { id: true, name: true } }, receiptFile: { select: MEDIA_SELECT } } });
        if (!e) return { ...base, kind: "missing" as const };
        return {
          ...base,
          kind: "expense" as const,
          selfPrepared: e.submittedById === actor.userId,
          event: e.event,
          description: e.description,
          category: e.category.name,
          spentOn: e.spentOn,
          paidVia: e.paidVia,
          receipt: e.receiptFile ? mediaView(actor.userId, e.receiptFile, { original: true }) : null,
        };
      }
      return { ...base, kind: "missing" as const };
    }),
  );
}

export type PendingApproval = Awaited<ReturnType<typeof listPendingApprovals>>[number];

export async function decideApproval(db: Db, actor: Actor, approvalId: string, decision: Decision, comment: string | undefined, meta: RequestMeta = {}) {
  assertCan(actor, "approvals.decide", "Only owners can approve.");
  const note = comment?.trim() || undefined;
  if ((decision === "REJECT" || decision === "REVISE") && !note) throw new ValidationError("Write a short reason so the person knows what to change.", { comment: "A reason is needed." });

  return db.$transaction(async (tx) => {
    const req = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!req) throw new NotFoundError("That approval");
    if (req.state !== "PENDING") throw new ConflictError("This was already decided.");
    if (decision === "REVISE" && req.type !== "QUOTATION") throw new ValidationError("Only quotes can be sent back for revision.");
    const now = new Date();
    let auditSummary = "";

    if (req.type === "QUOTATION") {
      const q = await tx.quotation.findUnique({ where: { id: req.entityId }, include: { vendor: { select: { companyName: true } } } });
      if (!q) throw new NotFoundError("That quote");
      if (q.status !== "SUBMITTED") throw new ConflictError("This quote is no longer waiting.");
      const quoteStatus = decision === "APPROVE" ? "APPROVED" : decision === "REVISE" ? "REVISION_REQUESTED" : "REJECTED";
      await tx.quotation.update({ where: { id: q.id }, data: { status: quoteStatus, decidedById: actor.userId, decidedAt: now, reviewNote: note } });
      await tx.vendorAssignment.update({
        where: { id: q.assignmentId },
        data: decision === "APPROVE" ? { status: "APPROVED", agreedAmount: q.total } : decision === "REVISE" ? { status: "INVITED" } : { status: "CANCELLED", declineReason: note },
      });
      auditSummary = `${decision === "APPROVE" ? "Approved" : decision === "REVISE" ? "Asked to revise" : "Rejected"} ${q.vendor.companyName} quote v${q.version} ${formatINR(q.total)}`;
    } else if (req.type === "PAYMENT") {
      const p = await tx.payment.findUnique({ where: { id: req.entityId }, include: { vendor: { select: { companyName: true } }, worker: { select: { name: true } } } });
      if (!p) throw new NotFoundError("That payment");
      if (p.status !== "PENDING_APPROVAL") throw new ConflictError("This payment is no longer waiting.");
      if (decision === "APPROVE") {
        if (p.requestedById === actor.userId && (await otherActiveOwners(tx, actor.userId)) > 0) {
          throw new ConflictError("You prepared this payment, so the other owner needs to approve it.");
        }
        if (p.vendorId && p.eventId) {
          const company = await tx.companyProfile.findUnique({ where: { id: 1 }, select: { settings: true } });
          const needsProof = (company?.settings as { finalVendorPaymentNeedsProof?: boolean } | null)?.finalVendorPaymentNeedsProof ?? true;
          if (needsProof) {
            const [paid, agreed] = await inSequence([
              tx.payment.aggregate({ where: { vendorId: p.vendorId, eventId: p.eventId, direction: "OUT", status: "PAID" }, _sum: { amount: true } }),
              tx.vendorAssignment.aggregate({ where: { vendorId: p.vendorId, eventId: p.eventId, status: { notIn: ["CANCELLED", "DECLINED"] } }, _sum: { agreedAmount: true } }),
            ]);
            const total = toNumber(agreed._sum.agreedAmount);
            const isFinal = total > 0 && toNumber(paid._sum.amount) + toNumber(p.amount) >= total;
            if (isFinal) {
              const proof = await tx.workProof.count({ where: { eventId: p.eventId, status: "APPROVED", vendorAssignment: { vendorId: p.vendorId } } });
              if (proof === 0) throw new ConflictError("This is the final payment, and no proof of this vendor's work has been approved yet.");
            }
          }
        }
      }
      await tx.payment.update({
        where: { id: p.id },
        data: decision === "APPROVE" ? { status: "APPROVED", approvedById: actor.userId, approvedAt: now } : { status: "REJECTED", note: p.note ? `${p.note} · Rejected: ${note}` : `Rejected: ${note}` },
      });
      const party = p.vendor?.companyName ?? p.worker?.name ?? p.partyName ?? "payment";
      auditSummary = `${decision === "APPROVE" ? "Approved" : "Rejected"} payment ${formatINR(p.amount)} to ${party}`;
    } else if (req.type === "CREW_ADJUSTMENT") {
      const a = await tx.crewPayAdjustment.findUnique({ where: { id: req.entityId }, include: { assignment: { include: { worker: { select: { name: true } } } } } });
      if (!a) throw new NotFoundError("That crew extra");
      if (a.state !== "PENDING") throw new ConflictError("This crew extra was already decided.");
      await tx.crewPayAdjustment.update({ where: { id: a.id }, data: { state: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: now } });
      auditSummary = `${decision === "APPROVE" ? "Approved" : "Rejected"} ${a.type === "EXTRA" ? "extra" : "deduction"} ${formatINR(a.amount)} for ${a.assignment.worker.name}`;
    } else if (req.type === "BUDGET") {
      auditSummary = await decideBudget(tx, actor.userId, req.entityId, decision === "APPROVE", now);
    } else if (req.type === "EXPENSE") {
      const e = await tx.expense.findUnique({ where: { id: req.entityId } });
      if (!e) throw new NotFoundError("That expense");
      if (e.status !== "SUBMITTED") throw new ConflictError("This expense was already decided.");
      if (decision === "APPROVE" && e.submittedById === actor.userId && (await otherActiveOwners(tx, actor.userId)) > 0) {
        throw new ConflictError("You recorded this expense, so the other owner needs to approve it.");
      }
      await tx.expense.update({ where: { id: e.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: now, decisionNote: note ?? null } });
      auditSummary = `${decision === "APPROVE" ? "Approved" : "Rejected"} expense ${formatINR(e.amount)}: ${e.description}`;
    } else {
      throw new ValidationError("This kind of approval is not handled yet.");
    }

    await tx.approvalRequest.update({ where: { id: req.id }, data: { state: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: now, comment: note } });
    if (req.requestedById && req.requestedById !== actor.userId) {
      await tx.notification.create({
        data: {
          userId: req.requestedById,
          type: `approval.${decision.toLowerCase()}`,
          title: `${decision === "APPROVE" ? "Approved" : decision === "REVISE" ? "Sent back" : "Not approved"}: ${req.summary}`,
          body: note,
          link: req.type === "PAYMENT" ? "/money" : req.type === "EXPENSE" ? "/expenses" : req.type === "BUDGET" && req.eventId ? `/bookings/${req.eventId}?tab=money` : req.eventId ? `/bookings/${req.eventId}?tab=${req.type === "QUOTATION" ? "vendors" : "crew"}` : null,
          entityType: req.type.toLowerCase(),
          entityId: req.entityId,
        },
      });
    }
    await recordAudit(tx, actor, { action: decision === "APPROVE" ? "approve" : "reject", entityType: req.type.toLowerCase(), entityId: req.entityId, summary: note ? `${auditSummary} · ${note}` : auditSummary, financial: true }, meta);
    return { state: decision === "APPROVE" ? "APPROVED" : "REJECTED" };
  });
}
