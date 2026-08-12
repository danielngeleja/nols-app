-- Classified close snapshot: sales by tender, folio postings and unpaid orders
-- exactly as the attendee reviewed them before handover, frozen at close.
ALTER TABLE `nrms_cashier_shift`
  ADD COLUMN `closeSummary` JSON NULL;
