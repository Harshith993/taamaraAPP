-- AlterTable
ALTER TABLE "vendor_bank_details" ADD COLUMN     "changedByVendorAt" TIMESTAMP(3),
ADD COLUMN     "needsCheck" BOOLEAN NOT NULL DEFAULT false;
