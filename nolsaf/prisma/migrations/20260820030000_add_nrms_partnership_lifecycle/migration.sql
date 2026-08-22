-- Extend the established NRMS agent link into a bilateral partnership record.
-- Existing statuses are deliberately preserved so deployed hotel/agent screens,
-- rates, bookings, and vouchers keep working during rollout.
ALTER TABLE `nrms_agent_property_link`
  ADD COLUMN `initiatedBy` VARCHAR(20) NOT NULL DEFAULT 'HOTEL',
  ADD COLUMN `requestedByUserId` INTEGER NULL,
  ADD COLUMN `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `hotelConsentStatus` VARCHAR(20) NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN `hotelConsentedByUserId` INTEGER NULL,
  ADD COLUMN `hotelConsentedAt` DATETIME(3) NULL,
  ADD COLUMN `agentConsentStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `agentConsentedByUserId` INTEGER NULL,
  ADD COLUMN `agentConsentedAt` DATETIME(3) NULL,
  ADD COLUMN `activatedAt` DATETIME(3) NULL,
  ADD COLUMN `suspendedAt` DATETIME(3) NULL,
  ADD COLUMN `terminatedAt` DATETIME(3) NULL,
  ADD COLUMN `terminationReason` VARCHAR(300) NULL;

-- Historical links were initiated by hotels. Reconstruct only facts that are
-- provable from the established lifecycle and retain the original status.
UPDATE `nrms_agent_property_link`
SET
  `requestedAt` = `createdAt`,
  `hotelConsentedAt` = `createdAt`,
  `agentConsentStatus` = CASE
    WHEN `status` IN ('AGENT_ACCEPTED', 'ACTIVE', 'SUSPENDED') THEN 'ACCEPTED'
    WHEN `status` = 'REJECTED' THEN 'DECLINED'
    ELSE 'PENDING'
  END,
  `agentConsentedAt` = CASE
    WHEN `status` IN ('AGENT_ACCEPTED', 'ACTIVE', 'SUSPENDED') THEN COALESCE(`decidedAt`, `updatedAt`)
    ELSE NULL
  END,
  `activatedAt` = CASE WHEN `status` = 'ACTIVE' THEN COALESCE(`decidedAt`, `updatedAt`) ELSE NULL END,
  `suspendedAt` = CASE WHEN `status` = 'SUSPENDED' THEN COALESCE(`decidedAt`, `updatedAt`) ELSE NULL END;

CREATE INDEX `nrms_agent_property_link_initiatedBy_status_idx`
  ON `nrms_agent_property_link`(`initiatedBy`, `status`);
