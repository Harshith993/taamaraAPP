/**
 * Tasks on a booking, assigned to anyone on it (team, crew), with optional photo proof and sign-off.
 *
 *   PENDING / ASSIGNED ──start──▶ IN_PROGRESS ──done──▶ COMPLETED
 *                                              └─done (needs proof or approval)──▶ UNDER_REVIEW
 *   UNDER_REVIEW ──approve──▶ COMPLETED          UNDER_REVIEW ──send back (note)──▶ IN_PROGRESS
 *
 *  - Managers and supervisors (tasks.create) add tasks to bookings they are on.
 *  - The assignee moves their own task along (tasks.update OWN); the team can too on their bookings.
 *  - A task that needs proof can't be marked done until a photo or video has been sent.
 *  - Approving needs tasks.approve on the booking, and someone other than the assignee (owners excepted).
 */
import { z } from "zod";
import { inSequence, type Db, type DbTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatDate, formatTime } from "@/lib/format";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import type { Actor } from "@/modules/identity/actor";
import { assertCan, assertEventAccess, can, taskWhere } from "@/modules/identity/policy";
import { bookingTeamUserIds, notify } from "@/modules/notifications/notify";

const IST = "+05:30";

/** People a task on this booking can go to: its managers and supervisors, the owners, and crew on it who have a login. */
export async function assignableForBooking(db: DbTx, eventId: string) {
  const [members, owners, crew] = await inSequence([
    db.eventMember.findMany({ where: { eventId }, select: { role: true, user: { select: { id: true, name: true, status: true } } } }),
    db.user.findMany({ where: { status: "ACTIVE", accountType: "INTERNAL", roles: { some: { role: { isOwner: true } } } }, select: { id: true, name: true } }),
    db.crewAssignment.findMany({ where: { eventId, status: { in: ["ASSIGNED", "CONFIRMED"] }, worker: { userId: { not: null } } }, select: { duty: true, worker: { select: { name: true, user: { select: { id: true, status: true } } } } } }),
  ]);
  const people = new Map<string, { id: string; name: string; group: string }>();
  for (const m of members) if (m.user.status === "ACTIVE") people.set(m.user.id, { id: m.user.id, name: m.user.name, group: m.role === "MANAGER" ? "Manager" : "Supervisor" });
  for (const c of crew) if (c.worker.user?.status === "ACTIVE") people.set(c.worker.user.id, { id: c.worker.user.id, name: c.worker.name, group: `Crew · ${c.duty}` });
  for (const o of owners) if (!people.has(o.id)) people.set(o.id, { id: o.id, name: o.name, group: "Owner" });
  return [...people.values()];
}

