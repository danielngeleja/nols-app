-- Sales owner confirmation (prepared 2026-11-07, NOT applied; apply only with Daniel's approval)
--
-- The property owner's own answer to "Did this sales partner bring you to
-- NoLSAF?". It is the one piece of attribution evidence a sales partner cannot
-- produce themselves.
--
-- Additive only: one new table, no change to existing tables or rows, so it is
-- safe to apply before the code that uses it is deployed. Plain CREATE TABLE /
-- ADD CONSTRAINT, valid on MySQL 8 (staging) and MariaDB 11.8 (production).
--
-- Not a public gate (enforced in code, recorded here):
--   * an answer is accepted only from the signed-in owner of the property
--     (session user = ownerUserId = current property owner), never during an
--     impersonated session;
--   * SMS / email carry an opaque reference that opens the owner portal after
--     sign-in; the reference alone confirms nothing, and only its SHA-256 hash
--     (referenceHash) is stored;
--   * activeKey holds the attribution id while PENDING and is set to NULL on
--     any outcome, so the unique index allows exactly one open request per
--     attribution (MySQL/MariaDB unique indexes accept many NULLs);
--   * answers keep evidence: who, when, keyed IP hash, user agent, session.
--
-- Rollback (only if no code depends on it yet):
--   DROP TABLE `sales_owner_confirmation`;

-- CreateTable
CREATE TABLE `sales_owner_confirmation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attributionId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `ownerUserId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `activeKey` INTEGER NULL,
    `referenceHash` CHAR(64) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notifiedAt` DATETIME(3) NULL,
    `remindedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `respondedAt` DATETIME(3) NULL,
    `respondedById` INTEGER NULL,
    `responseNote` VARCHAR(300) NULL,
    `responseIpHash` CHAR(64) NULL,
    `responseUserAgent` VARCHAR(255) NULL,
    `responseSessionId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_owner_confirmation_activeKey_key`(`activeKey`),
    UNIQUE INDEX `sales_owner_confirmation_referenceHash_key`(`referenceHash`),
    INDEX `sales_owner_confirmation_attributionId_status_idx`(`attributionId`, `status`),
    INDEX `sales_owner_confirmation_propertyId_idx`(`propertyId`),
    INDEX `sales_owner_confirmation_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_owner_confirmation_ownerUserId_status_idx`(`ownerUserId`, `status`),
    INDEX `sales_owner_confirmation_respondedById_idx`(`respondedById`),
    INDEX `sales_owner_confirmation_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_owner_confirmation` ADD CONSTRAINT `sales_owner_confirmation_attributionId_fkey` FOREIGN KEY (`attributionId`) REFERENCES `property_sales_attribution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_owner_confirmation` ADD CONSTRAINT `sales_owner_confirmation_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_owner_confirmation` ADD CONSTRAINT `sales_owner_confirmation_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_owner_confirmation` ADD CONSTRAINT `sales_owner_confirmation_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_owner_confirmation` ADD CONSTRAINT `sales_owner_confirmation_respondedById_fkey` FOREIGN KEY (`respondedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
