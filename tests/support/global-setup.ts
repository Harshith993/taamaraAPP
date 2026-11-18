/**
 * Rebuilds the TEST database from the migrations before the suite runs, then loads reference data.
 * Safety: refuses to touch any database whose name does not end in "_test".
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset "${dbName}": the test database name must end in "_test".`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO: "false" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
