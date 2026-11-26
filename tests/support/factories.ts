import { createDbClient } from "@/lib/db";

/** A client bound to the test database (tests/support/env.ts points DATABASE_URL at it). */
export const testDb = createDbClient(process.env.TEST_DATABASE_URL);

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeClient(name = `Client ${uniq()}`) {
  return testDb.client.create({ data: { name } });
}

export async function makeEvent(opts: { name?: string } = {}) {
  const client = await makeClient();
  const category = await testDb.eventCategory.findFirstOrThrow({ where: { name: "Wedding" } });
  return testDb.event.create({
    data: { code: `T-${uniq()}`, name: opts.name ?? `Event ${uniq()}`, categoryId: category.id, clientId: client.id },
    include: { client: true },
  });
}

export async function makeVendor(companyName = `Vendor ${uniq()}`) {
  return testDb.vendor.create({ data: { contactName: "Contact", companyName } });
}

export async function makeWorker(name = `Worker ${uniq()}`) {
  return testDb.worker.create({ data: { name, phone: `+9199${String(Date.now()).slice(-8)}` } });
}

export async function makeUser(opts: { name?: string; roleKey?: string; accountType?: "INTERNAL" | "VENDOR" | "LABOUR"; phone?: string } = {}) {
  const id = uniq();
  return testDb.user.create({
    data: {
      name: opts.name ?? `User ${id}`,
      email: `${id}@test.taamara.invalid`,
      phoneNumber: opts.phone,
      accountType: opts.accountType ?? "INTERNAL",
      roles: opts.roleKey ? { create: { role: { connect: { key: opts.roleKey } } } } : undefined,
    },
  });
}

export async function makeFile(uploadedById?: string) {
  return testDb.file.create({ data: { storageKey: `test/${uniq()}.jpg`, filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 10, uploadedById, status: "READY" } });
}

/** A finished upload to attach as an expense's bill (every expense needs one, D53). */
export async function makeReceipt(uploadedById: string) {
  return (await testDb.file.create({ data: { storageKey: `document/test/${uniq()}/original`, filename: "bill.jpg", mimeType: "image/jpeg", sizeBytes: 10, purpose: "DOCUMENT", status: "READY", uploadedById } })).id;
}
