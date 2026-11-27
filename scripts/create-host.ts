/**
 * Creates the first Host on a new, empty database (Phase 10). Everyone else is then added on the
 * Team page. Refuses if any host already exists.
 *
 *   npx tsx scripts/create-host.ts "Radhika Sharma" 98000 00001 [title]     title: Host (default) or Co-host
 *
 * Prints a temporary password once; it must be changed at the first sign-in.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { createDbClient } from "../src/lib/db";
import { normalizePhone, placeholderEmailForPhone } from "../src/lib/phone";

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const title = rest.at(-1) === "Co-host" || rest.at(-1) === "Host" ? rest.pop()! : "Host";
  const phone = normalizePhone(rest.join(" "));
  if (!name || name.trim().length < 2 || !phone) {
    console.error('Usage: npx tsx scripts/create-host.ts "Full name" <mobile number> [Host|Co-host]');
    process.exit(2);
  }
  const db = createDbClient();
  try {
    if (await db.user.count({ where: { roles: { some: { role: { isOwner: true } } } } })) {
      console.error("A host already exists. Add people on the Team page instead.");
      process.exit(1);
    }
    if (!(await db.role.count({ where: { key: "OWNER" } }))) {
      console.error("Roles are missing. Run the reference seed first: SEED_DEMO=false npm run db:seed");
      process.exit(1);
    }
    const temporary = `Tt-${randomBytes(6).toString("base64url")}`;
    const user = await db.user.create({
      data: {
        name: name.trim(),
        email: placeholderEmailForPhone(phone),
        hasRealEmail: false,
        phoneNumber: phone,
        phoneNumberVerified: true,
        accountType: "INTERNAL",
        title,
        mustChangePassword: true,
        roles: { create: { role: { connect: { key: "OWNER" } } } },
      },
    });
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(temporary) } });
    await db.auditLog.create({ data: { actorId: null, action: "create", entityType: "user", entityId: user.id, summary: `Created the first ${title}, ${user.name}, from the server console` } });
    console.log(`${title} created: ${user.name} (${phone}). Temporary password: ${temporary}`);
    console.log("Sign in with the mobile number and this password; the app asks for a new one straight away.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
