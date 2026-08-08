-- DRAFT migration, hand-written for review. NOT applied to any database yet.
--
-- Written by hand instead of via `prisma migrate dev` because the shadow
-- database diff still fails on a pre-existing, unrelated migration
-- (20260714130000_reconcile_legacy_database_drift uses `DROP FOREIGN KEY IF
-- EXISTS`, which this MySQL version rejects). That failure blocks Prisma's
-- automatic diff tooling for any new migration until it is fixed
-- separately; it is not caused by and does not affect the changes below.
-- Same reason the previous migration (20260807180000_add_azampay_disbursement)
-- was hand-written.
--
-- Adds the post-approval batch security architecture described in
-- docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md "Batch security architecture":
-- approval + batch fingerprints, risk scoring, and a DisbursementBatch that
-- groups re-verified, fingerprint-locked payouts for a single deliberate
-- release. New Disbursement lifecycle:
--   REQUESTED -> APPROVED -> BATCHED -> AUTHORIZED -> PROCESSING -> PAID/FAILED
-- with a SECURITY_REVIEW off-ramp.

-- AlterTable
ALTER TABLE `disbursement`
    ADD COLUMN `approvalFingerprint` VARCHAR(64) NULL,
    ADD COLUMN `riskLevel` VARCHAR(10) NULL,
    ADD COLUMN `riskFlags` JSON NULL,
    ADD COLUMN `securityReviewReason` VARCHAR(300) NULL,
    ADD COLUMN `batchId` INTEGER NULL;

-- CreateTable
CREATE TABLE `disbursement_batch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchReference` VARCHAR(40) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `totalAmount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `itemCount` INTEGER NOT NULL,
    `batchFingerprint` VARCHAR(64) NOT NULL,
    `formedById` INTEGER NULL,
    `authorizedById` INTEGER NULL,
    `authorizedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `disbursement_batch_batchReference_key`(`batchReference`),
    INDEX `disbursement_batch_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `disbursement_batchId_idx` ON `disbursement`(`batchId`);

-- AddForeignKey
ALTER TABLE `disbursement` ADD CONSTRAINT `disbursement_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `disbursement_batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement_batch` ADD CONSTRAINT `disbursement_batch_formedById_fkey` FOREIGN KEY (`formedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement_batch` ADD CONSTRAINT `disbursement_batch_authorizedById_fkey` FOREIGN KEY (`authorizedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
