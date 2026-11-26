/**
 * Every service action, as every kind of login (Phase 9).
 *
 * 1. Coverage: every exported module function that takes (db, actor, …) must be listed below, either
 *    as a case or as exempt with a reason. A new action can't be added without deciding who may run it.
 * 2. For each case, a fresh booking is built; every role that must be refused is refused (401, 403
 *    or 404, or nothing returned for reads); then the roles that may run it (the owner, and the vendor
 *    or crew member for their own actions) must not get a permission error. Errors about the state of
 *    things (a conflict, a missing photo) are fine there: only access is being tested.
 *
 * Roles: owner, manager (on the booking), otherManager (not on it), accountant, supervisor (on it),
 * vendor (with a job on it), crew (booked on it).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { loadActor, type Actor } from "@/modules/identity/actor";
import * as approvals from "@/modules/approvals/service";
import * as ann from "@/modules/communication/announcements";
import * as chat from "@/modules/communication/chat";
import * as roster from "@/modules/crew/roster";
import * as crew from "@/modules/crew/service";
import * as docs from "@/modules/documents/service";
import * as planning from "@/modules/events/planning";
import * as events from "@/modules/events/service";
import * as workspace from "@/modules/events/workspace";
import * as advances from "@/modules/finance/advances";
import * as budgets from "@/modules/finance/budgets";
import * as clientInv from "@/modules/finance/client-invoices";
import * as expenses from "@/modules/finance/expenses";
import * as exportsMod from "@/modules/finance/exports";
import * as overview from "@/modules/finance/overview";
import * as payments from "@/modules/finance/payments";
import * as pnl from "@/modules/finance/pnl";
import * as settlement from "@/modules/finance/settlement";
import * as roles from "@/modules/identity/roles";
import * as users from "@/modules/identity/users";
import * as proof from "@/modules/proof/service";
import * as company from "@/modules/settings/company";
import * as settings from "@/modules/settings/service";
import * as tasks from "@/modules/tasks/service";
import * as directory from "@/modules/vendors/directory";
import * as vinv from "@/modules/vendors/invoices";
import * as jobs from "@/modules/vendors/jobs";
import { makeEvent, makeReceipt, makeUser, makeVendor, makeWorker, testDb } from "../support/factories";

type Role = "owner" | "manager" | "otherManager" | "accountant" | "supervisor" | "vendor" | "crew";
const staffOnly: Role[] = ["vendor", "crew"];
const notTeam: Role[] = ["otherManager", "accountant", "vendor", "crew"];
const money: Role[] = ["manager", "otherManager", "supervisor", "vendor", "crew"];
const ownerOnly: Role[] = ["manager", "otherManager", "accountant", "supervisor", "vendor", "crew"];

const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
let A: Record<Role, Actor>;
let vendorId: string, workerId: string, crewUserId: string, managerId: string, supervisorId: string;
let ids: { category: string; vendorCategory: string; skill: string; expenseCategory: string };

type World = Awaited<ReturnType<typeof world>>;

/** A fresh booking with its team, a vendor job, crew, a task and some money. */
async function world() {
  const ev = await makeEvent({ name: `EA ${Math.random().toString(36).slice(2, 7)}` });
  await testDb.event.update({ where: { id: ev.id }, data: { status: "PLANNING", startDate: new Date(`${day(10)}T00:00:00Z`), endDate: new Date(`${day(10)}T00:00:00Z`) } });
  await testDb.eventMember.createMany({ data: [{ eventId: ev.id, userId: managerId, role: "MANAGER" }, { eventId: ev.id, userId: supervisorId, role: "SUPERVISOR" }] });
  const fn = await testDb.eventFunction.create({ data: { eventId: ev.id, name: "Sangeet", date: new Date(`${day(10)}T00:00:00Z`), startsAt: new Date(`${day(10)}T13:30:00Z`) } });
  const job = await testDb.vendorAssignment.create({ data: { eventId: ev.id, vendorId, scopeOfWork: "Lights", status: "ACCEPTED", agreedAmount: 11800, functions: { create: { functionId: fn.id } } } });
  const q = await testDb.quotation.create({ data: { assignmentId: job.id, vendorId, version: 1, status: "APPROVED", subtotal: 10000, taxAmount: 1800, total: 11800 } });
  const wo = await testDb.workOrder.create({ data: { number: `WO-EA-${Math.random().toString(36).slice(2, 9)}`, assignmentId: job.id, quotationId: q.id, amount: 11800, status: "ACKNOWLEDGED" } });
  const invFile = await testDb.file.create({ data: { storageKey: `test/ea-${Math.random()}.pdf`, filename: "i.pdf", mimeType: "application/pdf", sizeBytes: 10, status: "READY" } });
  const invoice = await testDb.vendorInvoice.create({ data: { vendorId, workOrderId: wo.id, invoiceNumber: `EA/${crypto.randomUUID()}`, invoiceDate: new Date(), taxableAmount: 10000, gstAmount: 1800, total: 11800, status: "SUBMITTED", fileId: invFile.id } });
  const ca = await testDb.crewAssignment.create({ data: { eventId: ev.id, workerId, duty: "Setup", agreedPay: 900, status: "CONFIRMED" } });
  const shift = await testDb.crewShift.create({ data: { assignmentId: ca.id, functionId: fn.id, date: new Date(`${day(0)}T00:00:00Z`), reportAt: new Date(Date.now() + 3600_000) } });
  const task = await testDb.task.create({ data: { eventId: ev.id, title: "EA task", status: "ASSIGNED", assigneeId: crewUserId, createdById: managerId } });
  const charge = await testDb.clientCharge.create({ data: { eventId: ev.id, clientId: ev.clientId, description: "Package", amount: 50000, gstRate: 18 } });
  return { eventId: ev.id, clientId: ev.clientId, fnId: fn.id, jobId: job.id, woId: wo.id, invoiceId: invoice.id, caId: ca.id, shiftId: shift.id, taskId: task.id, chargeId: charge.id };
}

