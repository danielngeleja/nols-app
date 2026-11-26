-- Sales regions and regional leads (docs/SALES_REGIONS.md).
-- Prepared 2026-11-26. NOT APPLIED. Apply only with Daniel's approval.
-- Additive only: three new tables, one nullable column on sales_partner_profile
-- and sales_team, no foreign keys. Runs on MySQL 8 (staging) and MariaDB 11.8
-- (prod). The seven regions are seeded; existing partners and teams are mapped
-- later with Auto-assign in /admin/sales/regions.

ALTER TABLE `sales_partner_profile` ADD COLUMN `regionId` INTEGER NULL;
CREATE INDEX `sales_partner_profile_regionId_idx` ON `sales_partner_profile`(`regionId`);

ALTER TABLE `sales_team` ADD COLUMN `regionId` INTEGER NULL;
CREATE INDEX `sales_team_regionId_idx` ON `sales_team`(`regionId`);

CREATE TABLE `sales_region` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(8) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `areas` JSON NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `leadPartnerId` INTEGER NULL,
    `leadSince` DATETIME(3) NULL,
    `overridePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_region_code_key`(`code`),
    UNIQUE INDEX `sales_region_leadPartnerId_key`(`leadPartnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_region_month` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `regionId` INTEGER NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `target` INTEGER NOT NULL,
    `setById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_region_month_regionId_month_key`(`regionId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_region_recommendation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `regionId` INTEGER NOT NULL,
    `leadPartnerId` INTEGER NOT NULL,
    `subjectType` VARCHAR(24) NOT NULL,
    `subjectId` INTEGER NOT NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_region_recommendation_subjectType_subjectId_key`(`subjectType`, `subjectId`),
    INDEX `sales_region_recommendation_regionId_idx`(`regionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `sales_region` (`code`, `name`, `areas`, `updatedAt`) VALUES
  ('DAR', 'Dar es Salaam', '["dar es salaam","dar","dsm"]', CURRENT_TIMESTAMP(3)),
  ('ARK', 'Arusha and Kilimanjaro', '["arusha","kilimanjaro","manyara"]', CURRENT_TIMESTAMP(3)),
  ('ZNZ', 'Zanzibar', '["zanzibar","unguja","pemba","mjini magharibi","kaskazini unguja","kusini unguja","kaskazini pemba","kusini pemba"]', CURRENT_TIMESTAMP(3)),
  ('LKE', 'Mwanza and Lake', '["mwanza","geita","kagera","mara","shinyanga","simiyu"]', CURRENT_TIMESTAMP(3)),
  ('CEN', 'Dodoma and Central', '["dodoma","singida","tabora","kigoma"]', CURRENT_TIMESTAMP(3)),
  ('SHL', 'Mbeya and Southern Highlands', '["mbeya","iringa","njombe","songwe","rukwa","katavi","ruvuma"]', CURRENT_TIMESTAMP(3)),
  ('CST', 'Coast and South', '["tanga","pwani","morogoro","mtwara","lindi"]', CURRENT_TIMESTAMP(3));
