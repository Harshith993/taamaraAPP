-- AlterTable
ALTER TABLE "client_invoice_items" ADD COLUMN     "chargeId" TEXT;

-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "recipient" JSONB,
ADD COLUMN     "supplier" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tdsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "client_invoice_items" ADD CONSTRAINT "client_invoice_items_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "client_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "client_invoice_items_chargeId_idx" ON "client_invoice_items"("chargeId");
ALTER TABLE "payments" ADD CONSTRAINT "payments_tds_not_negative" CHECK ("tdsAmount" >= 0);

-- Issued invoices keep the seller and buyer details and the place of supply they were issued with.
CREATE OR REPLACE FUNCTION taamara_guard_client_invoices() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."subtotal" <> OLD."subtotal" OR NEW."cgst" <> OLD."cgst" OR NEW."sgst" <> OLD."sgst"
       OR NEW."igst" <> OLD."igst" OR NEW."total" <> OLD."total"
       OR NEW."clientId" <> OLD."clientId" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
       OR NEW."placeOfSupply" IS DISTINCT FROM OLD."placeOfSupply"
       OR NEW."supplier"::text IS DISTINCT FROM OLD."supplier"::text
       OR NEW."recipient"::text IS DISTINCT FROM OLD."recipient"::text
       OR NEW."eventId" <> OLD."eventId" OR NEW."type" <> OLD."type" THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited; cancel it and issue a new one';
    END IF;
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot go back to draft';
    END IF;
    IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
      RAISE EXCEPTION 'A cancelled invoice stays cancelled';
    END IF;
  END IF;
  IF NEW."status" <> 'DRAFT' AND (NEW."number" IS NULL OR NEW."issueDate" IS NULL) THEN
    RAISE EXCEPTION 'An issued invoice needs its number and date';
  END IF;
  IF NEW."status" = 'CANCELLED' AND (NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) = 0) THEN
    RAISE EXCEPTION 'Cancelling an invoice needs a reason';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A paid receipt's TDS can't change either (same rule as its amount).
CREATE OR REPLACE FUNCTION taamara_guard_payments() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted; void the payment with a reason instead';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided payment cannot be changed';
  END IF;
  IF NEW."status" = 'VOIDED' AND (NEW."voidReason" IS NULL OR length(btrim(NEW."voidReason")) = 0) THEN
    RAISE EXCEPTION 'Voiding a payment needs a reason';
  END IF;
  IF OLD."status" = 'PAID' THEN
    IF NEW."status" NOT IN ('PAID', 'VOIDED') THEN
      RAISE EXCEPTION 'A paid payment can only be voided';
    END IF;
    IF NEW."amount" <> OLD."amount"
       OR NEW."tdsAmount" <> OLD."tdsAmount"
       OR NEW."direction" <> OLD."direction"
       OR NEW."partyType" <> OLD."partyType"
       OR NEW."method" <> OLD."method"
       OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
       OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
       OR NEW."workerId" IS DISTINCT FROM OLD."workerId"
       OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
       OR NEW."paidOn" IS DISTINCT FROM OLD."paidOn" THEN
      RAISE EXCEPTION 'A paid payment cannot be edited; void it and record a new one';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