async function fileFor(a: Actor, purpose: "PROOF" | "DOCUMENT" = "DOCUMENT") {
  return (await testDb.file.create({ data: { storageKey: `test/ea-${Math.random()}.jpg`, filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 10, uploadedById: a.userId, status: "READY", purpose } })).id;
}

const withInvoices = (a: Actor): Actor => ({ ...a, switches: { ...a.switches, clientInvoices: true } });

interface Case {
  name: string;
  deny: Role[];
  /** Roles (besides the owner) that must get through the permission checks. */
  allow?: Role[];
  /** The owner isn't part of this action (vendor's or crew's own step). */
  ownerExcluded?: boolean;
  setup?: (w: World) => Promise<Record<string, string>>;
  run: (a: Actor, w: World, x: Record<string, string>) => Promise<unknown>;
}

const isPermissionError = (e: unknown) => e instanceof AppError && [401, 403, 404].includes(e.status);
const isEmpty = (r: unknown) => r === null || r === false || (Array.isArray(r) && r.length === 0);

const CASES: Case[] = [
  // ── Bookings and planning
  { name: "createBooking", deny: ["accountant", "supervisor", ...staffOnly], run: (a) => events.createBooking(testDb, a, { name: "EA new", categoryId: ids.category, clientName: "EA Client", functions: [{ name: "Party", date: day(20), startTime: "19:00" }] }) },
  { name: "updateBookingDetails", deny: notTeam.concat("supervisor"), run: (a, w) => planning.updateBookingDetails(testDb, a, w.eventId, { name: "EA renamed", categoryId: ids.category, status: "PLANNING" }) },
  { name: "cancelBooking", deny: ownerOnly, run: (a, w) => planning.cancelBooking(testDb, a, w.eventId, "Client cancelled") },
  { name: "saveFunction", deny: notTeam.concat("supervisor"), run: (a, w) => planning.saveFunction(testDb, a, w.eventId, { name: "Mehendi", date: day(11), startTime: "11:00" }) },
  { name: "removeFunction", deny: notTeam.concat("supervisor"), run: (a, w) => planning.removeFunction(testDb, a, w.eventId, w.fnId) },
  { name: "setTeam", deny: ownerOnly, run: (a, w) => planning.setTeam(testDb, a, w.eventId, { managerIds: [managerId], supervisorIds: [supervisorId] }) },
  { name: "saveScheduleItem", deny: notTeam.concat("supervisor"), run: (a, w) => planning.saveScheduleItem(testDb, a, w.eventId, { type: "SETUP", title: "Stage setup", date: day(10), time: "10:00" }) },
  {
    name: "removeScheduleItem",
    deny: notTeam.concat("supervisor"),
    setup: async (w) => ({ item: (await testDb.scheduleItem.create({ data: { eventId: w.eventId, type: "SETUP", title: "Setup", startsAt: new Date() } })).id }),
    run: (a, w, x) => planning.removeScheduleItem(testDb, a, w.eventId, x.item),
  },
  {
    name: "setScheduleDone",
    deny: notTeam,
    allow: ["manager", "supervisor"],
    setup: async (w) => ({ item: (await testDb.scheduleItem.create({ data: { eventId: w.eventId, type: "SETUP", title: "Setup", startsAt: new Date() } })).id }),
    run: (a, _w, x) => planning.setScheduleDone(testDb, a, x.item, true),
  },
  { name: "saveRequirement", deny: notTeam.concat("supervisor"), run: (a, w) => planning.saveRequirement(testDb, a, w.eventId, { title: "200 chairs" }) },
  { name: "getRequirements", deny: ["otherManager", "crew"], run: (a, w) => planning.getRequirements(testDb, a, w.eventId) },
  { name: "getBookingHeader", deny: ["otherManager", "vendor", "crew"], run: (a, w) => workspace.getBookingHeader(testDb, a, w.eventId) },
  { name: "getBookingMoney", deny: ["otherManager", "supervisor", ...staffOnly], run: (a, w) => workspace.getBookingMoney(testDb, a, w.eventId) },
  { name: "getBookingVendors", deny: ["otherManager", "crew"], run: (a, w) => workspace.getBookingVendors(testDb, a, w.eventId) },
  { name: "getBookingCrew", deny: ["otherManager", "vendor"], run: (a, w) => workspace.getBookingCrew(testDb, a, w.eventId) },
  { name: "getBookingSchedule", deny: ["otherManager"], run: (a, w) => workspace.getBookingSchedule(testDb, a, w.eventId) },
  { name: "getBookingTasks", deny: ["otherManager", "vendor"], run: (a, w) => workspace.getBookingTasks(testDb, a, w.eventId) },

  // ── Crew
  { name: "assignCrew", deny: notTeam.concat("supervisor"), setup: async () => ({ worker: (await makeWorker("EA extra")).id }), run: (a, w, x) => crew.assignCrew(testDb, a, { eventId: w.eventId, workerId: x.worker, duty: "Drapes", agreedPay: 800, shifts: [{ functionId: w.fnId, reportTime: "17:00" }] }) },
  { name: "removeCrew", deny: notTeam.concat("supervisor"), run: (a, w) => crew.removeCrew(testDb, a, w.caId, "Not needed") },
  {
    name: "respondToBooking",
    deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "vendor"],
    allow: ["crew"],
    ownerExcluded: true,
    setup: async (w) => {
      await testDb.crewAssignment.update({ where: { id: w.caId }, data: { status: "ASSIGNED" } });
      return {};
    },
    run: (a, w) => crew.respondToBooking(testDb, a, w.caId, true),
  },
  { name: "crewForBooking", deny: ["otherManager", ...staffOnly], run: (a, w) => crew.crewForBooking(testDb, a, w.eventId) },
  { name: "saveWorker", deny: ["accountant", ...staffOnly], run: (a) => roster.saveWorker(testDb, a, { name: "EA Worker", phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, skillIds: [ids.skill] }) },
  { name: "getWorker", deny: ["vendor"], run: (a) => roster.getWorker(testDb, a, workerId) },
  { name: "addUnavailable", deny: ["accountant", "supervisor", "vendor"], allow: ["crew"], run: (a) => roster.addUnavailable(testDb, a, workerId, { date: day(40 + Math.floor(Math.random() * 300)) }) },
  {
    name: "removeUnavailable",
    deny: ["accountant", "supervisor", "vendor"],
    allow: ["crew"],
    setup: async () => ({ id: (await testDb.workerUnavailability.create({ data: { workerId, date: new Date(`${day(400 + Math.floor(Math.random() * 300))}T00:00:00Z`) } })).id }),
    run: (a, _w, x) => roster.removeUnavailable(testDb, a, workerId, x.id),
  },

  // ── Vendors
  { name: "saveVendor", deny: ["accountant", "supervisor", ...staffOnly], run: (a) => directory.saveVendor(testDb, a, { companyName: "EA Vendor", contactName: "Ravi", phone: `97${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, categoryIds: [ids.vendorCategory] }) },
  { name: "getVendor", deny: ["crew"], run: (a) => directory.getVendor(testDb, a, vendorId) },
  { name: "saveVendorBank", deny: ["manager", "otherManager", "supervisor", "crew"], allow: ["accountant", "vendor"], run: (a) => directory.saveVendorBank(testDb, a, vendorId, { accountName: "EA Lights", upiId: "ealights@sbi" }) },
  { name: "confirmVendorBank", deny: ["manager", "otherManager", "supervisor", ...staffOnly], allow: ["accountant"], run: (a) => directory.confirmVendorBank(testDb, a, vendorId) },
  { name: "updateOwnVendorProfile", deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "crew"], allow: ["vendor"], ownerExcluded: true, run: (a) => directory.updateOwnVendorProfile(testDb, a, { contactName: "Mahesh" }) },
  { name: "inviteVendor", deny: notTeam.concat("supervisor"), setup: async () => ({ v: (await makeVendor("EA Other vendor")).id }), run: (a, w, x) => jobs.inviteVendor(testDb, a, { eventId: w.eventId, vendorId: x.v, scopeOfWork: "Sound and DJ", functionIds: [w.fnId] }) },
  { name: "cancelJob", deny: notTeam.concat("supervisor"), run: (a, w) => jobs.cancelJob(testDb, a, w.jobId, "Not needed any more") },
  {
    name: "submitQuote",
    deny: ["manager", "otherManager", "supervisor", "crew"],
    allow: ["vendor", "accountant"],
    setup: async (w) => {
      await testDb.vendorAssignment.update({ where: { id: w.jobId }, data: { status: "INVITED" } });
      return {};
    },
    run: (a, w) => jobs.submitQuote(testDb, a, w.jobId, { items: [{ description: "Fairy lights", quantity: 1, rate: 10000, gstRate: 18 }] }),
  },
  {
    name: "declineJob",
    deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "crew"],
    allow: ["vendor"],
    ownerExcluded: true,
    setup: async (w) => {
      await testDb.vendorAssignment.update({ where: { id: w.jobId }, data: { status: "INVITED" } });
      return {};
    },
    run: (a, w) => jobs.declineJob(testDb, a, w.jobId, "Booked that day"),
  },
  {
    name: "issueWorkOrder",
    deny: notTeam.concat("supervisor"),
    setup: async (w) => {
      await testDb.vendorAssignment.update({ where: { id: w.jobId }, data: { status: "APPROVED" } });
      await testDb.workOrder.update({ where: { id: w.woId }, data: { status: "CANCELLED" } });
      return {};
    },
    run: (a, w) => jobs.issueWorkOrder(testDb, a, w.jobId, undefined),
  },
  {
    name: "acceptWorkOrder",
    deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "crew"],
    allow: ["vendor"],
    ownerExcluded: true,
    setup: async (w) => {
      await testDb.vendorAssignment.update({ where: { id: w.jobId }, data: { status: "APPROVED" } });
      await testDb.workOrder.update({ where: { id: w.woId }, data: { status: "ISSUED" } });
      return {};
    },
    run: (a, w) => jobs.acceptWorkOrder(testDb, a, w.jobId),
  },
  { name: "reportProgress", deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "crew"], allow: ["vendor"], ownerExcluded: true, run: (a, w) => jobs.reportProgress(testDb, a, w.jobId, { stage: "IN_PROGRESS" }) },
  {
    name: "signOffJob",
    deny: ["otherManager", "accountant", ...staffOnly],
    allow: ["manager"],
    setup: async (w) => {
      await testDb.vendorAssignment.update({ where: { id: w.jobId }, data: { status: "DELIVERED" } });
      return {};
    },
    run: (a, w) => jobs.signOffJob(testDb, a, w.jobId),
  },
  { name: "getJob", deny: ["otherManager", "crew"], allow: ["vendor"], run: (a, w) => jobs.getJob(testDb, a, w.jobId) },
  { name: "submitInvoice", deny: ["manager", "otherManager", "supervisor", "crew"], allow: ["vendor"], run: async (a, w) => vinv.submitInvoice(testDb, a, w.jobId, { invoiceNumber: `EA-${Math.random().toString(36).slice(2, 7)}`, invoiceDate: day(0), taxableAmount: 1, gstAmount: 0, fileId: await fileFor(a) }) },
  { name: "reviewInvoice", deny: money, allow: ["accountant"], run: (a, w) => vinv.reviewInvoice(testDb, a, w.invoiceId, { decision: "VERIFY" }) },
  { name: "invoicesForJob", deny: ["otherManager", "supervisor", "crew"], allow: ["vendor"], run: (a, w) => vinv.invoicesForJob(testDb, a, w.jobId) },

  // ── Tasks and proof
  { name: "createTask", deny: notTeam, allow: ["manager", "supervisor"], run: (a, w) => tasks.createTask(testDb, a, { eventId: w.eventId, title: "Count the chairs" }) },
  { name: "moveTask", deny: ["otherManager", "accountant", "vendor"], allow: ["crew", "manager"], run: (a, w) => tasks.moveTask(testDb, a, w.taskId, "start") },
  {
    name: "reviewTask",
    deny: notTeam,
    allow: ["manager", "supervisor"],
    setup: async (w) => {
      await testDb.task.update({ where: { id: w.taskId }, data: { status: "UNDER_REVIEW", needsApproval: true } });
      return {};
    },
    run: (a, w) => tasks.reviewTask(testDb, a, w.taskId, { decision: "APPROVE" }),
  },
  { name: "addProof", deny: ["otherManager", "accountant", "crew"], allow: ["vendor"], run: async (a, w) => proof.addProof(testDb, a, { target: { kind: "vendorJob", id: w.jobId }, fileIds: [await fileFor(a, "PROOF")] }) },
  {
    name: "reviewProof",
    deny: notTeam,
    allow: ["manager", "supervisor"],
    setup: async (w) => {
      const vendorUser = A.vendor.userId;
      const f = await testDb.file.create({ data: { storageKey: `test/ea-p-${Math.random()}.jpg`, filename: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, purpose: "PROOF", status: "READY", uploadedById: vendorUser } });
      return { p: (await testDb.workProof.create({ data: { eventId: w.eventId, vendorAssignmentId: w.jobId, kind: "PHOTO", fileId: f.id, uploadedById: vendorUser } })).id };
    },
    run: (a, _w, x) => proof.reviewProof(testDb, a, x.p, { decision: "APPROVE" }),
  },

  // ── Documents
  { name: "addDocument", deny: ["otherManager", "accountant"], allow: ["manager"], run: async (a, w) => docs.addDocument(testDb, a, { eventId: w.eventId, title: "Floor plan", kind: "PLAN", visibility: "BOOKING_TEAM", fileId: await fileFor(a) }) },
  {
    name: "removeDocument",
    deny: ["otherManager", "vendor", "crew"],
    setup: async (w) => {
      const f = await testDb.file.create({ data: { storageKey: `test/ea-d-${Math.random()}.pdf`, filename: "d.pdf", mimeType: "application/pdf", sizeBytes: 1, status: "READY", uploadedById: managerId } });
      return { d: (await testDb.document.create({ data: { eventId: w.eventId, title: "Plan", kind: "PLAN", visibility: "BOOKING_TEAM", fileId: f.id, uploadedById: managerId } })).id };
    },
    run: (a, _w, x) => docs.removeDocument(testDb, a, x.d),
  },
  { name: "listDocuments", deny: ["otherManager"], run: (a, w) => docs.listDocuments(testDb, a, w.eventId) },

  // ── Money
  {
    name: "preparePayment",
    deny: money,
    allow: ["accountant"],
    setup: async (w) => {
      await testDb.vendorInvoice.update({ where: { id: w.invoiceId }, data: { status: "VERIFIED" } });
      return {};
    },
    run: (a, w) => payments.preparePayment(testDb, a, { kind: "VENDOR_INVOICE", invoiceId: w.invoiceId, amount: 100 }),
  },
  {
    name: "markPaid",
    deny: money,
    allow: ["accountant"],
    setup: async (w) => ({ p: (await testDb.payment.create({ data: { direction: "OUT", eventId: w.eventId, partyType: "WORKER", workerId, crewAssignmentId: w.caId, amount: 100, method: "UPI", status: "APPROVED" } })).id }),
    run: (a, _w, x) => payments.markPaid(testDb, a, x.p, { method: "CASH", paidOn: day(0) }),
  },
  {
    name: "voidPayment",
    deny: money,
    allow: ["accountant"],
    setup: async (w) => ({ p: (await testDb.payment.create({ data: { direction: "IN", eventId: w.eventId, partyType: "CLIENT", clientId: w.clientId, amount: 100, method: "CASH", status: "PAID", paidOn: new Date() } })).id }),
    run: (a, _w, x) => payments.voidPayment(testDb, a, x.p, "Entered twice"),
  },
  { name: "recordReceipt", deny: money, allow: ["accountant"], run: (a, w) => payments.recordReceipt(testDb, a, { eventId: w.eventId, amount: 1000, method: "CASH", paidOn: day(0) }) },
  { name: "addCharge", deny: money, allow: ["accountant"], run: (a, w) => payments.addCharge(testDb, a, { eventId: w.eventId, description: "Extra hour", amount: 5000, gstRate: 18 }) },
  { name: "removeCharge", deny: money, allow: ["accountant"], run: (a, w) => payments.removeCharge(testDb, a, w.chargeId) },
  { name: "requestAdjustment", deny: notTeam, allow: ["manager", "supervisor"], run: (a, w) => payments.requestAdjustment(testDb, a, { assignmentId: w.caId, type: "EXTRA", amount: 200, reason: "Late night" }) },
  {
    name: "decideApproval",
    deny: ownerOnly,
    setup: async (w) => {
      const p = await testDb.payment.create({ data: { direction: "OUT", eventId: w.eventId, partyType: "WORKER", workerId, crewAssignmentId: w.caId, amount: 100, method: "UPI", status: "PENDING_APPROVAL" } });
      return { r: (await testDb.approvalRequest.create({ data: { type: "PAYMENT", entityId: p.id, eventId: w.eventId, amount: 100, summary: "EA pay" } })).id };
    },
    run: (a, _w, x) => approvals.decideApproval(testDb, a, x.r, "REJECT", "Not this week"),
  },
  { name: "listPendingApprovals", deny: ownerOnly, run: (a) => approvals.listPendingApprovals(testDb, a) },
  { name: "submitExpense", deny: ["otherManager", "vendor", "crew"], allow: ["manager", "supervisor", "accountant"], run: async (a, w) => expenses.submitExpense(testDb, a, { eventId: w.eventId, categoryId: ids.expenseCategory, description: "Tea for the crew", amount: 200, spentOn: day(0), receiptFileId: await makeReceipt(a.userId) }) },
  {
    name: "markRepaid",
    deny: money,
    allow: ["accountant"],
    setup: async (w) => ({ e: (await testDb.expense.create({ data: { eventId: w.eventId, categoryId: ids.expenseCategory, description: "Auto", amount: 120, spentOn: new Date(), paidVia: "OWN_POCKET", status: "APPROVED", submittedById: managerId } })).id }),
    run: (a, _w, x) => expenses.markRepaid(testDb, a, x.e, { method: "CASH" }),
  },
  { name: "addBudgetLine", deny: ["otherManager", "supervisor", ...staffOnly], allow: ["manager"], run: (a, w) => budgets.addBudgetLine(testDb, a, w.eventId, { categoryId: ids.expenseCategory, estimatedAmount: 5000 }) },
  {
    name: "removeBudgetLine",
    deny: ["otherManager", "supervisor", ...staffOnly],
    allow: ["manager"],
    setup: async (w) => {
      const b = await testDb.budget.create({ data: { eventId: w.eventId, version: 1, status: "DRAFT", lines: { create: { categoryId: ids.expenseCategory, estimatedAmount: 100 } } }, include: { lines: true } });
      return { line: b.lines[0].id };
    },
    run: (a, w, x) => budgets.removeBudgetLine(testDb, a, w.eventId, x.line),
  },
  {
    name: "reviseBudget",
    deny: ["otherManager", "supervisor", ...staffOnly],
    allow: ["manager"],
    setup: async (w) => {
      await testDb.budget.create({ data: { eventId: w.eventId, version: 1, status: "APPROVED", lines: { create: { categoryId: ids.expenseCategory, estimatedAmount: 100 } } } });
      return {};
    },
    run: (a, w) => budgets.reviseBudget(testDb, a, w.eventId),
  },
  {
    name: "submitBudget",
    deny: ["otherManager", "supervisor", ...staffOnly],
    allow: ["manager"],
    setup: async (w) => {
      await testDb.budget.create({ data: { eventId: w.eventId, version: 1, status: "DRAFT", lines: { create: { categoryId: ids.expenseCategory, estimatedAmount: 100 } } } });
      return {};
    },
    run: (a, w) => budgets.submitBudget(testDb, a, w.eventId),
  },
  { name: "budgetView", deny: ["otherManager", "supervisor", ...staffOnly], allow: ["manager", "accountant"], run: (a, w) => budgets.budgetView(testDb, a, w.eventId) },
  { name: "bookingLedger", deny: ["otherManager", "supervisor", ...staffOnly], allow: ["manager", "accountant"], run: (a, w) => overview.bookingLedger(testDb, a, w.eventId) },
  { name: "moneyOverview", deny: money, allow: ["accountant"], run: (a) => overview.moneyOverview(testDb, a) },
  { name: "monthlyPnl", deny: money, allow: ["accountant"], run: (a) => pnl.monthlyPnl(testDb, a, { from: "2026-04", to: "2026-06" }) },
  { name: "buildExport", deny: money, allow: ["accountant"], run: (a) => exportsMod.buildExport(testDb, a, "payments", day(-1), day(0)) },
  { name: "settlementView", deny: money, allow: ["accountant"], run: (a, w) => settlement.settlementView(testDb, a, w.eventId) },
  { name: "settleBooking", deny: ownerOnly, run: (a, w) => settlement.settleBooking(testDb, a, w.eventId) },
  { name: "reopenBooking", deny: ownerOnly, run: (a, w) => settlement.reopenBooking(testDb, a, w.eventId, { reason: "Corrected invoice" }) },
  { name: "updateClientBilling", deny: money, allow: ["accountant"], run: (a, w) => clientInv.updateClientBilling(testDb, withInvoices(a), w.eventId, { address: "C-Scheme", stateCode: "08" }) },
  { name: "draftInvoice", deny: money, allow: ["accountant"], run: (a, w) => clientInv.draftInvoice(testDb, withInvoices(a), { eventId: w.eventId, lines: [{ chargeId: w.chargeId, amount: 100 }] }) },
  ...(["deleteDraft", "issueInvoice", "cancelInvoice", "invoiceForPrint"] as const).map(
    (name): Case => ({
      name,
      deny: money,
      allow: ["accountant"],
      setup: async (w) => {
        const inv = await testDb.clientInvoice.create({ data: { eventId: w.eventId, clientId: w.clientId, type: "FINAL", status: "DRAFT", subtotal: 100, total: 118, cgst: 9, sgst: 9, items: { create: { chargeId: w.chargeId, description: "Package", rate: 100, amount: 100 } } } });
        // Lines go on while it is a draft; then it is issued.
        if (name === "cancelInvoice") await testDb.clientInvoice.update({ where: { id: inv.id }, data: { status: "ISSUED", number: `EA-${Math.random().toString(36).slice(2, 8)}`, issueDate: new Date() } });
        return { inv: inv.id };
      },
      run: (a, _w, x) => {
        const b = withInvoices(a);
        if (name === "deleteDraft") return clientInv.deleteDraft(testDb, b, x.inv);
        if (name === "issueInvoice") return clientInv.issueInvoice(testDb, b, x.inv, { issueDate: day(0) });
        if (name === "cancelInvoice") return clientInv.cancelInvoice(testDb, b, x.inv, "Wrong client name");
        return clientInv.invoiceForPrint(testDb, b, x.inv);
      },
    }),
  ),
  { name: "bookingInvoices", deny: money, allow: ["accountant"], run: (a, w) => clientInv.bookingInvoices(testDb, withInvoices(a), w.eventId) },

  // ── Messages and announcements
  { name: "sendAnnouncement", deny: notTeam, allow: ["manager", "supervisor"], run: (a, w) => ann.sendAnnouncement(testDb, a, { audience: "BOOKING_CREW", eventId: w.eventId, title: "Report at gate 2", body: "By 5 pm" }) },
  {
    name: "acknowledge",
    deny: ["owner", "manager", "otherManager", "accountant", "supervisor", "vendor"],
    allow: ["crew"],
    ownerExcluded: true,
    setup: async (w) => ({ ann: (await testDb.announcement.create({ data: { audience: "BOOKING_CREW", eventId: w.eventId, title: "Gate 2", body: "By 5", needsAck: true } })).id }),
    run: (a, _w, x) => ann.acknowledge(testDb, a, x.ann),
  },
  { name: "openChannel", deny: notTeam, allow: ["manager", "supervisor"], run: (a, w) => chat.openChannel(testDb, a, { type: "BOOKING_TEAM", eventId: w.eventId }) },
  ...(["readThread", "postMessage", "canListen"] as const).map(
    (name): Case => ({
      name,
      deny: notTeam,
      allow: ["manager", "supervisor"],
      setup: async (w) => ({ ch: (await testDb.channel.create({ data: { type: "BOOKING_TEAM", eventId: w.eventId, name: "Team" } })).id }),
      run: (a, _w, x) => (name === "readThread" ? chat.readThread(testDb, a, x.ch) : name === "postMessage" ? chat.postMessage(testDb, a, x.ch, { body: "Hello" }) : chat.canListen(testDb, a, x.ch)),
    }),
  ),
  {
    name: "deleteMessage",
    deny: ["owner", "otherManager", "accountant", "supervisor", "vendor", "crew"],
    allow: ["manager"],
    ownerExcluded: true,
    setup: async (w) => {
      const ch = await testDb.channel.create({ data: { type: "BOOKING_TEAM", eventId: w.eventId, name: "Team" } });
      return { m: (await testDb.message.create({ data: { channelId: ch.id, senderId: managerId, body: "Oops" } })).id };
    },
    run: (a, _w, x) => chat.deleteMessage(testDb, a, x.m),
  },

  // ── Administration
  { name: "createUser", deny: ownerOnly, run: (a) => users.createUser(testDb, a, { name: "EA Person", phone: `96${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, roleKey: "SUPERVISOR", temporaryPassword: "Temp@12345" }) },
  { name: "setUserRoles", deny: ownerOnly, setup: async () => ({ u: (await makeUser({ name: "EA Target", roleKey: "SUPERVISOR" })).id }), run: (a, _w, x) => users.setUserRoles(testDb, a, x.u, ["EVENT_MANAGER"]) },
  { name: "setUserStatus", deny: ownerOnly, setup: async () => ({ u: (await makeUser({ name: "EA Target", roleKey: "SUPERVISOR" })).id }), run: (a, _w, x) => users.setUserStatus(testDb, a, x.u, "DISABLED") },
  { name: "resetPassword", deny: ownerOnly, setup: async () => ({ u: (await makeUser({ name: "EA Target", roleKey: "SUPERVISOR" })).id }), run: (a, _w, x) => users.resetPassword(testDb, a, x.u, "Temp@12345") },
  { name: "listTeam", deny: ownerOnly, run: (a) => users.listTeam(testDb, a) },
  { name: "listRoles", deny: ownerOnly, run: (a) => roles.listRoles(testDb, a) },
  { name: "updateRoleGrants", deny: ownerOnly, run: async (a) => roles.updateRoleGrants(testDb, a, "SUPERVISOR", (await roles.listRoles(testDb, A.owner)).find((r) => r.key === "SUPERVISOR")!.grants) },
  { name: "updateSwitches", deny: ownerOnly, run: async (a) => settings.updateSwitches(testDb, a, await settings.getSwitches(testDb)) },
  // ── Cash advances (D57)
  { name: "giveAdvance", deny: money, allow: ["accountant"], run: (a) => advances.giveAdvance(testDb, a, { holderId: managerId, amount: 500, purpose: "Tea on site" }) },
  {
    name: "markAdvanceGiven",
    deny: money,
    allow: ["accountant"],
    setup: async () => ({ adv: (await testDb.cashAdvance.create({ data: { userId: managerId, amount: 500, purpose: "Tea", status: "APPROVED" } })).id }),
    run: (a, _w, x) => advances.markAdvanceGiven(testDb, a, x.adv, { method: "CASH", givenOn: day(0) }),
  },
  {
    name: "closeAdvance",
    deny: money,
    allow: ["accountant"],
    setup: async () => ({ adv: (await testDb.cashAdvance.create({ data: { userId: managerId, amount: 500, purpose: "Tea", status: "GIVEN", givenOn: new Date() } })).id }),
    run: (a, _w, x) => advances.closeAdvance(testDb, a, x.adv, { returned: 500 }),
  },
  {
    name: "voidAdvance",
    deny: money,
    allow: ["accountant"],
    setup: async () => ({ adv: (await testDb.cashAdvance.create({ data: { userId: managerId, amount: 500, purpose: "Tea", status: "APPROVED" } })).id }),
    run: (a, _w, x) => advances.voidAdvance(testDb, a, x.adv, "Not needed"),
  },
  { name: "advanceHolders", deny: money, allow: ["accountant"], run: (a) => advances.advanceHolders(testDb, a) },
  {
    name: "advanceBalances",
    deny: ["otherManager", "vendor", "crew"],
    allow: ["accountant"],
    setup: async () => {
      await testDb.cashAdvance.create({ data: { userId: managerId, amount: 500, purpose: "Tea", status: "GIVEN", givenOn: new Date() } });
      return {};
    },
    run: async (a) => (await advances.advanceBalances(testDb, a)).people.filter((p) => p.userId === managerId),
  },
  { name: "getCompany", deny: money, allow: ["accountant"], run: (a) => company.getCompany(testDb, a) },
  { name: "updateCompany", deny: money, allow: ["accountant"], run: async (a) => company.updateCompany(testDb, a, { legalName: (await company.readCompany(testDb)).legalName, tradeName: "Taamara Taamara" }) },
];

