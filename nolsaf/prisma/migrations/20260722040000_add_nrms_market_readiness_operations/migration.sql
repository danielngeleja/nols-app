-- NRMS market-readiness operations outside OTA, Open API and accounting.

CREATE TABLE `nrms_rate_plan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `roomTypeId` INTEGER NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `adjustmentType` VARCHAR(20) NOT NULL DEFAULT 'BASE',
  `adjustment` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `mealPlan` VARCHAR(30) NOT NULL DEFAULT 'ROOM_ONLY',
  `refundable` BOOLEAN NOT NULL DEFAULT true,
  `cancellationPolicy` JSON NULL,
  `taxPolicy` JSON NULL,
  `feePolicy` JSON NULL,
  `occupancyPolicy` JSON NULL,
  `minAdvanceDays` INTEGER NULL,
  `maxAdvanceDays` INTEGER NULL,
  `defaultMinStay` INTEGER NOT NULL DEFAULT 1,
  `defaultMaxStay` INTEGER NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `channelPolicy` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_rate_plan_propertyId_code_key` (`propertyId`, `code`),
  INDEX `nrms_rate_plan_propertyId_status_idx` (`propertyId`, `status`),
  INDEX `nrms_rate_plan_roomTypeId_status_idx` (`roomTypeId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_rate_season` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ratePlanId` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `startDate` DATE NOT NULL,
  `endDate` DATE NOT NULL,
  `daysOfWeek` JSON NULL,
  `adjustmentType` VARCHAR(20) NOT NULL DEFAULT 'OFFSET',
  `adjustment` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `minStay` INTEGER NULL,
  `maxStay` INTEGER NULL,
  `closedToArrival` BOOLEAN NOT NULL DEFAULT false,
  `closedToDeparture` BOOLEAN NOT NULL DEFAULT false,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `nrms_rate_season_ratePlanId_startDate_endDate_idx` (`ratePlanId`, `startDate`, `endDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_rate_restriction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `roomTypeId` INTEGER NULL,
  `ratePlanId` INTEGER NULL,
  `name` VARCHAR(120) NOT NULL,
  `startDate` DATE NOT NULL,
  `endDate` DATE NOT NULL,
  `daysOfWeek` JSON NULL,
  `minStay` INTEGER NULL,
  `maxStay` INTEGER NULL,
  `minAdvanceDays` INTEGER NULL,
  `maxAdvanceDays` INTEGER NULL,
  `stopSell` BOOLEAN NOT NULL DEFAULT false,
  `closedToArrival` BOOLEAN NOT NULL DEFAULT false,
  `closedToDeparture` BOOLEAN NOT NULL DEFAULT false,
  `channelCode` VARCHAR(40) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `nrms_rate_restriction_propertyId_startDate_endDate_idx` (`propertyId`, `startDate`, `endDate`),
  INDEX `nrms_rate_restriction_roomTypeId_status_idx` (`roomTypeId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_onboarding_run` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  `source` VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  `currentStep` VARCHAR(40) NOT NULL DEFAULT 'PROPERTY',
  `importedSnapshot` JSON NULL,
  `validationResult` JSON NULL,
  `rollbackSnapshot` JSON NULL,
  `completedAt` DATETIME(3) NULL,
  `rolledBackAt` DATETIME(3) NULL,
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `nrms_onboarding_run_propertyId_status_createdAt_idx` (`propertyId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_onboarding_checklist` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `runId` INTEGER NOT NULL,
  `key` VARCHAR(50) NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT true,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `evidence` JSON NULL,
  `verifiedAt` DATETIME(3) NULL,
  `updatedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_onboarding_checklist_runId_key_key` (`runId`, `key`),
  INDEX `nrms_onboarding_checklist_runId_status_idx` (`runId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_service_case` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `roomUnitId` INTEGER NULL,
  `reservationId` INTEGER NULL,
  `guestProfileId` INTEGER NULL,
  `reference` VARCHAR(40) NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'STAFF',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `title` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `assignedToId` INTEGER NULL,
  `createdById` INTEGER NULL,
  `dueAt` DATETIME(3) NULL,
  `acknowledgedAt` DATETIME(3) NULL,
  `resolvedAt` DATETIME(3) NULL,
  `resolution` VARCHAR(1000) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_service_case_reference_key` (`reference`),
  INDEX `nrms_service_case_propertyId_status_priority_createdAt_idx` (`propertyId`, `status`, `priority`, `createdAt`),
  INDEX `nrms_service_case_assignedToId_status_idx` (`assignedToId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_service_case_event` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `serviceCaseId` INTEGER NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `fromStatus` VARCHAR(20) NULL,
  `toStatus` VARCHAR(20) NULL,
  `note` VARCHAR(1000) NULL,
  `actorId` INTEGER NULL,
  `data` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `nrms_service_case_event_serviceCaseId_createdAt_idx` (`serviceCaseId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_offline_mutation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `deviceId` VARCHAR(100) NOT NULL,
  `clientMutationId` VARCHAR(100) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `targetType` VARCHAR(40) NULL,
  `targetId` INTEGER NULL,
  `baseVersion` INTEGER NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  `result` JSON NULL,
  `conflict` JSON NULL,
  `errorMessage` VARCHAR(1000) NULL,
  `processedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_offline_mutation_userId_deviceId_clientMutationId_key` (`userId`, `deviceId`, `clientMutationId`),
  INDEX `nrms_offline_mutation_propertyId_status_createdAt_idx` (`propertyId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_portfolio` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `ownerId` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `timezone` VARCHAR(80) NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_portfolio_ownerId_name_key` (`ownerId`, `name`),
  INDEX `nrms_portfolio_ownerId_status_idx` (`ownerId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_portfolio_property` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `portfolioId` INTEGER NOT NULL,
  `propertyId` INTEGER NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_portfolio_property_portfolioId_propertyId_key` (`portfolioId`, `propertyId`),
  INDEX `nrms_portfolio_property_propertyId_idx` (`propertyId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_forecast_snapshot` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `forecastDate` DATE NOT NULL,
  `horizonDays` INTEGER NOT NULL DEFAULT 30,
  `sellableNights` INTEGER NOT NULL,
  `soldNights` INTEGER NOT NULL,
  `occupancyPct` DECIMAL(7,4) NOT NULL,
  `roomRevenue` DECIMAL(14,2) NOT NULL,
  `adr` DECIMAL(12,2) NOT NULL,
  `revpar` DECIMAL(12,2) NOT NULL,
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.50,
  `inputs` JSON NULL,
  `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_forecast_snapshot_propertyId_forecastDate_horizonDays_key` (`propertyId`, `forecastDate`, `horizonDays`),
  INDEX `nrms_forecast_snapshot_propertyId_generatedAt_idx` (`propertyId`, `generatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_pricing_recommendation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `roomTypeId` INTEGER NOT NULL,
  `stayDate` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `currentRate` DECIMAL(12,2) NOT NULL,
  `recommendedRate` DECIMAL(12,2) NOT NULL,
  `floorRate` DECIMAL(12,2) NULL,
  `ceilingRate` DECIMAL(12,2) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `factors` JSON NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `appliedAt` DATETIME(3) NULL,
  `dismissedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_pricing_recommendation_roomTypeId_stayDate_key` (`roomTypeId`, `stayDate`),
  INDEX `nrms_pricing_recommendation_propertyId_status_stayDate_idx` (`propertyId`, `status`, `stayDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_loyalty_account` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `guestProfileId` INTEGER NOT NULL,
  `tier` VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
  `pointsBalance` INTEGER NOT NULL DEFAULT 0,
  `lifetimePoints` INTEGER NOT NULL DEFAULT 0,
  `lifetimeStays` INTEGER NOT NULL DEFAULT 0,
  `lifetimeSpend` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `lastStayAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_loyalty_account_propertyId_guestProfileId_key` (`propertyId`, `guestProfileId`),
  INDEX `nrms_loyalty_account_propertyId_tier_pointsBalance_idx` (`propertyId`, `tier`, `pointsBalance`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_loyalty_ledger` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `accountId` INTEGER NOT NULL,
  `reservationId` INTEGER NULL,
  `kind` VARCHAR(20) NOT NULL,
  `points` INTEGER NOT NULL,
  `balanceAfter` INTEGER NOT NULL,
  `reason` VARCHAR(300) NOT NULL,
  `idempotencyKey` VARCHAR(120) NOT NULL,
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_loyalty_ledger_idempotencyKey_key` (`idempotencyKey`),
  INDEX `nrms_loyalty_ledger_accountId_createdAt_idx` (`accountId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_review_request` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `reservationId` INTEGER NOT NULL,
  `guestProfileId` INTEGER NULL,
  `channel` VARCHAR(20) NOT NULL DEFAULT 'SMS',
  `status` VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  `publicToken` VARCHAR(80) NOT NULL,
  `sendAfter` DATETIME(3) NOT NULL,
  `sentAt` DATETIME(3) NULL,
  `openedAt` DATETIME(3) NULL,
  `respondedAt` DATETIME(3) NULL,
  `rating` INTEGER NULL,
  `feedback` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_review_request_reservationId_key` (`reservationId`),
  UNIQUE INDEX `nrms_review_request_publicToken_key` (`publicToken`),
  INDEX `nrms_review_request_propertyId_status_sendAfter_idx` (`propertyId`, `status`, `sendAfter`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_journey_template` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `trigger` VARCHAR(30) NOT NULL,
  `offsetMinutes` INTEGER NOT NULL DEFAULT 0,
  `channel` VARCHAR(20) NOT NULL DEFAULT 'SMS',
  `subject` VARCHAR(160) NULL,
  `message` VARCHAR(1000) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_journey_template_propertyId_name_key` (`propertyId`, `name`),
  INDEX `nrms_journey_template_propertyId_active_trigger_idx` (`propertyId`, `active`, `trigger`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_journey_delivery` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `templateId` INTEGER NOT NULL,
  `reservationId` INTEGER NOT NULL,
  `guestProfileId` INTEGER NULL,
  `scheduledAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  `renderedMessage` VARCHAR(1000) NOT NULL,
  `providerMessageId` VARCHAR(160) NULL,
  `sentAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `errorMessage` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_journey_delivery_templateId_reservationId_key` (`templateId`, `reservationId`),
  INDEX `nrms_journey_delivery_status_scheduledAt_idx` (`status`, `scheduledAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_guest_payment_request` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `reservationId` INTEGER NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'DEPOSIT',
  `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `publicToken` VARCHAR(80) NOT NULL,
  `dueAt` DATETIME(3) NULL,
  `instructions` JSON NULL,
  `reminderCount` INTEGER NOT NULL DEFAULT 0,
  `lastReminderAt` DATETIME(3) NULL,
  `settledAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_guest_payment_request_publicToken_key` (`publicToken`),
  INDEX `nrms_guest_payment_request_reservationId_status_idx` (`reservationId`, `status`),
  INDEX `nrms_guest_payment_request_status_dueAt_idx` (`status`, `dueAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_rate_plan` ADD CONSTRAINT `nrms_rate_plan_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_rate_plan` ADD CONSTRAINT `nrms_rate_plan_roomTypeId_fkey` FOREIGN KEY (`roomTypeId`) REFERENCES `room_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_rate_season` ADD CONSTRAINT `nrms_rate_season_ratePlanId_fkey` FOREIGN KEY (`ratePlanId`) REFERENCES `nrms_rate_plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_rate_restriction` ADD CONSTRAINT `nrms_rate_restriction_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_rate_restriction` ADD CONSTRAINT `nrms_rate_restriction_roomTypeId_fkey` FOREIGN KEY (`roomTypeId`) REFERENCES `room_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_rate_restriction` ADD CONSTRAINT `nrms_rate_restriction_ratePlanId_fkey` FOREIGN KEY (`ratePlanId`) REFERENCES `nrms_rate_plan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_onboarding_run` ADD CONSTRAINT `nrms_onboarding_run_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_onboarding_checklist` ADD CONSTRAINT `nrms_onboarding_checklist_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `nrms_onboarding_run`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_service_case` ADD CONSTRAINT `nrms_service_case_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_service_case` ADD CONSTRAINT `nrms_service_case_roomUnitId_fkey` FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_service_case` ADD CONSTRAINT `nrms_service_case_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_service_case` ADD CONSTRAINT `nrms_service_case_guestProfileId_fkey` FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_service_case_event` ADD CONSTRAINT `nrms_service_case_event_serviceCaseId_fkey` FOREIGN KEY (`serviceCaseId`) REFERENCES `nrms_service_case`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_offline_mutation` ADD CONSTRAINT `nrms_offline_mutation_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_portfolio_property` ADD CONSTRAINT `nrms_portfolio_property_portfolioId_fkey` FOREIGN KEY (`portfolioId`) REFERENCES `nrms_portfolio`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_portfolio_property` ADD CONSTRAINT `nrms_portfolio_property_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_forecast_snapshot` ADD CONSTRAINT `nrms_forecast_snapshot_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_pricing_recommendation` ADD CONSTRAINT `nrms_pricing_recommendation_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_pricing_recommendation` ADD CONSTRAINT `nrms_pricing_recommendation_roomTypeId_fkey` FOREIGN KEY (`roomTypeId`) REFERENCES `room_type`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_loyalty_account` ADD CONSTRAINT `nrms_loyalty_account_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_loyalty_account` ADD CONSTRAINT `nrms_loyalty_account_guestProfileId_fkey` FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_loyalty_ledger` ADD CONSTRAINT `nrms_loyalty_ledger_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `nrms_loyalty_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_review_request` ADD CONSTRAINT `nrms_review_request_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_review_request` ADD CONSTRAINT `nrms_review_request_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_review_request` ADD CONSTRAINT `nrms_review_request_guestProfileId_fkey` FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_journey_template` ADD CONSTRAINT `nrms_journey_template_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_journey_delivery` ADD CONSTRAINT `nrms_journey_delivery_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `nrms_journey_template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_journey_delivery` ADD CONSTRAINT `nrms_journey_delivery_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `nrms_journey_delivery` ADD CONSTRAINT `nrms_journey_delivery_guestProfileId_fkey` FOREIGN KEY (`guestProfileId`) REFERENCES `guest_profile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `nrms_guest_payment_request` ADD CONSTRAINT `nrms_guest_payment_request_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
