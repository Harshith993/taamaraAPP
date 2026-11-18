import type { DbTx } from "./db";

/** Gap-free, readable numbers per document type and period, e.g. EVT-2026-0042 or WO-2026-0007. Call inside the transaction that uses the number. */
export async function nextDocumentNumber(
  tx: DbTx,
  docType: string,
  period: string,
  prefix: string,
): Promise<string> {
  const seq = await tx.documentSequence.upsert({
    where: { docType_period: { docType, period } },
    create: { docType, period, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${period}-${String(seq.nextValue - 1).padStart(4, "0")}`;
}
