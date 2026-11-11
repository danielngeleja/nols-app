-- Admin inbox lifecycle (apps/api/src/lib/adminNotificationKinds.ts).
--
-- Admin alerts were deletable by any admin, and a platform alert is one shared
-- row, so one click removed it for everyone. Admins can no longer delete; a
-- read and resolved alert is cleared automatically 7 days after it was
-- resolved, and unread or unresolved alerts are never deleted.
--
--   readById        who first read it
--   requiresAction  the alert asks someone to act (set from its kind)
--   resolvedAt/By   when and by whom that action was done; information-only
--                   alerts are resolved when they are read
--
-- Additive: nullable columns and a boolean defaulting to 0. Existing rows are
-- classified by their kind (meta.notificationKind) in code when read, resolved
-- or considered for clean-up, so an older alert that asks for action is never
-- cleared without being resolved. Valid on MySQL 8 (staging) and MariaDB 11.8
-- (prod).

ALTER TABLE `notification`
  ADD COLUMN `readById` INT NULL AFTER `readAt`,
  ADD COLUMN `requiresAction` BOOLEAN NOT NULL DEFAULT false AFTER `readById`,
  ADD COLUMN `resolvedAt` DATETIME(3) NULL AFTER `requiresAction`,
  ADD COLUMN `resolvedById` INT NULL AFTER `resolvedAt`;

CREATE INDEX `notification_resolvedAt_idx` ON `notification`(`resolvedAt`);
