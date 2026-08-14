-- DRAFT migration, hand-written for review. NOT YET APPLIED — verify with
-- `npx prisma migrate status` from the nolsaf/ directory before assuming
-- otherwise. (The previous migration, 20260808120000_add_disbursement_batching,
-- carried a header claiming it was unapplied when in fact it had already been
-- applied to the Railway dev database. Do not trust these headers; check.)
--
-- Written by hand for the same reason as the previous two disbursement
-- migrations: the shadow database diff still fails on a pre-existing,
-- unrelated migration (20260714130000_reconcile_legacy_database_drift uses
-- `DROP FOREIGN KEY IF EXISTS`, which this MySQL version rejects), which
-- blocks Prisma's automatic diff tooling for any new migration.
--
-- Hardening pass over the batch security architecture, per the security review
-- of docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md "Batch security architecture":
--
--   * activeSourceKey + unique index — makes "one live payout per source" a
--     database guarantee instead of a read-then-write check that two
--     concurrent requests can both pass.
--   * payout_account.destinationChangedAt / lastVerifiedAt — separates the
--     "when did this destination change" anchor that risk scoring reads from
--     the "when did a batch last re-verify it" timestamp that routine
--     re-verification writes. They used to be the same column, so every batch
--     run silently degraded the account-takeover signal.
--   * disbursement_batch.processingStartedAt / completedAt — lets an
--     interrupted release be detected and resumed instead of stranding money
--     in a batch stuck at PROCESSING.
--   * batchId FK becomes RESTRICT — orphaning a BATCHED/AUTHORIZED payout
--     would hide it from every batch view while leaving it submittable.
--   * CHECK constraints pin both status columns to their known state
--     machines, so a typo can never create an unreachable money record.

-- AlterTable
ALTER TABLE `disbursement`
    ADD COLUMN `activeSourceKey` VARCHAR(60) NULL;

-- AlterTable
ALTER TABLE `payout_account`
    ADD COLUMN `lastVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `destinationChangedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `disbursement_batch`
    ADD COLUMN `processingStartedAt` DATETIME(3) NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL;

-- Backfill destinationChangedAt for accounts that predate the column. The
-- account's own creation is the earliest point its destination can be known
-- to have been set, so it is the correct conservative anchor.
UPDATE `payout_account` SET `destinationChangedAt` = `createdAt` WHERE `destinationChangedAt` IS NULL;

-- Backfill activeSourceKey. FAILED rows keep NULL so a fresh attempt against
-- the same source is still allowed.
--
-- If the unique index below fails with a duplicate-key error, that is not a
-- migration bug: it means two live disbursements already exist for one source
-- (the exact double-payment the constraint prevents). Resolve those rows
-- first, then re-run. Query to find them:
--   SELECT sourceType, sourceId, COUNT(*) c, GROUP_CONCAT(id) ids
--   FROM disbursement WHERE status <> 'FAILED'
--   GROUP BY sourceType, sourceId HAVING c > 1;
UPDATE `disbursement`
   SET `activeSourceKey` = CONCAT(`sourceType`, ':', `sourceId`)
 WHERE `status` <> 'FAILED';

-- CreateIndex
CREATE UNIQUE INDEX `disbursement_activeSourceKey_key` ON `disbursement`(`activeSourceKey`);

-- CreateIndex
CREATE INDEX `disbursement_batch_createdAt_idx` ON `disbursement_batch`(`createdAt`);

-- Replace the batchId foreign key so deleting a batch can no longer orphan
-- payouts that are mid-flight inside it.
ALTER TABLE `disbursement` DROP FOREIGN KEY `disbursement_batchId_fkey`;
ALTER TABLE `disbursement` ADD CONSTRAINT `disbursement_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `disbursement_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pin both status columns to their known state machines. Prisma models these
-- as VarChar (it has no enum support that round-trips cleanly here), so the
-- database is the only place this can be enforced. Adding a new state is a
-- deliberate migration, which is the right cost for a money state machine.
ALTER TABLE `disbursement` ADD CONSTRAINT `disbursement_status_check` CHECK (`status` IN (
    'REQUESTED', 'APPROVED', 'BATCHED', 'AUTHORIZED', 'SUBMITTED', 'PROCESSING',
    'PAID', 'FAILED', 'SECURITY_REVIEW', 'RECOVERY_PENDING', 'RECOVERED'
));

ALTER TABLE `disbursement_batch` ADD CONSTRAINT `disbursement_batch_status_check` CHECK (`status` IN (
    'DRAFT', 'AUTHORIZED', 'PROCESSING', 'COMPLETED', 'SECURITY_REVIEW'
));
