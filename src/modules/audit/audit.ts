import type { DbTx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/modules/identity/actor";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  financial?: boolean;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Writes one append-only audit entry. Call it inside the same transaction as the change it describes. */
export async function recordAudit(tx: DbTx, actor: Pick<Actor, "userId"> | null, entry: AuditEntry, meta: RequestMeta = {}) {
  await tx.auditLog.create({
    data: {
      actorId: actor?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      financial: entry.financial ?? false,
      before: entry.before,
      after: entry.after,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
}