/** Functions that take an actor but are not actions to test here, and why. */
const EXEMPT: Record<string, string> = {
  recordAudit: "writes the audit entry of an action that was already checked",
  assertEventAccess: "the check itself (tests/access/policy.test.ts)",
  // Lists and counts filter by the policy layer rather than refusing; their filters are tested in
  // tests/access/policy.test.ts and the feature tests.
  listBookings: "filtered list",
  pickableClients: "filtered list",
  monthCalendar: "filtered list",
  getEventDay: "filtered list",
  listWorkers: "filtered list",
  listVendors: "filtered list",
  invitableVendors: "filtered list",
  listInvoices: "filtered list",
  invoicesToCheckCount: "filtered count",
  listExpenses: "filtered list",
  listAdvances: "filtered list (cashAdvanceWhere; tests/advances.test.ts)",
  spendableAdvances: "the holder's own advances only",
  decideAdvance: "runs inside decideApproval, which is tested here",
  listProof: "filtered list",
  proofToCheckCount: "filtered count",
  listAnnouncements: "filtered list",
  announceableBookings: "filtered list",
  listChannels: "filtered list",
  unreadTotal: "filtered count",
  crewDocuments: "filtered list (crew's own)",
  // Personal: a person's own uploads and notifications only (tests/files, tests/notifications.test.ts).
  startUpload: "own uploads only",
  uploadStatus: "own uploads only",
  appendChunk: "own uploads only",
  completeUpload: "own uploads only",
  discardUpload: "own uploads only",
  unreadCount: "own notifications only",
  listNotifications: "own notifications only",
  openNotification: "own notifications only",
  markAllRead: "own notifications only",
};

