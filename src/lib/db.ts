import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function createDbClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForDb = globalThis as unknown as { taamaraDb?: PrismaClient };

/** The shared database client (one per process; reused across hot reloads in development). */
export const db: PrismaClient = globalForDb.taamaraDb ?? createDbClient();

if (process.env.NODE_ENV !== "production") globalForDb.taamaraDb = db;

export type Db = PrismaClient;
/** A client or an interactive transaction: services accept either. */
export type DbTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

/**
 * Like Promise.all, but one query after another. Inside a transaction there is a single database
 * connection, so queries must not overlap (the pg driver warns now and will refuse in pg 9).
 * Prisma queries only start when awaited, so passing them in an array is safe.
 */
export async function inSequence<T extends readonly unknown[] | []>(queries: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const out: unknown[] = [];
  for (const q of queries) out.push(await q);
  return out as { -readonly [P in keyof T]: Awaited<T[P]> };
}