export const createTaskSchema = z.object({
  eventId: z.string().uuid(),
  functionId: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Say what needs doing.").max(160),
  description: z.string().trim().max(2000).optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  dueTime: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).optional(),
  needsProof: z.boolean().default(false),
  needsApproval: z.boolean().default(false),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export async function createTask(db: Db, actor: Actor, input: CreateTaskInput, meta: RequestMeta = {}) {
  const v = parseInput(createTaskSchema, input);
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "INTERNAL") throw new ForbiddenError("You can't add tasks.");
    assertCan(actor, "tasks.create", "You can't add tasks.");
    await assertEventAccess(tx, actor, v.eventId, "tasks.create");
    if (v.functionId && !(await tx.eventFunction.count({ where: { id: v.functionId, eventId: v.eventId } }))) throw new ValidationError("Pick a function from this booking.", { functionId: "Pick a function from this booking." });
    if (v.assigneeId && !(await assignableForBooking(tx, v.eventId)).some((p) => p.id === v.assigneeId)) throw new ValidationError("Pick someone on this booking.", { assigneeId: "Pick someone on this booking." });
    const dueAt = v.dueDate ? new Date(`${v.dueDate}T${v.dueTime || "18:00"}:00${IST}`) : null;
    const event = await tx.event.findUniqueOrThrow({ where: { id: v.eventId }, select: { name: true } });
    const task = await tx.task.create({
      data: {
        eventId: v.eventId,
        functionId: v.functionId ?? null,
        title: v.title,
        description: v.description || null,
        priority: v.priority,
        status: v.assigneeId ? "ASSIGNED" : "PENDING",
        dueAt,
        assigneeId: v.assigneeId ?? null,
        reviewerId: v.needsProof || v.needsApproval ? actor.userId : null,
        needsProof: v.needsProof,
        needsApproval: v.needsApproval,
        createdById: actor.userId,
      },
    });
    if (v.assigneeId) {
      const assignee = await tx.user.findUniqueOrThrow({ where: { id: v.assigneeId }, select: { accountType: true } });
      await notify(
        tx,
        [v.assigneeId],
        {
          type: "task.assigned",
          title: `New task: ${v.title}`,
          body: `${event.name}${dueAt ? ` · by ${formatTime(dueAt)}, ${formatDate(dueAt)}` : ""}${v.needsProof ? " · needs a photo" : ""}`,
          link: assignee.accountType === "LABOUR" ? "/crew" : `/bookings/${v.eventId}?tab=tasks`,
          entityType: "task",
          entityId: task.id,
        },
        { exceptUserId: actor.userId },
      );
    }
    await recordAudit(tx, actor, { action: "create", entityType: "task", entityId: task.id, summary: `Added task "${v.title}" to ${event.name}` }, meta);
    return { id: task.id };
  });
}

async function loadTask(tx: DbTx, actor: Actor, taskId: string) {
  const task = await tx.task.findFirst({
    where: { AND: [{ id: taskId }, taskWhere(actor)] },
    include: { event: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true, accountType: true } }, _count: { select: { proofs: { where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } } } } } },
  });
  if (!task) throw new NotFoundError("That task");
  return task;
}

function taskLink(task: { eventId: string | null }, accountType?: string) {
  if (accountType === "LABOUR") return "/crew";
  return task.eventId ? `/bookings/${task.eventId}?tab=tasks` : "/home";
}

export type TaskMove = "start" | "done";

/** The assignee (or the team) starts a task or marks it done. */
export async function moveTask(db: Db, actor: Actor, taskId: string, move: TaskMove, meta: RequestMeta = {}) {
  return db.$transaction(async (tx) => {
    assertCan(actor, "tasks.update", "You can't update tasks.");
    const task = await loadTask(tx, actor, taskId);
    let next: "IN_PROGRESS" | "UNDER_REVIEW" | "COMPLETED";
    if (move === "start") {
      if (!["PENDING", "ASSIGNED", "DELAYED"].includes(task.status)) throw new ConflictError(task.status === "IN_PROGRESS" ? "This task is already started." : "This task can't be started now.");
      next = "IN_PROGRESS";
    } else {
      if (!["PENDING", "ASSIGNED", "IN_PROGRESS", "DELAYED"].includes(task.status)) throw new ConflictError(task.status === "UNDER_REVIEW" ? "This task is already waiting to be checked." : "This task is already closed.");
      if (task.needsProof && task._count.proofs === 0) throw new ConflictError("Add a photo or video of the finished work first.");
      next = task.needsProof || task.needsApproval ? "UNDER_REVIEW" : "COMPLETED";
    }
    await tx.task.update({ where: { id: task.id }, data: { status: next, completedAt: next === "COMPLETED" ? new Date() : task.completedAt } });
    if (next === "UNDER_REVIEW" && task.eventId) {
      const reviewers = task.reviewerId ? [task.reviewerId] : await bookingTeamUserIds(tx, task.eventId, ["MANAGER", "SUPERVISOR"]);
      await notify(tx, reviewers, { type: "task.review", title: `Done, please check: ${task.title}`, body: `${actor.name} · ${task.event?.name ?? ""}`, link: taskLink(task), entityType: "task", entityId: task.id }, { exceptUserId: actor.userId });
    }
    await recordAudit(tx, actor, { action: move, entityType: "task", entityId: task.id, summary: `${actor.name}: "${task.title}" → ${next.toLowerCase().replace("_", " ")}` }, meta);
    return { status: next };
  });
}

