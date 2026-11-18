-- Re-create the guard functions without custom SQLSTATE codes. The default code (P0001,
-- raise_exception) lets the database message reach the app unchanged, instead of being
-- reported as a generic foreign-key or check failure.

CREATE OR REPLACE FUNCTION taamara_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

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
       OR NEW."clientId" <> OLD."clientId" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate" THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited; cancel it and issue a new one';
    END IF;
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot go back to draft';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED' AND (NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) = 0) THEN
    RAISE EXCEPTION 'Cancelling an invoice needs a reason';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION taamara_guard_client_invoice_items() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT "status" INTO parent_status FROM "client_invoices"
    WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of an issued invoice cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION taamara_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are never deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION taamara_guard_expenses() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'REIMBURSED') THEN
    RAISE EXCEPTION 'An approved expense cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
