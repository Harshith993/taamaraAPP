/**
 * Company switches the owners control (stored in company_profile.settings). They answer the open
 * questions in ARCHITECTURE.md §3 without a code change: crew pay visibility (Q5), crew self check-in
 * (Q4), proof from the gallery and the video limit (Q10), and proof before a vendor's final payment.
 * Every change takes effect on the next page load (the actor is read fresh on each request).
 */
import { z } from "zod";
import type { Db } from "@/lib/db";
import { parseInput } from "@/lib/validate";
import { recordAudit, type RequestMeta } from "@/modules/audit/audit";
import { readSwitches, type Actor, type CompanySwitches } from "@/modules/identity/actor";
import { assertCan } from "@/modules/identity/policy";

export const switchesSchema = z.object({
  crewCanSeePay: z.boolean(),
  crewSelfCheckIn: z.boolean(),
  proofFromGallery: z.boolean(),
  maxVideoSeconds: z.coerce.number().int().min(15, "At least 15 seconds.").max(300, "At most 5 minutes."),
  finalVendorPaymentNeedsProof: z.boolean(),
});

export const SWITCH_LABELS: Record<keyof CompanySwitches, { label: string; help: string }> = {
  crewCanSeePay: { label: "Crew see their own pay", help: "The agreed amount, approved extras and what has been paid, per event." },
  crewSelfCheckIn: { label: "Crew check themselves in", help: "Crew tap “I'm here” on arrival and their location is recorded. Supervisors can always mark attendance too." },
  proofFromGallery: { label: "Proof can come from the gallery", help: "When off, vendors and crew must use the camera, so photos are taken on the spot." },
  maxVideoSeconds: { label: "Longest proof video (seconds)", help: "Longer videos are refused on the phone and on the server." },
  finalVendorPaymentNeedsProof: { label: "Vendor's final payment needs approved proof", help: "Owners are warned before paying a vendor whose work has no approved photo or video." },
};

export async function getSwitches(db: Db): Promise<CompanySwitches> {
  const company = await db.companyProfile.findUnique({ where: { id: 1 }, select: { settings: true } });
  return readSwitches(company?.settings);
}

export async function updateSwitches(db: Db, actor: Actor, input: z.input<typeof switchesSchema>, meta: RequestMeta = {}) {
  assertCan(actor, "admin.settings", "Only owners change these settings.");
  const v = parseInput(switchesSchema, input);
  return db.$transaction(async (tx) => {
    const company = await tx.companyProfile.findUniqueOrThrow({ where: { id: 1 }, select: { settings: true } });
    const before = readSwitches(company.settings);
    const stored = company.settings && typeof company.settings === "object" ? (company.settings as Record<string, unknown>) : {};
    await tx.companyProfile.update({ where: { id: 1 }, data: { settings: { ...stored, ...v } } });
    const changed = (Object.keys(v) as (keyof CompanySwitches)[]).filter((k) => before[k] !== v[k]);
    if (changed.length) {
      await recordAudit(
        tx,
        actor,
        {
          action: "update",
          entityType: "company_settings",
          entityId: "1",
          summary: `Changed ${changed.map((k) => `"${SWITCH_LABELS[k].label}" to ${typeof v[k] === "boolean" ? (v[k] ? "on" : "off") : v[k]}`).join(", ")}`,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, v[k]])),
        },
        meta,
      );
    }
    return { changed: changed.length };
  });
}
