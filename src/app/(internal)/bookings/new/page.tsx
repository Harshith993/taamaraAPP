import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { db } from "@/lib/db";
import { pickableClients } from "@/modules/events/service";
import { requirePermission } from "@/modules/identity/session";
import { NewBookingForm } from "./new-booking-form";

export const metadata: Metadata = { title: "New booking" };

export default async function NewBookingPage() {
  const actor = await requirePermission("bookings.create");
  const [categories, clients] = await Promise.all([
    db.eventCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    pickableClients(db, actor),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-[26px] leading-tight tracking-[-0.03em] sm:text-[30px]">New booking</h1>
          <p className="mt-1 text-[15px] text-ink-quiet">The checklist for the booking type is added automatically. You can change everything later.</p>
        </div>
        <ButtonLink href="/bookings" variant="secondary">
          ← Bookings
        </ButtonLink>
      </div>
      <NewBookingForm categories={categories} clients={clients} />
    </div>
  );
}
