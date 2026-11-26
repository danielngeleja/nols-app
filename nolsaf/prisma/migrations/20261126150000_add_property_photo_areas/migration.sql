-- Which area of the home each listing photo shows (kitchen, bedroom, ...),
-- used to build the public photo tour sections. Map of photo URL -> area key,
-- validated by apps/api/src/lib/photoAreas.ts.
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Additive, nullable, no default: runs on both MySQL 8 (staging) and
-- MariaDB 11.8 (prod). Apply BEFORE deploying the API that reads it, since
-- Prisma selects every Property column by default.

ALTER TABLE `property` ADD COLUMN `photoAreas` JSON NULL;
