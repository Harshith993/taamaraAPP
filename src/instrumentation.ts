/**
 * Runs once when the server starts (Node.js only): picks up media processing that a restart
 * interrupted, and clears out abandoned uploads every hour. Phase 8 moves this to pg-boss jobs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.TAAMARA_BACKGROUND === "off") return;
  const { startBackgroundWork } = await import("./modules/files/background");
  startBackgroundWork();
}
