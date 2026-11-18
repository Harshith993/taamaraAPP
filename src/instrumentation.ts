/**
 * Runs once when the server starts (Node.js only): picks up media processing that a restart
 * interrupted, clears out abandoned uploads every hour, sends reminders and delivers notifications.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.TAAMARA_BACKGROUND === "off") return;
  const { startBackgroundWork } = await import("./modules/files/background");
  startBackgroundWork();
  const { startReminders } = await import("./modules/reminders/background");
  startReminders();
}
