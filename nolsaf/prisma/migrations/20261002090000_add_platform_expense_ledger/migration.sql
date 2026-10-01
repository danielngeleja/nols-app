-- Platform expense ledger: the cost side of NoLSAF's margin.
-- Additive. Nothing existing changes; the margin report starts reading the
-- new table once the API that uses it is deployed.
--
-- platform_expense   append-only ledger of NoLSAF's own costs (gateway fees,
--                    partner bonuses, SMS, hosting, staff, marketing, other).
-- systemsetting      gatewayFeeEstimatePercent: optional rate used to estimate
--                    gateway fees for a period with no settlement entries.
--
-- Backfill: every bonus already granted (stored only as a GRANT_BONUS row in
-- the admin audit log) becomes a PARTNER_BONUS expense dated at its grant.
-- The audit details were written with JSON.stringify, so most are a JSON
-- string holding an object; both shapes are handled.

-- CreateTable
CREATE TABLE `platform_expense` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(30) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `vendor` VARCHAR(120) NULL,
    `reference` VARCHAR(120) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `incurredAt` DATETIME(3) NOT NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `stream` VARCHAR(30) NULL,
    `origin` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    `sourceKey` VARCHAR(120) NULL,
    `recordedById` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversesExpenseId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_expense_sourceKey_key`(`sourceKey`),
    INDEX `platform_expense_category_incurredAt_idx`(`category`, `incurredAt`),
    INDEX `platform_expense_incurredAt_idx`(`incurredAt`),
    INDEX `platform_expense_reversesExpenseId_idx`(`reversesExpenseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `gatewayFeeEstimatePercent` DECIMAL(5, 2) NULL;

-- Backfill granted bonuses from the admin audit log
INSERT INTO `platform_expense`
    (`category`, `description`, `amount`, `currency`, `incurredAt`, `origin`, `sourceKey`, `recordedById`, `note`, `createdAt`)
SELECT
    'PARTNER_BONUS',
    IF(JSON_EXTRACT(a.j, '$.driverId') IS NOT NULL, 'Bonus granted to a driver', 'Bonus granted to an owner'),
    CAST(JSON_UNQUOTE(JSON_EXTRACT(a.j, '$.bonusAmount')) AS DECIMAL(14, 2)),
    'TZS',
    a.createdAt,
    'SYSTEM',
    CONCAT('BONUS-AUDIT:', a.id),
    a.adminId,
    LEFT(CONCAT('Backfilled from the admin audit log', IFNULL(CONCAT(', ref ', JSON_UNQUOTE(JSON_EXTRACT(a.j, '$.bonusPaymentRef'))), '')), 500),
    CURRENT_TIMESTAMP(3)
FROM (
    SELECT
        `id`,
        `adminId`,
        `createdAt`,
        CASE WHEN JSON_TYPE(`details`) = 'STRING' THEN CAST(JSON_UNQUOTE(`details`) AS JSON) ELSE `details` END AS j
    FROM `adminaudit`
    WHERE `action` = 'GRANT_BONUS'
      AND `details` IS NOT NULL
      AND JSON_VALID(`details`)
) AS a
WHERE JSON_TYPE(a.j) = 'OBJECT'
  AND JSON_EXTRACT(a.j, '$.bonusAmount') IS NOT NULL
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(a.j, '$.bonusAmount')) AS DECIMAL(14, 2)) > 0;