beforeAll(async () => {
  const mk = async (name: string, roleKey: string, accountType?: "VENDOR" | "LABOUR") => (await makeUser({ name, roleKey, accountType })).id;
  const ownerId = await mk("EA Owner", "OWNER");
  managerId = await mk("EA Manager", "EVENT_MANAGER");
  const otherId = await mk("EA Other manager", "EVENT_MANAGER");
  const accountantId = await mk("EA Accountant", "ACCOUNTANT");
  supervisorId = await mk("EA Supervisor", "SUPERVISOR");
  const vendorUser = await mk("EA Vendor login", "VENDOR", "VENDOR");
  vendorId = (await makeVendor("EA Lights")).id;
  await testDb.vendorUser.create({ data: { vendorId, userId: vendorUser } });
  crewUserId = await mk("EA Crew", "LABOUR", "LABOUR");
  workerId = (await makeWorker("EA Crew")).id;
  await testDb.worker.update({ where: { id: workerId }, data: { userId: crewUserId } });
  const load = async (id: string) => (await loadActor(testDb, id))!;
  A = { owner: await load(ownerId), manager: await load(managerId), otherManager: await load(otherId), accountant: await load(accountantId), supervisor: await load(supervisorId), vendor: await load(vendorUser), crew: await load(crewUserId) };
  ids = {
    category: (await testDb.eventCategory.findFirstOrThrow()).id,
    vendorCategory: (await testDb.vendorCategory.findFirstOrThrow()).id,
    skill: (await testDb.skill.findFirstOrThrow()).id,
    expenseCategory: (await testDb.expenseCategory.findFirstOrThrow()).id,
  };
});
afterAll(() => testDb.$disconnect());

