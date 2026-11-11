-- How the sales partner first reached the property owner, as the owner says
-- when confirming them: FACE_TO_FACE, PHONE_CALL, WHATSAPP, INSTAGRAM,
-- FACEBOOK, TIKTOK, REFERRAL, EVENT, OTHER. Asked only with a "yes"; NULL on
-- every earlier answer and on "no" answers.
--
-- Additive and nullable: no backfill, no lock beyond the ALTER itself. Valid on
-- MySQL 8 (staging) and MariaDB 11.8 (prod).

ALTER TABLE `sales_owner_confirmation`
  ADD COLUMN `contactChannel` VARCHAR(30) NULL AFTER `responseNote`;
