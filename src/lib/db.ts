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
