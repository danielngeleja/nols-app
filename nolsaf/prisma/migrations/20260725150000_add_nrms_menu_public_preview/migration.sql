-- Public, read-only preview of a property's live NRMS restaurant/bar menu.
-- Reuses the existing QR order-point mechanism (nrms_order_point.token IS
-- the capability) instead of building a new page: a property that opts in
-- gets one extra order point of type PREVIEW, orderingEnabled = false, that
-- its public listing page links to. Purely additive, defaults preserve
-- current behaviour for every existing row.

ALTER TABLE `nrms_order_point`
  ADD COLUMN `orderingEnabled` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `property`
  ADD COLUMN `nrmsMenuPublic` BOOLEAN NOT NULL DEFAULT false;
