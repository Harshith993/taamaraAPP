/**
 * Logins and sessions (Better Auth, sessions stored in our own database).
 *
 * - Sign in with email + password or phone number + password; nobody can sign themselves up:
 *   owners create every account (src/modules/identity/users.ts).
 * - Switched-off accounts cannot start a session (databaseHooks below), and switching an account
 *   off deletes its sessions, so the person is signed out everywhere at once.
 * - Login attempts are rate limited per IP in the database.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { db } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";

const isProd = process.env.NODE_ENV === "production";

export const SESSION_DAYS = 30;

export const auth = betterAuth({
  appName: "Taamara Taamara",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * SESSION_DAYS,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 300, max: 8 },
      "/sign-in/phone-number": { window: 300, max: 8 },
      "/change-password": { window: 300, max: 8 },
    },
  },
  advanced: {
    cookiePrefix: "taamara",
    useSecureCookies: isProd,
    database: { generateId: "uuid" },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { status: true } });
          if (!user || user.status !== "ACTIVE") {
            throw new APIError("FORBIDDEN", { message: "This account has been switched off. Please ask a host." });
          }
        },
        after: async (session) => {
          await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
          // Every sign-in is in the audit log (D56: an outside accountant logs in).
          await recordAudit(db, { userId: session.userId }, { action: "sign-in", entityType: "user", entityId: session.userId, summary: "Signed in" }, { ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null });
        },
      },
    },
  },
  plugins: [
    phoneNumber({
      // SMS (OTP) is not set up yet: crew and vendors sign in with phone + password, and owners reset
      // forgotten passwords. When an SMS provider is chosen, send the code from here.
      sendOTP: async () => {
        throw new APIError("NOT_IMPLEMENTED", { message: "Text-message codes are not set up yet. Ask a host to reset your password." });
      },
    }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
