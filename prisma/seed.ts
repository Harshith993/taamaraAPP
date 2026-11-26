/**
 * Seed data for Taamara Taamara.
 *
 *   npm run db:seed              reference data + demo data (development)
 *   SEED_DEMO=false npm run db:seed   reference data only (production)
 *
 * Reference data (roles, permissions, lists) is upserted and safe to run repeatedly.
 * Demo data is added only when the database has no bookings yet.
 * Demo logins all use the password in DEMO_PASSWORD below and are for local use only.
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { createDbClient } from "../src/lib/db";
import { placeholderEmailForPhone } from "../src/lib/phone";
import { DEFAULT_ROLE_GRANTS, ROLES, type RoleKey } from "../src/modules/identity/permissions";
import { demoMedia, type DemoArt } from "./seed-media";

const db = createDbClient();
export const DEMO_PASSWORD = "Taamara@2026";

// ───────────────────────────── helpers ─────────────────────────────

const IST_OFFSET = "+05:30";

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = istToday();
/** A calendar date (stored as DATE). */
function day(offset: number): Date {
  return new Date(`${addDays(TODAY, offset)}T00:00:00Z`);
}
/** A moment in India time. */
function at(offset: number, hhmm: string): Date {
  return new Date(`${addDays(TODAY, offset)}T${hhmm}:00${IST_OFFSET}`);
}

async function nextCode(docType: string, period: string, prefix: string): Promise<string> {
  const seq = await db.documentSequence.upsert({
    where: { docType_period: { docType, period } },
    create: { docType, period, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const n = seq.nextValue - 1;
  return `${prefix}-${period}-${String(n).padStart(4, "0")}`;
}

// ───────────────────────────── reference data ─────────────────────────────

async function seedReference() {
  await db.companyProfile.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      legalName: "Taamara Taamara",
      tradeName: "Taamara Taamara",
      tagline: "events & beyond",
      state: "Rajasthan",
      stateCode: "08",
      settings: { crewCanSeePay: true, proofFromGallery: true, maxVideoSeconds: 120, finalVendorPaymentNeedsProof: true },
    },
    update: {},
  });

  for (const role of Object.values(ROLES)) {
    const saved = await db.role.upsert({
      where: { key: role.key },
      create: { key: role.key, name: role.name, description: role.description, accountType: role.accountType, isOwner: role.isOwner, isSystem: true },
      update: { name: role.name, description: role.description, accountType: role.accountType, isOwner: role.isOwner },
    });
    if (role.isOwner) continue;
    const existing = await db.rolePermission.count({ where: { roleId: saved.id } });
    if (existing > 0) continue; // never overwrite permissions an owner has edited
    const grants = DEFAULT_ROLE_GRANTS[role.key as Exclude<RoleKey, "OWNER">];
    await db.rolePermission.createMany({
      data: Object.entries(grants).map(([permission, scope]) => ({ roleId: saved.id, permission, scope: scope! })),
    });
  }

  const eventCategories: [string, string][] = [
    ["Wedding", "#DD619A"], ["Pre-wedding", "#AFC147"], ["Engagement", "#E2A1BB"], ["Birthday", "#E8963A"],
    ["Anniversary", "#861A41"], ["Corporate", "#D84F2F"], ["Cocktail party", "#F3C644"], ["Private party", "#F0B13C"],
    ["Concert", "#E8963A"], ["Conference", "#D84F2F"], ["College festival", "#AFC147"], ["Product launch", "#D84F2F"], ["Other", "#85A646"],
  ];
  for (const [i, [name, color]] of eventCategories.entries()) {
    await db.eventCategory.upsert({ where: { name }, create: { name, color, sortOrder: i }, update: {} });
  }

  const vendorCategories: [string, string][] = [
    ["Decoration", "#DD619A"], ["Lighting", "#F3C644"], ["Sound", "#E8963A"], ["Catering", "#85A646"],
    ["Photography & video", "#AFC147"], ["Transport", "#D84F2F"], ["Stage setup", "#DD619A"], ["Security", "#861A41"],
    ["Equipment rental", "#861A41"], ["Entertainment", "#E8963A"], ["Florist", "#DD619A"], ["Makeup & mehendi", "#E2A1BB"],
    ["Venue", "#85A646"], ["Manpower", "#861A41"], ["Other", "#6B5560"],
  ];
  for (const [i, [name, color]] of vendorCategories.entries()) {
    await db.vendorCategory.upsert({ where: { name }, create: { name, color, sortOrder: i }, update: {} });
  }

  const skills = ["Helper", "Decorator", "Electrician", "Waiter", "Driver", "Supervisor", "Cleaner", "Security", "Carpenter", "Sound technician"];
  for (const [i, name] of skills.entries()) {
    await db.skill.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
  }

  const expenseCategories: [string, "VENDOR" | "LABOUR" | "TRANSPORT" | "EQUIPMENT" | "FOOD" | "ACCOMMODATION" | "MISC"][] = [
    ["Vendor payments", "VENDOR"], ["Crew pay", "LABOUR"], ["Transport", "TRANSPORT"], ["Equipment hire", "EQUIPMENT"],
    ["Food and refreshments", "FOOD"], ["Accommodation", "ACCOMMODATION"], ["Miscellaneous", "MISC"],
  ];
  for (const [i, [name, group]] of expenseCategories.entries()) {
    await db.expenseCategory.upsert({ where: { name }, create: { name, group, sortOrder: i }, update: {} });
  }

  const template = await db.taskTemplate.upsert({
    where: { name: "Wedding: standard checklist" },
    create: {
      name: "Wedding: standard checklist",
      description: "Created automatically for every new wedding booking.",
      items: {
        create: [
          { title: "Confirm functions, dates and venues with the family", priority: "HIGH", dueOffsetDays: -45, sortOrder: 1 },
          { title: "Collect the advance payment", priority: "HIGH", dueOffsetDays: -40, sortOrder: 2 },
          { title: "Request quotes: decor, catering, lights, sound", priority: "HIGH", dueOffsetDays: -35, sortOrder: 3 },
          { title: "Approve quotes and issue work orders", priority: "HIGH", dueOffsetDays: -28, sortOrder: 4 },
          { title: "Book crew for every function", priority: "MEDIUM", dueOffsetDays: -14, sortOrder: 5 },
          { title: "Final guest count to caterer", priority: "HIGH", dueOffsetDays: -5, sortOrder: 6 },
          { title: "Seating plan and run sheet shared with supervisors", priority: "MEDIUM", dueOffsetDays: -3, sortOrder: 7 },
          { title: "Venue walk-through with decor and lights", priority: "MEDIUM", dueOffsetDays: -2, sortOrder: 8 },
          { title: "Stage and mandap ready (photo proof)", priority: "URGENT", dueOffsetDays: 0, needsProof: true, sortOrder: 9 },
          { title: "Collect the final payment", priority: "HIGH", dueOffsetDays: 3, sortOrder: 10 },
        ],
      },
    },
    update: {},
  });
  await db.eventCategory.update({ where: { name: "Wedding" }, data: { defaultTemplateId: template.id } });
}

