-- Trust and verification: corporate identity records and authorised channels.
--
-- This backs the public /verify page, which exists so a bank, regulator, or
-- traveller can confirm they are dealing with the real company. It is an
-- anti-impersonation surface, so the shape enforces restraint:
--
--   * `status` and `visibility` are independent. Being PUBLIC is not enough to
--     appear; the record must also be published and evidence-approved.
--   * `evidenceApprovedById` and `publishedById` name a human for every claim.
--   * `archivedAt` replaces deletion after publication, because "what did the
--     page say last week" is exactly what an investigation asks.
--
-- Expand-only. No existing table is altered and nothing is backfilled.

CREATE TABLE `company_verifications` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(80) NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `displayName` VARCHAR(160) NOT NULL,
  `authorityName` VARCHAR(160) NULL,
  `authorityDomain` VARCHAR(160) NULL,
  `jurisdiction` VARCHAR(120) NULL,
  `registrationNumber` VARCHAR(120) NULL,
  `registrationNumberNormalized` VARCHAR(120) NULL,
  `publicSummary` TEXT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  `visibility` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
  `externalVerificationUrl` VARCHAR(500) NULL,
  `issuedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `lastCheckedAt` DATETIME(3) NULL,
  `evidenceApprovedAt` DATETIME(3) NULL,
  `evidenceApprovedById` INTEGER NULL,
  `evidenceNote` VARCHAR(1000) NULL,
  `publishedAt` DATETIME(3) NULL,
  `publishedById` INTEGER NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdById` INTEGER NULL,
  `updatedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `archivedAt` DATETIME(3) NULL,

  UNIQUE INDEX `company_verifications_key_key`(`key`),
  INDEX `company_verifications_visibility_publishedAt_sortOrder_idx`(`visibility`, `publishedAt`, `sortOrder`),
  INDEX `company_verifications_status_expiresAt_idx`(`status`, `expiresAt`),
  INDEX `company_verifications_category_sortOrder_idx`(`category`, `sortOrder`),
  INDEX `company_verifications_registrationNumberNormalized_idx`(`registrationNumberNormalized`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `official_company_channels` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `channelType` VARCHAR(30) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `value` VARCHAR(500) NOT NULL,
  `href` VARCHAR(500) NULL,
  `notes` VARCHAR(500) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `confirmedById` INTEGER NULL,
  `visibility` VARCHAR(20) NOT NULL DEFAULT 'PRIVATE',
  `publishedAt` DATETIME(3) NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdById` INTEGER NULL,
  `updatedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `archivedAt` DATETIME(3) NULL,

  INDEX `official_company_channels_visibility_publishedAt_sortOrder_idx`(`visibility`, `publishedAt`, `sortOrder`),
  INDEX `official_company_channels_channelType_sortOrder_idx`(`channelType`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Approver and publisher references survive the admin account being removed:
-- the claim history must not vanish with the person who signed it off.
ALTER TABLE `company_verifications`
  ADD CONSTRAINT `company_verifications_evidenceApprovedById_fkey`
  FOREIGN KEY (`evidenceApprovedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `company_verifications`
  ADD CONSTRAINT `company_verifications_publishedById_fkey`
  FOREIGN KEY (`publishedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `official_company_channels`
  ADD CONSTRAINT `official_company_channels_confirmedById_fkey`
  FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
