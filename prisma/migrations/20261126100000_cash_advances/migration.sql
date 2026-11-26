-- CreateEnum
CREATE TYPE "CashAdvanceStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'GIVEN', 'CLOSED', 'REJECTED', 'VOIDED');

-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'CASH_ADVANCE';

-- AlterTable
ALTER TABLE "cash_advances" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "givenById" TEXT,
ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "returnedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "status" "CashAdvanceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT,
ALTER COLUMN "givenOn" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "cash_advances_userId_status_idx" ON "cash_advances"("userId", "status");

-- CreateIndex
CREATE INDEX "cash_advances_eventId_idx" ON "cash_advances"("eventId");


-- ───────────── Cash advances are a money ledger (D57) ─────────────
-- Never deleted; voided only with a reason; a voided or closed advance can't change; the amount is
-- fixed once the cash is handed over; nothing changes on a settled booking.
CREATE OR REPLACE FUNCTION taamara_guard_cash_advances() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash advances are never deleted; void the advance with a reason instead';
  END IF;
  IF OLD."status" IN ('VOIDED', 'CLOSED', 'REJECTED') THEN
    RAISE EXCEPTION 'A closed, rejected or voided cash advance cannot be changed';
  END IF;
  IF NEW."status" = 'VOIDED' AND (NEW."voidReason" IS NULL OR length(btrim(NEW."voidReason")) = 0) THEN
    RAISE EXCEPTION 'Voiding a cash advance needs a reason';
  END IF;
  IF OLD."status" = 'GIVEN' AND (NEW."amount" <> OLD."amount" OR NEW."userId" <> OLD."userId" OR NEW."eventId" IS DISTINCT FROM OLD."eventId") THEN
    RAISE EXCEPTION 'A cash advance that has been handed over cannot be edited; void it and give a new one';
  END IF;
  IF NEW."returnedAmount" < 0 OR NEW."returnedAmount" > NEW."amount" THEN
    RAISE EXCEPTION 'The cash returned must be between zero and the advance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_advances_guard_update BEFORE UPDATE ON "cash_advances"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_cash_advances();
CREATE TRIGGER cash_advances_guard_delete BEFORE DELETE ON "cash_advances"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_cash_advances();
CREATE TRIGGER cash_advances_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "cash_advances"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();

ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_amount_positive" CHECK ("amount" > 0);
