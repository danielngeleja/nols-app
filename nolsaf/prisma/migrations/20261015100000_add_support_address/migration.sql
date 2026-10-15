-- Office address shown with the official support contacts (public footer, support pages).
-- Nullable: until an admin sets it, the site shows the head office default.
ALTER TABLE `systemsetting` ADD COLUMN `supportAddress` VARCHAR(160) NULL;