export const reviewTaskSchema = z.object({ decision: z.enum(["APPROVE", "SEND_BACK"]), note: z.string().trim().max(1000).optional() });

/** The team signs a finished task off, or sends it back with a note. */
export async function reviewTask(db: Db, actor: Actor, taskId: string, input: z.input<typeof reviewTaskSchema>, meta: RequestMeta = {}) {
  const v = parseInput(reviewTaskSchema, input);
  if (v.decision === "SEND_BACK" && !v.note) throw new ValidationError("Say what still needs doing.", { note: "A note is needed." });
  return db.$transaction(async (tx) => {
    if (actor.accountType !== "INTERNAL") throw new ForbiddenError("Only the team signs tasks off.");
    assertCan(actor, "tasks.approve", "You can't sign tasks off.");
    const task = await loadTask(tx, actor, taskId);
    if (!task.eventId) throw new ConflictError("Only tasks on a booking are signed off here.");
    await assertEventAccess(tx, actor, task.eventId, "tasks.approve");
    if (task.status !== "UNDER_REVIEW") throw new ConflictError("This task isn't waiting to be checked.");
    if (task.assigneeId === actor.userId && !actor.isOwner) throw new ForbiddenError("Someone else should sign off your own task.");
    const now = new Date();
    await tx.task.update({
      where: { id: task.id },
      data: v.decision === "APPROVE" ? { status: "COMPLETED", approvedAt: now, completedAt: now } : { status: "IN_PROGRESS" },
    });
    if (v.note) await tx.taskComment.create({ data: { taskId: task.id, authorId: actor.userId, body: v.note } });
    await notify(
      tx,
      [task.assigneeId],
      v.decision === "APPROVE"
        ? { type: "task.approved", title: `Signed off: ${task.title}`, body: task.event?.name ?? null, link: taskLink(task, task.assignee?.accountType), entityType: "task", entityId: task.id }
        : { type: "task.sentBack", title: `Not done yet: ${task.title}`, body: v.note!, link: taskLink(task, task.assignee?.accountType), entityType: "task", entityId: task.id },
      { exceptUserId: actor.userId },
    );
    await recordAudit(tx, actor, { action: v.decision === "APPROVE" ? "approve" : "send-back", entityType: "task", entityId: task.id, summary: `${v.decision === "APPROVE" ? "Signed off" : "Sent back"} "${task.title}"${v.note ? ` · ${v.note}` : ""}` }, meta);
  });
}

/** What this person may do with a task right now, for the buttons on screen. onBooking: they are on the booking's team. */
export function taskActions(
  actor: Actor,
  task: { status: string; assigneeId: string | null; needsProof: boolean; eventId: string | null },
  opts: { onBooking: boolean; proofCount: number },
) {
  const mine = task.assigneeId === actor.userId;
  const staff = actor.accountType === "INTERNAL";
  // Same rules as the server: OWN covers your own tasks; ASSIGNED adds tasks on bookings you are on.
  const reach = (scope: string | undefined) => scope === "ALL" || (scope === "ASSIGNED" && opts.onBooking);
  const mayUpdate = !!actor.grants.get("tasks.update") && (mine || (staff && reach(actor.grants.get("tasks.update"))));
  const open = ["PENDING", "ASSIGNED", "DELAYED"].includes(task.status);
  return {
    start: mayUpdate && open,
    done: mayUpdate && (open || task.status === "IN_PROGRESS"),
    needsProofFirst: task.needsProof && opts.proofCount === 0,
    addProof: can(actor, "proof.upload") && task.needsProof && !["COMPLETED", "CANCELLED", "UNDER_REVIEW"].includes(task.status) && (mine || actor.accountType === "INTERNAL"),
    review: staff && reach(actor.grants.get("tasks.approve")) && task.status === "UNDER_REVIEW" && (actor.isOwner || !mine),
  };
}
