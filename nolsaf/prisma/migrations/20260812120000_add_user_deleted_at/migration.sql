-- Soft-delete marker for user accounts. NULL = active; set = owner-deleted.
-- The row is retained so financial, booking, fraud-prevention, and statutory
-- records keep valid foreign keys; PII is anonymised in the same transaction
-- by the DELETE /account handler.
ALTER TABLE `user`
  ADD COLUMN `deletedAt` DATETIME(3) NULL;

CREATE INDEX `user_deletedAt_idx` ON `user`(`deletedAt`);
