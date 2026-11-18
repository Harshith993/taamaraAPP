import "dotenv/config";
import os from "node:os";
import path from "node:path";

// Every test talks to the disposable test database, never the development one.
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// Uploaded files go to a throwaway folder, never the development storage.
process.env.STORAGE_DIR = path.join(os.tmpdir(), `taamara-test-storage-${process.pid}`);
process.env.TAAMARA_BACKGROUND = "off";
