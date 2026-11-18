-- AlterTable
ALTER TABLE "events" ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledById" TEXT,
ADD COLUMN     "settlementSnapshot" JSONB;

-- ───────────── Settled bookings are locked (Phase 7) ─────────────
-- Once an owner settles a booking (status SETTLED), nothing can add or change its money: no new
-- charges, payments, expenses, crew extras, invoices, budgets, vendor jobs or crew bookings.
-- The app checks first with a friendly message; these triggers are the backstop. An owner can
-- reopen a settled booking (back to COMPLETED) with a reason, which the app records.

CREATE OR REPLACE FUNCTION taamara_event_is_settled(event_id text) RETURNS boolean AS $$
  SELECT event_id IS NOT NULL AND EXISTS (SELECT 1 FROM "events" WHERE "id" = event_id AND "status" = 'SETTLED');
$$ LANGUAGE sql STABLE;

-- Tables with their own "eventId" column.
CREATE OR REPLACE FUNCTION taamara_guard_settled_event_rows() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND taamara_event_is_settled(OLD."eventId") THEN
    RAISE EXCEPTION 'This booking is settled; an owner must reopen it before its money can change';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND taamara_event_is_settled(NEW."eventId") THEN
    RAISE EXCEPTION 'This booking is settled; an owner must reopen it before its money can change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER client_charges_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "client_charges"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER client_invoices_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "client_invoices"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER expenses_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER budgets_settled_guard BEFORE INSERT ON "budgets"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER vendor_assignments_settled_guard BEFORE INSERT ON "vendor_assignments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();
CREATE TRIGGER crew_assignments_settled_guard BEFORE INSERT ON "crew_assignments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_event_rows();

-- Crew extras and deductions belong to a crew booking.
CREATE OR REPLACE FUNCTION taamara_guard_settled_crew_adjustments() RETURNS trigger AS $$
DECLARE
  ev text;
BEGIN
  SELECT "eventId" INTO ev FROM "crew_assignments" WHERE "id" = COALESCE(NEW."assignmentId", OLD."assignmentId");
  IF taamara_event_is_settled(ev) THEN
    RAISE EXCEPTION 'This booking is settled; an owner must reopen it before its money can change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crew_pay_adjustments_settled_guard BEFORE INSERT OR UPDATE OR DELETE ON "crew_pay_adjustments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_crew_adjustments();

-- Vendor invoices belong to a work order, which belongs to a vendor job on a booking.
CREATE OR REPLACE FUNCTION taamara_guard_settled_vendor_invoices() RETURNS trigger AS $$
DECLARE
  ev text;
BEGIN
  SELECT a."eventId" INTO ev FROM "work_orders" w JOIN "vendor_assignments" a ON a."id" = w."assignmentId"
    WHERE w."id" = COALESCE(NEW."workOrderId", OLD."workOrderId");
  IF taamara_event_is_settled(ev) THEN
    RAISE EXCEPTION 'This booking is settled; an owner must reopen it before its money can change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_invoices_settled_guard BEFORE INSERT OR UPDATE ON "vendor_invoices"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_settled_vendor_invoices();

-- A booking is settled only with a date, and leaves SETTLED only by being reopened to COMPLETED.
CREATE OR REPLACE FUNCTION taamara_guard_event_settlement() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'SETTLED' AND NEW."settledAt" IS NULL THEN
    RAISE EXCEPTION 'A settled booking needs its settlement date';
  END IF;
  IF OLD."status" = 'SETTLED' AND NEW."status" NOT IN ('SETTLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'A settled booking can only be reopened (back to completed)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_settlement_guard BEFORE UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_event_settlement();