describe("every service action", () => {
  it("is listed here, as a case or exempt with a reason", () => {
    const mods = import.meta.glob("/src/modules/**/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
    const found = new Set<string>();
    for (const m of Object.values(mods)) for (const [k, v] of Object.entries(m)) if (typeof v === "function" && /^async function \w+\(\s*(db|tx),\s*actor\b/.test(String(v))) found.add(k);
    const listed = new Set([...CASES.map((c) => c.name), ...Object.keys(EXEMPT)]);
    expect([...found].filter((f) => !listed.has(f)).sort()).toEqual([]);
    expect([...listed].filter((f) => !found.has(f)).sort()).toEqual([]);
  });

  for (const c of CASES) {
    it(`${c.name}: refused for ${c.deny.join(", ") || "nobody"}`, async () => {
      const w = await world();
      const x = (await c.setup?.(w)) ?? {};
      const wrong: string[] = [];
      for (const role of c.deny) {
        try {
          const r = await c.run(A[role], w, x);
          if (!isEmpty(r)) wrong.push(`${role} was let through`);
        } catch (e) {
          if (!isPermissionError(e)) wrong.push(`${role} got "${(e as Error).message}" instead of a refusal`);
        }
      }
      const allowed = [...(c.allow ?? []), ...(c.ownerExcluded ? [] : (["owner"] as Role[]))];
      for (const role of allowed) {
        // A fresh booking each, so one allowed run doesn't use up what the next one needs.
        const w2 = await world();
        const x2 = (await c.setup?.(w2)) ?? {};
        try {
          const r = await c.run(A[role], w2, x2);
          if (r === null || r === false) wrong.push(`${role} got nothing back`);
        } catch (e) {
          if (isPermissionError(e)) wrong.push(`${role} was refused: "${(e as Error).message}"`);
        }
      }
      expect(wrong.join(" // ")).toBe("");
    });
  }
});