// ───────────────────────────── demo data ─────────────────────────────

async function demoUser(opts: { name: string; role: RoleKey; email?: string; phone: string }) {
  const accountType = ROLES[opts.role].accountType;
  const email = opts.email ?? placeholderEmailForPhone(opts.phone);
  const user = await db.user.create({
    data: {
      name: opts.name,
      email,
      hasRealEmail: Boolean(opts.email),
      phoneNumber: opts.phone,
      phoneNumberVerified: true,
      emailVerified: Boolean(opts.email),
      accountType,
      roles: { create: { role: { connect: { key: opts.role } } } },
    },
  });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(DEMO_PASSWORD) },
  });
  return user;
}

async function seedDemo() {
  if ((await db.event.count()) > 0) {
    console.log("Demo data already present: skipped.");
    return;
  }
  const cat = async (name: string) => (await db.eventCategory.findUniqueOrThrow({ where: { name } })).id;
  const vcat = async (name: string) => (await db.vendorCategory.findUniqueOrThrow({ where: { name } })).id;
  const skill = async (name: string) => (await db.skill.findUniqueOrThrow({ where: { name } })).id;
  const expCat = async (name: string) => (await db.expenseCategory.findUniqueOrThrow({ where: { name } })).id;

  // People who log in
  const founder = await demoUser({ name: "Radhika", role: "OWNER", email: "founder@demo.taamara.in", phone: "+919800000001" });
  const cofounder = await demoUser({ name: "Co-founder", role: "OWNER", email: "cofounder@demo.taamara.in", phone: "+919800000002" });
  await db.user.update({ where: { id: cofounder.id }, data: { title: "Co-host" } });
  const priya = await demoUser({ name: "Priya Sharma", role: "EVENT_MANAGER", email: "priya@demo.taamara.in", phone: "+919800000003" });
  const aman = await demoUser({ name: "Aman Verma", role: "EVENT_MANAGER", email: "aman@demo.taamara.in", phone: "+919800000004" });
  const kavita = await demoUser({ name: "Kavita Jain", role: "ACCOUNTANT", email: "accounts@demo.taamara.in", phone: "+919800000005" });
  const ramesh = await demoUser({ name: "Ramesh Kumar", role: "SUPERVISOR", phone: "+919800000006" });

  // Clients and venues
  const gupta = await db.client.create({ data: { name: "Anil Gupta", phone: "+919001100001", city: "Jaipur", state: "Rajasthan", contacts: { create: [{ name: "Anil Gupta", relation: "Bride's father", phone: "+919001100001" }, { name: "Meena Gupta", relation: "Bride's mother", phone: "+919001100011" }] } } });
  const arora = await db.client.create({ data: { name: "Sneha Arora", phone: "+919001100003", city: "Jaipur", state: "Rajasthan" } });
  const jain = await db.client.create({ data: { name: "Vivek Jain", phone: "+919001100002", city: "Jaipur", state: "Rajasthan" } });
  const sharma = await db.client.create({ data: { name: "Rakesh Sharma", phone: "+919001100004", city: "Jaipur", state: "Rajasthan" } });
  const mittal = await db.client.create({ data: { name: "Pooja Mittal", phone: "+919001100005", city: "Jaipur", state: "Rajasthan" } });
  const infotech = await db.client.create({ data: { type: "COMPANY", name: "Infotech Systems Pvt Ltd", phone: "+911412700000", city: "Jaipur", state: "Rajasthan", gstin: "08AABCI1234F1Z5" } });

  const rambagh = await db.venue.create({ data: { name: "Rambagh Gardens", address: "Bhawani Singh Road", city: "Jaipur", capacity: 800, latitude: 26.8985, longitude: 75.8069 } });
  const guptaHouse = await db.venue.create({ data: { name: "Gupta Residence", address: "C-Scheme", city: "Jaipur", capacity: 150, latitude: 26.9064, longitude: 75.8016 } });
  const fairmont = await db.venue.create({ data: { name: "Fairmont Jaipur", address: "Kukas", city: "Jaipur", capacity: 1000, latitude: 27.0418, longitude: 75.8868 } });
  const marigold = await db.venue.create({ data: { name: "Hotel Marigold Banquet", city: "Jaipur", capacity: 200 } });
  const nahargarh = await db.venue.create({ data: { name: "Nahargarh Fort", city: "Jaipur", latitude: 26.9373, longitude: 75.8155 } });

  // Vendors (two have logins)
  const vendor = async (contactName: string, companyName: string, category: string, phone: string, services: string, gstin?: string) =>
    db.vendor.create({ data: { contactName, companyName, phone, whatsapp: phone, city: "Jaipur", services, gstin, categories: { create: { categoryId: await vcat(category) } } } });
  const gulmohar = await vendor("Imran Khan", "Gulmohar Decor", "Decoration", "+919811000002", "Mandap, stage, entrance, theme decor", "08AAFFG1234K1Z2");
  const roshni = await vendor("Mahesh Saini", "Roshni Lights", "Lighting", "+919811000005", "Fairy lights, uplighters, stage wash", "08ABCPR5678L1Z9");
  const annapurna = await vendor("Suresh Agarwal", "Annapurna Caterers", "Catering", "+919811000001", "Veg buffet, live counters", "08AAKFA4321C1Z7");
  const djVicky = await vendor("Vicky", "DJ Vicky & Sound", "Sound", "+919811000004", "DJ, sound, mics");
  const frameStory = await vendor("Neha Kapoor", "Frame Story Studio", "Photography & video", "+919811000003", "Candid photo, films", "08AAMFF9876P1Z3");
  const petalPoint = await vendor("Ritu", "Petal Point Florist", "Florist", "+919811000009", "Varmala, car flowers, garlands");
  const rajTravels = await vendor("Rajendra Singh", "Raj Travels", "Transport", "+919811000010", "Cars, shuttles");
  const prakash = await vendor("Prakash Meena", "Prakash Electricals", "Lighting", "+919811000011", "Lighting, generators");
  await db.vendorBankDetail.create({ data: { vendorId: roshni.id, accountName: "Roshni Lights", accountNumberLast4: "4821", ifsc: "SBIN0031234", upiId: "roshnilights@sbi" } });

  const roshniUser = await demoUser({ name: "Mahesh Saini", role: "VENDOR", phone: "+919811000005" });
  const gulmoharUser = await demoUser({ name: "Imran Khan", role: "VENDOR", phone: "+919811000002" });
  await db.vendorUser.createMany({ data: [{ vendorId: roshni.id, userId: roshniUser.id }, { vendorId: gulmohar.id, userId: gulmoharUser.id }] });

  // Crew (two have logins)
  const crewList: [string, string, string, number][] = [
    ["Sunil Yadav", "+919922000002", "Decorator", 900], ["Manoj Saini", "+919922000003", "Decorator", 900],
    ["Deepak Meena", "+919922000004", "Electrician", 1100], ["Arjun Prajapat", "+919922000005", "Helper", 700],
    ["Vikas Jangid", "+919922000006", "Helper", 700], ["Salim Qureshi", "+919922000007", "Helper", 700],
    ["Gopal Sharma", "+919922000008", "Waiter", 800], ["Kailash Bairwa", "+919922000009", "Waiter", 800],
    ["Raju Gurjar", "+919922000010", "Driver", 1000],
  ];
  const workers: Record<string, { id: string }> = {};
  for (const [name, phone, skillName, rate] of crewList) {
    workers[name] = await db.worker.create({ data: { name, phone, city: "Jaipur", usualEventRate: rate, skills: { create: { skillId: await skill(skillName) } } } });
  }
  const sunilUser = await demoUser({ name: "Sunil Yadav", role: "LABOUR", phone: "+919922000002" });
  const arjunUser = await demoUser({ name: "Arjun Prajapat", role: "LABOUR", phone: "+919922000005" });
  await db.worker.update({ where: { id: workers["Sunil Yadav"].id }, data: { userId: sunilUser.id } });
  await db.worker.update({ where: { id: workers["Arjun Prajapat"].id }, data: { userId: arjunUser.id } });

  const year = TODAY.slice(0, 4);

  // ── Booking 1: Aditi & Karan wedding, five functions ──
  const wedding = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Aditi & Karan", categoryId: await cat("Wedding"), clientId: gupta.id,
      status: "PLANNING", startDate: day(1), endDate: day(6), expectedGuests: 450, createdById: founder.id,
      description: "Pastel theme. Baraat from Hotel Clarks at 19:00 on the wedding day.",
      members: { create: [{ userId: priya.id, role: "MANAGER" }, { userId: ramesh.id, role: "SUPERVISOR" }] },
    },
  });
  const fn = async (eventId: string, name: string, offset: number, start: string, end: string, venueId: string, guests: number, sortOrder: number) =>
    db.eventFunction.create({ data: { eventId, name, date: day(offset), startsAt: at(offset, start), endsAt: at(offset + (end < start ? 1 : 0), end), venueId, expectedGuests: guests, sortOrder } });
  const mehendi = await fn(wedding.id, "Mehendi", 1, "12:00", "18:00", guptaHouse.id, 120, 1);
  const sangeet = await fn(wedding.id, "Sangeet", 2, "19:00", "23:30", rambagh.id, 450, 2);
  const haldi = await fn(wedding.id, "Haldi", 3, "10:00", "13:00", guptaHouse.id, 100, 3);
  const pheras = await fn(wedding.id, "Wedding", 5, "19:00", "02:00", rambagh.id, 450, 4);
  const reception = await fn(wedding.id, "Reception", 6, "20:00", "23:30", fairmont.id, 500, 5);

  await db.scheduleItem.createMany({
    data: [
      { eventId: wedding.id, functionId: sangeet.id, type: "SETUP", title: "Decor setup", startsAt: at(2, "14:00"), endsAt: at(2, "17:00"), visibleToVendors: true, visibleToCrew: true, sortOrder: 1 },
      { eventId: wedding.id, functionId: sangeet.id, type: "VENDOR_REPORTING", title: "Sound check", startsAt: at(2, "16:30"), visibleToVendors: true, sortOrder: 2 },
      { eventId: wedding.id, functionId: sangeet.id, type: "CREW_REPORTING", title: "Crew reporting", startsAt: at(2, "17:30"), visibleToCrew: true, sortOrder: 3 },
      { eventId: wedding.id, functionId: sangeet.id, type: "MEAL", title: "Live counters open", startsAt: at(2, "18:00"), visibleToVendors: true, sortOrder: 4 },
      { eventId: wedding.id, functionId: sangeet.id, type: "CEREMONY", title: "Doors open", startsAt: at(2, "19:00"), sortOrder: 5 },
      { eventId: wedding.id, functionId: sangeet.id, type: "PERFORMANCE", title: "Performances", startsAt: at(2, "20:30"), visibleToVendors: true, sortOrder: 6 },
      { eventId: wedding.id, functionId: sangeet.id, type: "MEAL", title: "Dinner", startsAt: at(2, "21:30"), visibleToVendors: true, sortOrder: 7 },
      { eventId: wedding.id, functionId: sangeet.id, type: "DISMANTLE", title: "Teardown", startsAt: at(2, "23:30"), visibleToCrew: true, sortOrder: 8 },
    ],
  });

  const assign = async (eventId: string, vendorId: string, category: string, scopeOfWork: string, status: "INVITED" | "QUOTED" | "APPROVED" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED", functionIds: string[], agreed?: number) =>
    db.vendorAssignment.create({
      data: { eventId, vendorId, categoryId: await vcat(category), scopeOfWork, status, agreedAmount: agreed, createdById: priya.id, functions: { create: functionIds.map((functionId) => ({ functionId })) } },
    });
  const quote = async (assignmentId: string, vendorId: string, version: number, total: number, status: "SUBMITTED" | "APPROVED" | "REJECTED", description: string, decidedById?: string) => {
    const subtotal = Math.round((total / 1.18) * 100) / 100;
    return db.quotation.create({
      data: {
        assignmentId, vendorId, version, status, subtotal, taxAmount: Math.round((total - subtotal) * 100) / 100, total,
        validUntil: day(4), decidedById, decidedAt: decidedById ? new Date() : null,
        items: { create: [{ description, quantity: 1, rate: subtotal, amount: subtotal, gstRate: 18 }] },
      },
    });
  };
  const workOrder = async (assignmentId: string, quotationId: string, amount: number) =>
    db.workOrder.create({ data: { number: await nextCode("WO", year, "WO"), assignmentId, quotationId, amount, issuedById: founder.id, status: "ACKNOWLEDGED", acknowledgedAt: new Date() } });

  const decorA = await assign(wedding.id, gulmohar.id, "Decoration", "Mandap, stage, entrance", "IN_PROGRESS", [sangeet.id, pheras.id], 420000);
  const decorQ = await quote(decorA.id, gulmohar.id, 1, 420000, "APPROVED", "Mandap, stage and entrance decor", founder.id);
  await workOrder(decorA.id, decorQ.id, 420000);
  const lightsA = await assign(wedding.id, roshni.id, "Lighting", "Full venue lighting", "QUOTED", [pheras.id]);
  await quote(lightsA.id, roshni.id, 1, 44000, "REJECTED", "Venue lighting v1", founder.id);
  const lightsQ2 = await quote(lightsA.id, roshni.id, 2, 40000, "SUBMITTED", "Fairy-light canopy, 12 uplighters, stage wash");
  const lightsB = await assign(wedding.id, prakash.id, "Lighting", "Full venue lighting", "QUOTED", [pheras.id]);
  await quote(lightsB.id, prakash.id, 1, 46500, "SUBMITTED", "Venue lighting with generator");
  const cateringA = await assign(wedding.id, annapurna.id, "Catering", "Dinner and live counters, 450 pax", "IN_PROGRESS", [sangeet.id, pheras.id, reception.id], 340000);
  const cateringQ = await quote(cateringA.id, annapurna.id, 1, 340000, "APPROVED", "Dinner buffet 450 pax with 4 live counters", founder.id);
  const cateringWO = await workOrder(cateringA.id, cateringQ.id, 340000);
  const soundA = await assign(wedding.id, djVicky.id, "Sound", "DJ, sound, performance mics", "IN_PROGRESS", [mehendi.id, sangeet.id], 43000);
  const soundQ = await quote(soundA.id, djVicky.id, 1, 43000, "APPROVED", "DJ and sound for two functions", cofounder.id);
  await workOrder(soundA.id, soundQ.id, 43000);
  const photoA = await assign(wedding.id, frameStory.id, "Photography & video", "Candid photo and film", "ACCEPTED", [mehendi.id, sangeet.id, haldi.id, pheras.id, reception.id], 135000);
  const photoQ = await quote(photoA.id, frameStory.id, 1, 135000, "APPROVED", "Photo and film, five functions", founder.id);
  await workOrder(photoA.id, photoQ.id, 135000);
  const floristA = await assign(wedding.id, petalPoint.id, "Florist", "Varmala and car flowers", "APPROVED", [pheras.id], 12000);
  await quote(floristA.id, petalPoint.id, 1, 12000, "APPROVED", "Varmala pair and car flowers", founder.id);
  await assign(wedding.id, rajTravels.id, "Transport", "Baraat cars ×6, guest shuttles", "INVITED", [pheras.id]);

  await db.requirement.createMany({
    data: [
      { eventId: wedding.id, functionId: pheras.id, vendorCategoryId: await vcat("Lighting"), title: "Generator backup, 125 kVA", status: "OPEN", createdById: priya.id },
      { eventId: wedding.id, functionId: pheras.id, vendorCategoryId: await vcat("Decoration"), title: "Varmala stage backdrop", status: "OPEN", createdById: priya.id },
      { eventId: wedding.id, functionId: reception.id, vendorCategoryId: await vcat("Catering"), title: "Two extra live counters", source: "CLIENT", status: "OPEN", createdById: priya.id },
    ],
  });

  // Crew for the wedding, paid per event
  const crewFor = async (eventId: string, name: string, duty: string, pay: number, shifts: { functionId: string; offset: number; report: string; attendance?: "PRESENT" | "LATE" | "PENDING" }[]) =>
    db.crewAssignment.create({
      data: {
        eventId, workerId: workers[name].id, duty, agreedPay: pay, status: "CONFIRMED", createdById: priya.id,
        shifts: { create: shifts.map((s) => ({ functionId: s.functionId, date: day(s.offset), reportAt: at(s.offset, s.report), location: "Gate 2", attendance: s.attendance ?? "PENDING" })) },
      },
    });
  const sunilA = await crewFor(wedding.id, "Sunil Yadav", "Entrance garlands and stage drapes", 900, [{ functionId: sangeet.id, offset: 2, report: "17:30" }, { functionId: pheras.id, offset: 5, report: "14:00" }]);
  await crewFor(wedding.id, "Manoj Saini", "Stage decor", 900, [{ functionId: sangeet.id, offset: 2, report: "17:30" }]);
  await crewFor(wedding.id, "Deepak Meena", "Electrics", 1100, [{ functionId: sangeet.id, offset: 2, report: "17:30" }, { functionId: pheras.id, offset: 5, report: "14:00" }]);
  const arjunA = await crewFor(wedding.id, "Arjun Prajapat", "Setup and teardown", 700, [{ functionId: sangeet.id, offset: 2, report: "17:30" }]);
  await crewFor(wedding.id, "Gopal Sharma", "Serving", 800, [{ functionId: sangeet.id, offset: 2, report: "18:00" }]);
  await db.crewPayAdjustment.create({ data: { assignmentId: sunilA.id, type: "EXTRA", amount: 600, reason: "Late night after the Sangeet", requestedById: ramesh.id } });

  // Tasks
  await db.task.createMany({
    data: [
      { eventId: wedding.id, title: "Get the lights quote approved", priority: "HIGH", status: "IN_PROGRESS", dueAt: at(0, "18:00"), assigneeId: priya.id, createdById: founder.id },
      { eventId: wedding.id, title: "Final seating plan to the caterer", priority: "HIGH", status: "ASSIGNED", dueAt: at(3, "12:00"), assigneeId: aman.id, createdById: priya.id },
      { eventId: wedding.id, functionId: sangeet.id, title: "Stage side drapes", priority: "MEDIUM", status: "ASSIGNED", dueAt: at(2, "18:30"), assigneeId: sunilUser.id, reviewerId: ramesh.id, needsProof: true, createdById: priya.id },
      { eventId: wedding.id, functionId: sangeet.id, title: "Entrance garlands", priority: "MEDIUM", status: "UNDER_REVIEW", dueAt: at(2, "17:00"), assigneeId: sunilUser.id, reviewerId: ramesh.id, needsProof: true, createdById: priya.id },
      { eventId: wedding.id, functionId: haldi.id, title: "Haldi marigold order", priority: "MEDIUM", status: "PENDING", dueAt: at(1, "12:00"), createdById: priya.id },
      { eventId: wedding.id, title: "Collect the balance from Gupta ji", priority: "HIGH", status: "ASSIGNED", dueAt: at(4, "12:00"), assigneeId: founder.id, createdById: founder.id },
    ],
  });

  // Money for the wedding: what the client is billed (hidden from managers), payments and an approval
  await db.clientCharge.createMany({
    data: [
      { eventId: wedding.id, clientId: gupta.id, description: "Wedding package: five functions", sacCode: "998596", amount: 1650000, gstRate: 18, createdById: founder.id },
      { eventId: wedding.id, clientId: gupta.id, description: "Additional live counters and florals", sacCode: "998596", amount: 200000, gstRate: 18, createdById: founder.id },
    ],
  });
  await db.payment.create({ data: { direction: "IN", eventId: wedding.id, partyType: "CLIENT", clientId: gupta.id, amount: 600000, method: "BANK", reference: "Advance", paidOn: day(-40), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });
  await db.payment.create({ data: { direction: "IN", eventId: wedding.id, partyType: "CLIENT", clientId: gupta.id, amount: 400000, method: "UPI", paidOn: day(-10), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });
  await db.payment.create({ data: { direction: "OUT", eventId: wedding.id, partyType: "VENDOR", vendorId: gulmohar.id, amount: 150000, method: "BANK", reference: "Decor advance", paidOn: day(-9), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });
  await db.payment.create({ data: { direction: "OUT", eventId: wedding.id, partyType: "VENDOR", vendorId: annapurna.id, amount: 100000, method: "BANK", reference: "Catering advance", paidOn: day(-7), status: "PAID", requestedById: kavita.id, approvedById: cofounder.id, approvedAt: new Date(), paidById: kavita.id } });
  const cateringInvoice = await db.vendorInvoice.create({ data: { vendorId: annapurna.id, workOrderId: cateringWO.id, invoiceNumber: "AC/2026/118", invoiceDate: day(-1), taxableAmount: 101694.92, gstAmount: 18305.08, total: 120000, status: "VERIFIED", submittedById: kavita.id } });
  const pendingPayment = await db.payment.create({ data: { direction: "OUT", eventId: wedding.id, partyType: "VENDOR", vendorId: annapurna.id, vendorInvoiceId: cateringInvoice.id, amount: 120000, method: "BANK", note: "2nd instalment", status: "PENDING_APPROVAL", requestedById: kavita.id } });
  await db.approvalRequest.createMany({
    data: [
      { type: "PAYMENT", entityId: pendingPayment.id, eventId: wedding.id, amount: 120000, summary: "Annapurna Caterers · 2nd instalment", requestedById: kavita.id },
      { type: "QUOTATION", entityId: lightsQ2.id, eventId: wedding.id, amount: 40000, summary: "Roshni Lights · venue lighting, Wedding", requestedById: priya.id },
    ],
  });
  const extra = await db.crewPayAdjustment.findFirstOrThrow({ where: { assignmentId: sunilA.id } });
  await db.approvalRequest.create({ data: { type: "CREW_ADJUSTMENT", entityId: extra.id, eventId: wedding.id, amount: 600, summary: "Sunil Yadav · late night after the Sangeet", requestedById: ramesh.id } });

  const budget = await db.budget.create({ data: { eventId: wedding.id, status: "APPROVED", approvedById: founder.id, approvedAt: new Date() } });
  await db.budgetLine.createMany({
    data: [
      { budgetId: budget.id, categoryId: await expCat("Vendor payments"), description: "Decor, catering, lights, sound, photo, florist, transport", estimatedAmount: 1130000 },
      { budgetId: budget.id, categoryId: await expCat("Crew pay"), description: "Crew across five functions", estimatedAmount: 60000 },
      { budgetId: budget.id, categoryId: await expCat("Transport"), estimatedAmount: 35000 },
      { budgetId: budget.id, categoryId: await expCat("Miscellaneous"), estimatedAmount: 25000 },
    ],
  });

  // Work proof: demo photos and a video drawn on the fly and stored like real uploads
  const proofFile = async (name: string, uploadedById: string, art: DemoArt, kind: "photo" | "video" = "photo") =>
    db.file.create({ data: { ...(await demoMedia(art, kind)), filename: name, uploadedById, purpose: "PROOF", status: "READY", processedAt: new Date() } });
  const garlandTask = await db.task.findFirstOrThrow({ where: { title: "Entrance garlands" } });
  await db.workProof.create({ data: { eventId: wedding.id, functionId: sangeet.id, taskId: garlandTask.id, kind: "PHOTO", fileId: (await proofFile("entrance-garlands.jpg", sunilUser.id, "garlands")).id, caption: "Entrance garlands done", uploadedById: sunilUser.id } });
  await db.workProof.create({ data: { eventId: wedding.id, functionId: sangeet.id, vendorAssignmentId: decorA.id, kind: "PHOTO", fileId: (await proofFile("light-canopy.jpg", gulmoharUser.id, "canopy")).id, caption: "Fairy-light canopy", status: "APPROVED", uploadedById: gulmoharUser.id, reviewedById: ramesh.id, reviewedAt: new Date() } });
  await db.workProof.create({ data: { eventId: wedding.id, functionId: sangeet.id, crewAssignmentId: arjunA.id, kind: "VIDEO", fileId: (await proofFile("walkthrough.mp4", arjunUser.id, "canopy", "video")).id, caption: "Setup walkthrough", uploadedById: arjunUser.id } });

  // Messages
  const team = await db.channel.create({ data: { type: "BOOKING_TEAM", eventId: wedding.id, name: "Team · Aditi & Karan", members: { create: [founder, cofounder, priya, ramesh].map((u) => ({ userId: u.id })) } } });
  await db.message.createMany({
    data: [
      { channelId: team.id, senderId: priya.id, body: "Gulmohar can do the pastel mandap but need the colour swatches by Friday." },
      { channelId: team.id, senderId: founder.id, body: "Gupta ji wants two extra live counters at the reception. I'll revise the charges." },
    ],
  });
  const lightsThread = await db.channel.create({ data: { type: "VENDOR_THREAD", eventId: wedding.id, vendorId: roshni.id, name: "Roshni Lights · Aditi & Karan", members: { create: [{ userId: priya.id }, { userId: roshniUser.id }] } } });
  await db.message.create({ data: { channelId: lightsThread.id, senderId: priya.id, body: "Can you add 4 uplighters at the entrance?" } });

  // Cash advances (D57): Priya carries cash for the wedding; Ramesh's office advance is closed; one waits for a host.
  const bill = async (name: string, uploadedById: string) =>
    (await db.file.create({ data: { ...(await demoMedia("drapes", "photo")), filename: name, uploadedById, purpose: "DOCUMENT", status: "READY", processedAt: new Date() } })).id;
  const priyaCash = await db.cashAdvance.create({
    data: { userId: priya.id, eventId: wedding.id, amount: 10000, purpose: "Flowers, tea and autos for the Sangeet", status: "GIVEN", method: "CASH", givenOn: day(-1), givenById: founder.id, requestedById: founder.id, approvedById: founder.id, approvedAt: new Date() },
  });
  await db.expense.create({ data: { eventId: wedding.id, categoryId: await expCat("Miscellaneous"), description: "Marigold strings from the flower market", amount: 1850, spentOn: day(-1), paidVia: "CASH_ADVANCE", cashAdvanceId: priyaCash.id, receiptFileId: await bill("flower-market-bill.jpg", priya.id), status: "APPROVED", submittedById: priya.id, decidedById: founder.id, decidedAt: new Date() } });
  const teaExp = await db.expense.create({ data: { eventId: wedding.id, categoryId: await expCat("Transport"), description: "Autos for the crew to Rambagh", amount: 640, spentOn: day(0), paidVia: "CASH_ADVANCE", cashAdvanceId: priyaCash.id, receiptFileId: await bill("auto-receipts.jpg", priya.id), submittedById: priya.id } });
  await db.approvalRequest.create({ data: { type: "EXPENSE", entityId: teaExp.id, eventId: wedding.id, amount: 640, summary: "Priya Sharma · Autos for the crew to Rambagh · Aditi & Karan", requestedById: priya.id } });
  const rameshOld = await db.cashAdvance.create({
    data: { userId: ramesh.id, amount: 3000, purpose: "Office supplies and site tea", status: "GIVEN", method: "UPI", reference: "UPI-482113", givenOn: day(-14), givenById: kavita.id, requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date() },
  });
  await db.expense.create({ data: { categoryId: await expCat("Miscellaneous"), description: "Gaffer tape, cable ties and markers", amount: 2200, spentOn: day(-13), paidVia: "CASH_ADVANCE", cashAdvanceId: rameshOld.id, receiptFileId: await bill("hardware-bill.jpg", ramesh.id), status: "APPROVED", submittedById: ramesh.id, decidedById: cofounder.id, decidedAt: new Date() } });
  await db.cashAdvance.update({ where: { id: rameshOld.id }, data: { status: "CLOSED", returnedAmount: 800, settledAt: new Date(), closedById: kavita.id } });
  const rameshNew = await db.cashAdvance.create({ data: { userId: ramesh.id, eventId: wedding.id, amount: 5000, purpose: "Generator diesel and tea on the wedding night", requestedById: kavita.id } });
  await db.approvalRequest.create({ data: { type: "CASH_ADVANCE", entityId: rameshNew.id, eventId: wedding.id, amount: 5000, summary: "Cash advance for Ramesh Kumar: Generator diesel and tea on the wedding night · Aditi & Karan", requestedById: kavita.id } });

  // ── Booking 2: Kabir's 1st birthday, today ──
  const bday = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Kabir's 1st Birthday", categoryId: await cat("Birthday"), clientId: arora.id, status: "LIVE",
      startDate: day(0), endDate: day(0), expectedGuests: 80, description: "Jungle theme. Cake from the family.", createdById: priya.id,
      members: { create: [{ userId: aman.id, role: "MANAGER" }] },
    },
  });
  const bdayFn = await fn(bday.id, "Birthday party", 0, "17:00", "22:00", marigold.id, 80, 1);
  const bdayDecor = await assign(bday.id, gulmohar.id, "Decoration", "Jungle theme decor", "IN_PROGRESS", [bdayFn.id], 38000);
  const bdayDecorQ = await quote(bdayDecor.id, gulmohar.id, 1, 38000, "APPROVED", "Jungle theme decor", founder.id);
  await workOrder(bdayDecor.id, bdayDecorQ.id, 38000);
  await crewFor(bday.id, "Vikas Jangid", "Decor help", 700, [{ functionId: bdayFn.id, offset: 0, report: "12:00", attendance: "PRESENT" }]);
  await crewFor(bday.id, "Kailash Bairwa", "Serving", 800, [{ functionId: bdayFn.id, offset: 0, report: "16:00" }]);
  await db.task.create({ data: { eventId: bday.id, title: "Balloons and jungle props pick-up", priority: "MEDIUM", status: "UNDER_REVIEW", dueAt: at(0, "12:00"), assigneeId: aman.id, createdById: aman.id } });
  await db.clientCharge.create({ data: { eventId: bday.id, clientId: arora.id, description: "Birthday package", amount: 160000, gstRate: 18, createdById: founder.id } });
  await db.payment.create({ data: { direction: "IN", eventId: bday.id, partyType: "CLIENT", clientId: arora.id, amount: 80000, method: "UPI", paidOn: day(-6), status: "PAID", requestedById: kavita.id, approvedById: cofounder.id, approvedAt: new Date(), paidById: kavita.id } });

  // ── Booking 3: pre-wedding shoot ──
  const shoot = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Neha & Vivek pre-wedding shoot", categoryId: await cat("Pre-wedding"), clientId: jain.id, status: "CONFIRMED",
      startDate: day(2), endDate: day(2), expectedGuests: 4, createdById: priya.id, members: { create: [{ userId: priya.id, role: "MANAGER" }] },
    },
  });
  const shootFn = await fn(shoot.id, "Sunrise shoot", 2, "06:00", "11:00", nahargarh.id, 4, 1);
  await assign(shoot.id, frameStory.id, "Photography & video", "Pre-wedding shoot, one day", "ACCEPTED", [shootFn.id], 45000);
  await crewFor(shoot.id, "Raju Gurjar", "Drive the crew", 1000, [{ functionId: shootFn.id, offset: 2, report: "04:30" }]);
  await db.task.create({ data: { eventId: shoot.id, title: "Fort shoot permission letter", priority: "URGENT", status: "DELAYED", dueAt: at(-1, "17:00"), assigneeId: priya.id, createdById: priya.id } });
  await db.clientCharge.create({ data: { eventId: shoot.id, clientId: jain.id, description: "Pre-wedding shoot package", amount: 95000, gstRate: 18, createdById: founder.id } });
  await db.payment.create({ data: { direction: "IN", eventId: shoot.id, partyType: "CLIENT", clientId: jain.id, amount: 95000, method: "UPI", paidOn: day(-5), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });

  // ── Booking 4: tentative anniversary ──
  const anniv = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Sharma Anniversary Dinner", categoryId: await cat("Anniversary"), clientId: sharma.id, status: "TENTATIVE",
      startDate: day(17), endDate: day(17), expectedGuests: 60, createdById: priya.id, members: { create: [{ userId: priya.id, role: "MANAGER" }] },
    },
  });
  await db.eventFunction.create({ data: { eventId: anniv.id, name: "Anniversary dinner", date: day(17), startsAt: at(17, "20:00"), venueText: "To be decided", expectedGuests: 60 } });
  await db.task.create({ data: { eventId: anniv.id, title: "Shortlist venues for Sharma ji", priority: "LOW", status: "PENDING", dueAt: at(2, "18:00"), assigneeId: priya.id, createdById: priya.id } });

  // ── Booking 5: settled engagement ──
  const engagement = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Mittal Engagement", categoryId: await cat("Engagement"), clientId: mittal.id, status: "COMPLETED",
      startDate: day(-12), endDate: day(-12), expectedGuests: 200, createdById: founder.id, members: { create: [{ userId: aman.id, role: "MANAGER" }] },
    },
  });
  const engFn = await fn(engagement.id, "Ring ceremony", -12, "19:00", "23:30", fairmont.id, 200, 1);
  const engDecor = await assign(engagement.id, gulmohar.id, "Decoration", "Ring ceremony stage", "COMPLETED", [engFn.id], 85000);
  const engDecorQ = await quote(engDecor.id, gulmohar.id, 1, 85000, "APPROVED", "Ring ceremony stage", founder.id);
  await workOrder(engDecor.id, engDecorQ.id, 85000);
  await db.clientCharge.create({ data: { eventId: engagement.id, clientId: mittal.id, description: "Engagement package", amount: 520000, gstRate: 18, createdById: founder.id } });
  await db.payment.create({ data: { direction: "IN", eventId: engagement.id, partyType: "CLIENT", clientId: mittal.id, amount: 613600, method: "BANK", paidOn: day(-11), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });
  await db.payment.create({ data: { direction: "OUT", eventId: engagement.id, partyType: "VENDOR", vendorId: gulmohar.id, amount: 85000, method: "BANK", paidOn: day(-10), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });
  // Settled last: a settled booking's money is locked (database triggers).
  await db.event.update({
    where: { id: engagement.id },
    data: { status: "SETTLED", settledAt: new Date(), settledById: founder.id, settlementSnapshot: { billed: 520000, gst: 93600, received: 613600, vendorCost: 85000, crewCost: 0, expenseCost: 0, paidOut: 85000, margin: 435000, note: null } },
  });

  // ── Booking 6: corporate Diwali night ──
  const diwali = await db.event.create({
    data: {
      code: await nextCode("EVT", year, "EVT"), name: "Infotech Diwali Night", categoryId: await cat("Corporate"), clientId: infotech.id, status: "COMPLETED",
      startDate: day(-20), endDate: day(-20), expectedGuests: 300, createdById: founder.id, members: { create: [{ userId: aman.id, role: "MANAGER" }] },
    },
  });
  await fn(diwali.id, "Diwali night", -20, "19:30", "23:30", fairmont.id, 300, 1);
  await db.clientCharge.create({ data: { eventId: diwali.id, clientId: infotech.id, description: "Corporate Diwali night", amount: 640000, gstRate: 18, createdById: founder.id } });
  await db.payment.create({ data: { direction: "IN", eventId: diwali.id, partyType: "CLIENT", clientId: infotech.id, amount: 400000, method: "BANK", paidOn: day(-18), status: "PAID", requestedById: kavita.id, approvedById: founder.id, approvedAt: new Date(), paidById: kavita.id } });

  // Announcement, notifications and an audit trail so the screens are not empty
  await db.announcement.create({ data: { audience: "BOOKING_CREW", eventId: wedding.id, title: "Sangeet: report at gate 2", body: "Crew please report at gate 2 behind the parking by 17:30. Wear the black T-shirt.", needsAck: true, createdById: ramesh.id } });
  await db.notification.createMany({
    data: [
      { userId: founder.id, type: "approval.requested", title: "Payment waiting: Annapurna Caterers ₹1,20,000", link: "/approvals" },
      { userId: founder.id, type: "approval.requested", title: "Quote waiting: Roshni Lights ₹40,000", link: "/approvals" },
      { userId: ramesh.id, type: "proof.submitted", title: "New proof: Entrance garlands from Sunil Yadav", link: "/event-day" },
      { userId: sunilUser.id, type: "shift.reminder", title: "Report at Rambagh Gardens, gate 2 by 17:30", link: "/crew" },
      { userId: roshniUser.id, type: "quote.message", title: "Priya asked about 4 extra uplighters", link: "/vendor" },
    ],
  });
  await db.auditLog.createMany({
    data: [
      { actorId: founder.id, action: "create", entityType: "event", entityId: wedding.id, summary: "Created booking Aditi & Karan (Wedding)" },
      { actorId: founder.id, action: "approve", entityType: "quotation", entityId: decorQ.id, summary: "Approved Gulmohar Decor quote ₹4,20,000", financial: true },
      { actorId: kavita.id, action: "create", entityType: "payment", entityId: pendingPayment.id, summary: "Prepared payment ₹1,20,000 to Annapurna Caterers", financial: true },
    ],
  });

  console.log(`Demo data added. Log in with any demo account, password "${DEMO_PASSWORD}":`);
  for (const u of [founder, cofounder, priya, aman, kavita, ramesh, roshniUser, gulmoharUser, sunilUser, arjunUser]) {
    console.log(`  ${u.name.padEnd(16)} ${u.phoneNumber}${u.hasRealEmail ? `  ${u.email}` : ""}`);
  }
}

async function main() {
  await seedReference();
  console.log("Reference data ready (roles, permissions, lists).");
  if (process.env.SEED_DEMO !== "false" && process.env.NODE_ENV !== "production") await seedDemo();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
