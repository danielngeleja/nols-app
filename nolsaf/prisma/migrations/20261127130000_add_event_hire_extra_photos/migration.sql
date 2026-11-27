-- Event hire photos uploaded on the add-on itself (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md):
-- kept off the listing so a live listing is never sent back for review.
-- Prepared 2026-11-27. NOT APPLIED. Apply only with Daniel's approval.
-- One nullable JSON column on property_event_hire; runs on both MySQL 8
-- (staging/dev) and MariaDB 11.8 (prod).

ALTER TABLE `property_event_hire` ADD COLUMN `extraPhotos` JSON NULL;
