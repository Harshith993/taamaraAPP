/** Background housekeeping for files, started from src/instrumentation.ts. */
import { db } from "@/lib/db";
import { resumeProcessing } from "./processing";
import { cleanupAbandonedUploads } from "./uploads";

const HOUR = 3600_000;
let started = false;

export function startBackgroundWork() {
  if (started) return;
  started = true;
  resumeProcessing(db)
    .then((n) => n && console.log(`Resumed processing of ${n} file(s).`))
    .catch((err) => console.error("Could not resume media processing", err));
  const sweep = () => cleanupAbandonedUploads(db).catch((err) => console.error("Upload cleanup failed", err));
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, HOUR).unref();
}
