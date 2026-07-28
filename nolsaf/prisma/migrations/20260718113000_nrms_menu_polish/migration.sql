-- Milestone 2 of NRMS QR ordering (docs/NRMS_QR_ORDERING.md): menu polish.
-- Guest-facing description and photo per menu item, a daily in-stock toggle
-- independent of the lifecycle status, explicit item sort order, and an
-- outlet-level category display order. Purely additive with defaults, so
-- existing items stay active and in stock with no backfill.

ALTER TABLE `nrms_menu_item`
  ADD COLUMN `description` VARCHAR(500) NULL,
  ADD COLUMN `imageUrl` VARCHAR(500) NULL,
  ADD COLUMN `inStock` TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN `sortOrder` INT NOT NULL DEFAULT 0;

ALTER TABLE `nrms_outlet`
  ADD COLUMN `categoryOrder` JSON NULL;
