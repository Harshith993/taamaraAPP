/** Plain-language labels and tag colours for booking and job states. */
export const EVENT_STATUS_TONE = {
  TENTATIVE: "quiet",
  CONFIRMED: "outline",
  PLANNING: "outline",
  LIVE: "now",
  COMPLETED: "ok",
  SETTLED: "ok",
  POSTPONED: "quiet",
  CANCELLED: "quiet",
} as const;

/** Vendor job stages in order, for the progress bar. */
export const VENDOR_STAGES = ["INVITED", "QUOTED", "APPROVED", "ACCEPTED", "IN_PROGRESS", "COMPLETED"] as const;

export const VENDOR_STAGE_WORDS: Record<string, string> = {
  INVITED: "Invited · no quote yet",
  QUOTED: "Quoted · needs approval",
  APPROVED: "Approved · awaiting vendor",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  DELIVERED: "Delivered · to check",
  COMPLETED: "Done",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

export function vendorStageIndex(status: string): number {
  if (status === "DELIVERED") return 5;
  const i = (VENDOR_STAGES as readonly string[]).indexOf(status);
  return i < 0 ? 0 : i + 1;
}
