-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('RESERVED', 'OUT', 'RETURNED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InventoryCondition" ADD VALUE 'WORN';

-- AlterTable
ALTER TABLE "inventory_allocations" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "fromDate" DATE,
ADD COLUMN     "outById" TEXT,
ADD COLUMN     "outNote" TEXT,
ADD COLUMN     "quantityMissing" INTEGER,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "returnedById" TEXT,
ADD COLUMN     "status" "AllocationStatus" NOT NULL DEFAULT 'RESERVED',
ADD COLUMN     "toDate" DATE,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "inventory_allocations_itemId_status_idx" ON "inventory_allocations"("itemId", "status");

-- CreateIndex
CREATE INDEX "inventory_items_name_idx" ON "inventory_items"("name");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_ok" CHECK ("quantityOwned" >= 0);
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_quantity_ok" CHECK ("quantity" > 0);
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_dates_ok" CHECK ("fromDate" IS NULL OR "toDate" IS NULL OR "toDate" >= "fromDate");
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_return_adds_up" CHECK (
  "status" <> 'RETURNED' OR coalesce("quantityReturned", 0) + coalesce("quantityDamaged", 0) + coalesce("quantityMissing", 0) = "quantity"
);

-- The history of what went where is kept: bookings of equipment are cancelled, never deleted.
CREATE TRIGGER inventory_allocations_no_delete BEFORE DELETE ON "inventory_allocations"
  FOR EACH ROW EXECUTE FUNCTION taamara_no_delete();

-- D58: hosts and managers keep the register; managers and supervisors book equipment out to their
-- bookings and check it out and back in.
INSERT INTO "role_permissions" ("roleId", "permission", "scope")
SELECT r."id", g.permission, g.scope::"PermissionScope"
FROM "roles" r
JOIN (VALUES
  ('EVENT_MANAGER', 'equipment.view', 'ALL'),
  ('EVENT_MANAGER', 'equipment.manage', 'ALL'),
  ('EVENT_MANAGER', 'equipment.book', 'ASSIGNED'),
  ('SUPERVISOR', 'equipment.book', 'ASSIGNED')
) AS g(role, permission, scope) ON g.role = r."key"
ON CONFLICT DO NOTHING;
