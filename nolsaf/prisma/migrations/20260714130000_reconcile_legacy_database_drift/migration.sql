-- DropForeignKey
ALTER TABLE `adminaudit` DROP FOREIGN KEY `AdminAudit_adminId_fkey`;

-- DropForeignKey
ALTER TABLE `adminnote` DROP FOREIGN KEY `AdminNote_adminId_fkey`;

-- DropForeignKey
ALTER TABLE `adminnote` DROP FOREIGN KEY `AdminNote_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `adminotp` DROP FOREIGN KEY `AdminOtp_adminId_fkey`;

-- DropForeignKey
ALTER TABLE `agent` DROP FOREIGN KEY `Agent_userId_fkey`;

-- DropForeignKey
ALTER TABLE `auditlog` DROP FOREIGN KEY `AuditLog_actorId_fkey`;

-- DropForeignKey
ALTER TABLE `booking` DROP FOREIGN KEY `Booking_propertyId_fkey`;

-- DropForeignKey
ALTER TABLE `booking` DROP FOREIGN KEY `Booking_userId_fkey`;

-- DropForeignKey
ALTER TABLE `cancellation_messages` DROP FOREIGN KEY `cancellation_messages_request_fkey`;

-- DropForeignKey
ALTER TABLE `cancellation_messages` DROP FOREIGN KEY `cancellation_messages_sender_fkey`;

-- DropForeignKey
ALTER TABLE `checkincode` DROP FOREIGN KEY `CheckinCode_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `checkincode` DROP FOREIGN KEY `CheckinCode_usedByOwner_fkey`;

-- DropForeignKey
ALTER TABLE `emailverificationtoken` DROP FOREIGN KEY `EmailVerificationToken_userId_fkey`;

-- DropForeignKey
ALTER TABLE `groupbookingaudit` DROP FOREIGN KEY `GroupBookingAudit_adminId_fkey`;

-- DropForeignKey
ALTER TABLE `groupbookingaudit` DROP FOREIGN KEY `GroupBookingAudit_groupBookingId_fkey`;

-- DropForeignKey
ALTER TABLE `invoice` DROP FOREIGN KEY `Invoice_approvedBy_fkey`;

-- DropForeignKey
ALTER TABLE `invoice` DROP FOREIGN KEY `Invoice_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `invoice` DROP FOREIGN KEY `Invoice_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `invoice` DROP FOREIGN KEY `Invoice_paidBy_fkey`;

-- DropForeignKey
ALTER TABLE `invoice` DROP FOREIGN KEY `Invoice_verifiedBy_fkey`;

-- DropForeignKey
ALTER TABLE `job` DROP FOREIGN KEY `Job_createdBy_fkey`;

-- DropForeignKey
ALTER TABLE `job` DROP FOREIGN KEY `Job_updatedBy_fkey`;

-- DropForeignKey
ALTER TABLE `jobapplication` DROP FOREIGN KEY `JobApplication_jobId_fkey`;

-- DropForeignKey
ALTER TABLE `jobapplication` DROP FOREIGN KEY `JobApplication_reviewedBy_fkey`;

-- DropForeignKey
ALTER TABLE `notification` DROP FOREIGN KEY `Notification_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `notification` DROP FOREIGN KEY `Notification_userId_fkey`;

-- DropForeignKey
ALTER TABLE `passkey` DROP FOREIGN KEY `Passkey_userId_fkey`;

-- DropForeignKey
ALTER TABLE `phoneotp` DROP FOREIGN KEY `PhoneOtp_userId_fkey`;

-- DropForeignKey
ALTER TABLE `plan_requests` DROP FOREIGN KEY `plan_requests_assignedAgentId_fkey`;

-- DropForeignKey
ALTER TABLE `property` DROP FOREIGN KEY `Property_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `property` DROP FOREIGN KEY `Property_tourismSiteId_fkey`;

-- DropForeignKey
ALTER TABLE `propertyavailabilityblock` DROP FOREIGN KEY `PropertyAvailabilityBlock_ownerId_fkey`;

-- DropForeignKey
ALTER TABLE `propertyavailabilityblock` DROP FOREIGN KEY `PropertyAvailabilityBlock_propertyId_fkey`;

-- DropForeignKey
ALTER TABLE `session` DROP FOREIGN KEY `Session_userId_fkey`;

-- DropForeignKey
ALTER TABLE `transport_payouts` DROP FOREIGN KEY `transport_payouts_approvedBy_fkey`;

-- DropForeignKey
ALTER TABLE `transport_payouts` DROP FOREIGN KEY `transport_payouts_driverId_fkey`;

-- DropForeignKey
ALTER TABLE `transport_payouts` DROP FOREIGN KEY `transport_payouts_paidBy_fkey`;

-- DropForeignKey
ALTER TABLE `transport_payouts` DROP FOREIGN KEY `transport_payouts_transportBookingId_fkey`;

-- DropForeignKey
ALTER TABLE `transportbooking` DROP FOREIGN KEY `TransportBooking_driverId_fkey`;

-- DropForeignKey
ALTER TABLE `transportbooking` DROP FOREIGN KEY `TransportBooking_propertyId_fkey`;

-- DropForeignKey
ALTER TABLE `transportbooking` DROP FOREIGN KEY `TransportBooking_userId_fkey`;

-- DropForeignKey
ALTER TABLE `userdocument` DROP FOREIGN KEY `UserDocument_userId_fkey`;

-- DropIndex
DROP INDEX `AuditLog_action_createdAt_idx` ON `auditlog`;

-- DropIndex
DROP INDEX `CheckinCode_usedByOwner_fkey` ON `checkincode`;

-- AlterTable
ALTER TABLE `agent` ADD COLUMN `restoredAt` DATETIME(3) NULL,
    ADD COLUMN `restoredBy` INTEGER NULL,
    MODIFY `suspensionReason` varchar(1000) NULL,
    MODIFY `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `updatedAt` datetime(3) NOT NULL;

-- AlterTable
ALTER TABLE `booking` ADD COLUMN `driverId` INTEGER NULL,
    ADD COLUMN `includeTransport` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `transportFare` DECIMAL(12, 2) NULL,
    ADD COLUMN `transportOriginAddress` VARCHAR(255) NULL,
    ADD COLUMN `transportScheduledDate` DATETIME(3) NULL,
    ADD COLUMN `transportVehicleType` VARCHAR(20) NULL;

-- AlterTable
ALTER TABLE `cancellation_messages` MODIFY `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `cancellation_requests` MODIFY `status` varchar(20) NOT NULL DEFAULT 'SUBMITTED',
    MODIFY `reviewedAt` datetime(3) NULL,
    MODIFY `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `updatedAt` datetime(3) NOT NULL;

-- AlterTable
ALTER TABLE `checkincode` MODIFY `usedByOwner` tinyint(1) NULL;

-- AlterTable
ALTER TABLE `group_bookings` ADD COLUMN `femaleCount` INTEGER NULL,
    ADD COLUMN `fromCountry` VARCHAR(191) NULL,
    ADD COLUMN `maleCount` INTEGER NULL,
    ADD COLUMN `minHotelStarLabel` VARCHAR(20) NULL,
    ADD COLUMN `otherCount` INTEGER NULL,
    ADD COLUMN `recommendedPropertyIds` JSON NULL;

-- AlterTable
ALTER TABLE `groupbookingaudit` MODIFY `action` varchar(100) NOT NULL;

-- AlterTable
ALTER TABLE `invoice` MODIFY `status` varchar(191) NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `jobapplication` ADD COLUMN `agentApplicationData` JSON NULL,
    ADD COLUMN `agentId` INTEGER NULL;

-- AlterTable
ALTER TABLE `plan_requests` ADD COLUMN `userId` INTEGER NULL;

-- AlterTable
ALTER TABLE `property` ADD COLUMN `buildingType` VARCHAR(191) NULL,
    ADD COLUMN `totalFloors` INTEGER NULL;

-- AlterTable
ALTER TABLE `property_verification` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `systemsetting` MODIFY `ipAllowlist` varchar(191) NULL;

-- AlterTable
ALTER TABLE `tour_bookings` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `transport_booking_claims` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `transport_booking_offers` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `transport_payouts` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `transportbooking` ADD COLUMN `arrivalNumber` VARCHAR(40) NULL,
    ADD COLUMN `arrivalTime` DATETIME(3) NULL,
    ADD COLUMN `arrivalType` VARCHAR(20) NULL,
    ADD COLUMN `driverRating` DECIMAL(3, 2) NULL,
    ADD COLUMN `driverReview` TEXT NULL,
    ADD COLUMN `pickupLocation` VARCHAR(255) NULL,
    ADD COLUMN `transportCompany` VARCHAR(100) NULL,
    ADD COLUMN `userRating` DECIMAL(3, 2) NULL,
    ADD COLUMN `userReview` TEXT NULL,
    ADD COLUMN `vehicleType` VARCHAR(20) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `address` VARCHAR(500) NULL,
    ADD COLUMN `avatarUrl` VARCHAR(500) NULL,
    ADD COLUMN `dateOfBirth` DATE NULL,
    ADD COLUMN `district` VARCHAR(120) NULL,
    ADD COLUMN `fullName` VARCHAR(160) NULL,
    ADD COLUMN `gender` VARCHAR(20) NULL,
    ADD COLUMN `licenseNumber` VARCHAR(80) NULL,
    ADD COLUMN `nationality` VARCHAR(80) NULL,
    ADD COLUMN `nin` VARCHAR(50) NULL,
    ADD COLUMN `operationArea` VARCHAR(200) NULL,
    ADD COLUMN `paymentPhone` VARCHAR(30) NULL,
    ADD COLUMN `paymentVerified` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `plateNumber` VARCHAR(30) NULL,
    ADD COLUMN `region` VARCHAR(120) NULL,
    ADD COLUMN `timezone` VARCHAR(80) NULL,
    ADD COLUMN `tin` VARCHAR(50) NULL,
    ADD COLUMN `vehicleMake` VARCHAR(100) NULL,
    ADD COLUMN `vehiclePlate` VARCHAR(30) NULL,
    ADD COLUMN `vehicleType` VARCHAR(50) NULL,
    MODIFY `kycNote` varchar(191) NULL;

-- CreateTable
CREATE TABLE `activity_costs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `activityCode` VARCHAR(80) NOT NULL,
    `activityName` VARCHAR(200) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `destination` VARCHAR(120) NOT NULL,
    `minCost` DECIMAL(10, 2) NOT NULL,
    `maxCost` DECIMAL(10, 2) NOT NULL,
    `averageCost` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `priceUnit` VARCHAR(30) NOT NULL DEFAULT 'per-person',
    `duration` VARCHAR(40) NULL,
    `durationHours` DECIMAL(4, 1) NULL,
    `groupSize` VARCHAR(60) NULL,
    `difficulty` VARCHAR(20) NULL,
    `includes` JSON NULL,
    `excludes` JSON NULL,
    `requirements` JSON NULL,
    `seasonalActivity` BOOLEAN NOT NULL DEFAULT false,
    `availableMonths` JSON NULL,
    `requiresBooking` BOOLEAN NOT NULL DEFAULT true,
    `bookingLeadDays` INTEGER NULL DEFAULT 3,
    `peakMultiplier` DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    `offPeakMultiplier` DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    `description` TEXT NULL,
    `provider` VARCHAR(200) NULL,
    `website` VARCHAR(300) NULL,
    `popularity` INTEGER NOT NULL DEFAULT 50,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `activity_costs_activityCode_key`(`activityCode` ASC),
    INDEX `activity_costs_category_idx`(`category` ASC),
    INDEX `activity_costs_destination_category_idx`(`destination` ASC, `category` ASC),
    INDEX `activity_costs_isActive_idx`(`isActive` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chatbot_conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `sessionId` VARCHAR(100) NOT NULL,
    `language` VARCHAR(10) NOT NULL DEFAULT 'en',
    `needsFollowUp` BOOLEAN NOT NULL DEFAULT false,
    `followUpNotes` TEXT NULL,
    `followedUpAt` DATETIME(3) NULL,
    `followedUpBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `chatbot_conversations_createdAt_idx`(`createdAt` ASC),
    INDEX `chatbot_conversations_language_idx`(`language` ASC),
    INDEX `chatbot_conversations_needsFollowUp_idx`(`needsFollowUp` ASC),
    INDEX `chatbot_conversations_sessionId_idx`(`sessionId` ASC),
    UNIQUE INDEX `chatbot_conversations_sessionId_key`(`sessionId` ASC),
    INDEX `chatbot_conversations_userId_idx`(`userId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chatbot_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` INTEGER NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `language` VARCHAR(10) NOT NULL DEFAULT 'en',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chatbot_messages_conversationId_createdAt_idx`(`conversationId` ASC, `createdAt` ASC),
    INDEX `chatbot_messages_conversationId_idx`(`conversationId` ASC),
    INDEX `chatbot_messages_createdAt_idx`(`createdAt` ASC),
    INDEX `chatbot_messages_role_idx`(`role` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_reminders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `driverId` INTEGER NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `message` TEXT NOT NULL,
    `action` VARCHAR(100) NULL,
    `actionLink` VARCHAR(255) NULL,
    `expiresAt` DATETIME(3) NULL,
    `meta` JSON NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `driver_reminders_createdAt_idx`(`createdAt` ASC),
    INDEX `driver_reminders_driverId_idx`(`driverId` ASC),
    INDEX `driver_reminders_expiresAt_idx`(`expiresAt` ASC),
    INDEX `driver_reminders_read_idx`(`read` ASC),
    INDEX `driver_reminders_type_idx`(`type` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `park_fees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parkName` VARCHAR(200) NOT NULL,
    `parkCode` VARCHAR(30) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `region` VARCHAR(100) NOT NULL,
    `adultForeignerFee` DECIMAL(10, 2) NOT NULL,
    `adultResidentFee` DECIMAL(10, 2) NULL,
    `childForeignerFee` DECIMAL(10, 2) NULL,
    `childResidentFee` DECIMAL(10, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `vehicleFee` DECIMAL(10, 2) NULL,
    `guideFee` DECIMAL(10, 2) NULL,
    `campingFee` DECIMAL(10, 2) NULL,
    `requiresGuide` BOOLEAN NOT NULL DEFAULT false,
    `minimumDays` INTEGER NULL,
    `description` TEXT NULL,
    `officialWebsite` VARCHAR(300) NULL,
    `lastVerified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `park_fees_isActive_idx`(`isActive` ASC),
    UNIQUE INDEX `park_fees_parkCode_key`(`parkCode` ASC),
    INDEX `park_fees_region_idx`(`region` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_request_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planRequestId` INTEGER NOT NULL,
    `senderId` INTEGER NULL,
    `senderRole` VARCHAR(20) NOT NULL,
    `senderName` VARCHAR(200) NULL,
    `messageType` VARCHAR(50) NULL,
    `body` TEXT NOT NULL,
    `isInternal` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `plan_request_messages_createdAt_idx`(`createdAt` ASC),
    INDEX `plan_request_messages_planRequestId_createdAt_idx`(`planRequestId` ASC, `createdAt` ASC),
    INDEX `plan_request_messages_planRequestId_idx`(`planRequestId` ASC),
    INDEX `plan_request_messages_senderId_idx`(`senderId` ASC),
    INDEX `plan_request_messages_senderRole_idx`(`senderRole` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricing_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleName` VARCHAR(120) NOT NULL,
    `ruleType` VARCHAR(30) NOT NULL,
    `destination` VARCHAR(120) NULL,
    `category` VARCHAR(40) NULL,
    `seasonName` VARCHAR(30) NULL,
    `startMonth` INTEGER NULL,
    `endMonth` INTEGER NULL,
    `specificDates` JSON NULL,
    `priceMultiplier` DECIMAL(4, 2) NOT NULL,
    `minTravelers` INTEGER NULL,
    `maxTravelers` INTEGER NULL,
    `daysInAdvance` INTEGER NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `validFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validUntil` DATETIME(3) NULL,
    `description` TEXT NULL,
    `createdBy` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pricing_rules_destination_seasonName_idx`(`destination` ASC, `seasonName` ASC),
    INDEX `pricing_rules_isActive_priority_idx`(`isActive` ASC, `priority` ASC),
    UNIQUE INDEX `pricing_rules_ruleName_key`(`ruleName` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `savedproperty` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sharedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SavedProperty_propertyId_idx`(`propertyId` ASC),
    INDEX `SavedProperty_savedAt_idx`(`savedAt` ASC),
    INDEX `SavedProperty_sharedAt_idx`(`sharedAt` ASC),
    INDEX `SavedProperty_userId_idx`(`userId` ASC),
    UNIQUE INDEX `SavedProperty_userId_propertyId_key`(`userId` ASC, `propertyId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_cost_averages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fromLocation` VARCHAR(120) NOT NULL,
    `toLocation` VARCHAR(120) NOT NULL,
    `transportType` VARCHAR(30) NOT NULL,
    `minCost` DECIMAL(10, 2) NOT NULL,
    `maxCost` DECIMAL(10, 2) NOT NULL,
    `averageCost` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `durationHours` DECIMAL(5, 1) NULL,
    `distanceKm` INTEGER NULL,
    `frequency` VARCHAR(60) NULL,
    `peakMultiplier` DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    `offPeakMultiplier` DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    `description` VARCHAR(500) NULL,
    `provider` VARCHAR(200) NULL,
    `requiresBooking` BOOLEAN NOT NULL DEFAULT false,
    `bookingLeadDays` INTEGER NULL,
    `confidence` DECIMAL(3, 2) NOT NULL DEFAULT 0.80,
    `dataSource` VARCHAR(60) NULL,
    `lastUpdated` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `transport_cost_averages_fromLocation_toLocation_idx`(`fromLocation` ASC, `toLocation` ASC),
    UNIQUE INDEX `transport_cost_averages_fromLocation_toLocation_transportTyp_key`(`fromLocation` ASC, `toLocation` ASC, `transportType` ASC),
    INDEX `transport_cost_averages_isActive_idx`(`isActive` ASC),
    INDEX `transport_cost_averages_transportType_idx`(`transportType` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transportmessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transportBookingId` INTEGER NOT NULL,
    `senderId` INTEGER NOT NULL,
    `senderType` VARCHAR(20) NOT NULL,
    `message` TEXT NOT NULL,
    `messageType` VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TransportMessage_readAt_idx`(`readAt` ASC),
    INDEX `TransportMessage_senderId_idx`(`senderId` ASC),
    INDEX `TransportMessage_transportBookingId_createdAt_idx`(`transportBookingId` ASC, `createdAt` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trip_destinations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `destinationCode` VARCHAR(30) NOT NULL,
    `destinationName` VARCHAR(120) NOT NULL,
    `displayName` VARCHAR(200) NULL,
    `destinationType` VARCHAR(30) NOT NULL,
    `country` VARCHAR(80) NOT NULL DEFAULT 'Tanzania',
    `region` VARCHAR(100) NOT NULL,
    `coordinates` JSON NULL,
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    `mainAirport` VARCHAR(100) NULL,
    `nearestCity` VARCHAR(80) NULL,
    `accessDifficulty` VARCHAR(20) NOT NULL DEFAULT 'moderate',
    `bestMonths` JSON NULL,
    `rainyMonths` JSON NULL,
    `peakMonths` JSON NULL,
    `offPeakMonths` JSON NULL,
    `accommodationMultiplier` DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    `transportBaseUsd` DECIMAL(10, 2) NULL,
    `avgStayDays` INTEGER NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(500) NULL,
    `officialWebsite` VARCHAR(300) NULL,
    `popularity` INTEGER NOT NULL DEFAULT 50,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trip_destinations_destinationCode_key`(`destinationCode` ASC),
    INDEX `trip_destinations_destinationType_idx`(`destinationType` ASC),
    INDEX `trip_destinations_isActive_popularity_idx`(`isActive` ASC, `popularity` ASC),
    INDEX `trip_destinations_region_idx`(`region` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trip_estimates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `destination` VARCHAR(120) NOT NULL,
    `destinationType` VARCHAR(40) NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `travelers` INTEGER NOT NULL DEFAULT 1,
    `accommodationLevel` VARCHAR(20) NOT NULL,
    `transportPreference` VARCHAR(30) NULL,
    `nationality` VARCHAR(5) NOT NULL DEFAULT 'US',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `requestedActivities` JSON NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL,
    `confidence` DECIMAL(3, 2) NOT NULL,
    `breakdown` JSON NOT NULL,
    `minCost` DECIMAL(12, 2) NULL,
    `maxCost` DECIMAL(12, 2) NULL,
    `currentSeason` VARCHAR(20) NULL,
    `offPeakCost` DECIMAL(12, 2) NULL,
    `offPeakSavings` DECIMAL(12, 2) NULL,
    `suggestions` JSON NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `dataSourcesUsed` JSON NULL,
    `userId` INTEGER NULL,
    `sessionId` VARCHAR(128) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `convertedToBooking` BOOLEAN NOT NULL DEFAULT false,
    `bookingId` INTEGER NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 1,
    `lastViewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `trip_estimates_convertedToBooking_idx`(`convertedToBooking` ASC),
    INDEX `trip_estimates_createdAt_idx`(`createdAt` ASC),
    INDEX `trip_estimates_destination_startDate_idx`(`destination` ASC, `startDate` ASC),
    INDEX `trip_estimates_sessionId_idx`(`sessionId` ASC),
    INDEX `trip_estimates_userId_idx`(`userId` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `visa_fees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nationality` VARCHAR(5) NOT NULL,
    `visaType` VARCHAR(30) NOT NULL DEFAULT 'tourist',
    `entries` VARCHAR(20) NOT NULL DEFAULT 'single',
    `durationDays` INTEGER NOT NULL DEFAULT 90,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
    `description` VARCHAR(500) NULL,
    `processingTime` VARCHAR(80) NULL,
    `requirements` JSON NULL,
    `validFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validUntil` DATETIME(3) NULL,
    `lastVerified` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `visa_fees_isActive_idx`(`isActive` ASC),
    INDEX `visa_fees_nationality_idx`(`nationality` ASC),
    UNIQUE INDEX `visa_fees_nationality_visaType_entries_key`(`nationality` ASC, `visaType` ASC, `entries` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Booking_driverId_idx` ON `booking`(`driverId` ASC);

-- CreateIndex
CREATE INDEX `Booking_includeTransport_idx` ON `booking`(`includeTransport` ASC);

-- CreateIndex
CREATE INDEX `Booking_includeTransport_transportScheduledDate_idx` ON `booking`(`includeTransport` ASC, `transportScheduledDate` ASC);

-- CreateIndex
CREATE INDEX `invoice_checkoutSessionId_idx` ON `invoice`(`checkoutSessionId` ASC);

-- CreateIndex
CREATE INDEX `plan_requests_userId_idx` ON `plan_requests`(`userId` ASC);

-- CreateIndex
CREATE INDEX `plan_requests_userId_status_idx` ON `plan_requests`(`userId` ASC, `status` ASC);

-- CreateIndex
CREATE INDEX `idx_Property_status_basePrice_id` ON `property`(`status` ASC, `basePrice` ASC, `id` ASC);

-- CreateIndex
CREATE INDEX `TransportBooking_vehicleType_idx` ON `transportbooking`(`vehicleType` ASC);

-- AddForeignKey
ALTER TABLE `adminaudit` ADD CONSTRAINT `adminaudit_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adminnote` ADD CONSTRAINT `adminnote_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adminnote` ADD CONSTRAINT `adminnote_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adminotp` ADD CONSTRAINT `adminotp_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent` ADD CONSTRAINT `agent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auditlog` ADD CONSTRAINT `auditlog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking` ADD CONSTRAINT `booking_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking` ADD CONSTRAINT `booking_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking` ADD CONSTRAINT `booking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellation_messages` ADD CONSTRAINT `cancellation_messages_cancellationRequestId_fkey` FOREIGN KEY (`cancellationRequestId`) REFERENCES `cancellation_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellation_messages` ADD CONSTRAINT `cancellation_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chatbot_conversations` ADD CONSTRAINT `chatbot_conversations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chatbot_messages` ADD CONSTRAINT `chatbot_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `chatbot_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkincode` ADD CONSTRAINT `checkincode_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_reminders` ADD CONSTRAINT `driver_reminders_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emailverificationtoken` ADD CONSTRAINT `emailverificationtoken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `groupbookingaudit` ADD CONSTRAINT `groupbookingaudit_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `groupbookingaudit` ADD CONSTRAINT `groupbookingaudit_groupBookingId_fkey` FOREIGN KEY (`groupBookingId`) REFERENCES `group_bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_approvedBy_fkey` FOREIGN KEY (`approvedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_paidBy_fkey` FOREIGN KEY (`paidBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice` ADD CONSTRAINT `invoice_verifiedBy_fkey` FOREIGN KEY (`verifiedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job` ADD CONSTRAINT `job_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job` ADD CONSTRAINT `job_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passkey` ADD CONSTRAINT `passkey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `phoneotp` ADD CONSTRAINT `phoneotp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_request_messages` ADD CONSTRAINT `plan_request_messages_planRequestId_fkey` FOREIGN KEY (`planRequestId`) REFERENCES `plan_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_request_messages` ADD CONSTRAINT `plan_request_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_requests` ADD CONSTRAINT `plan_requests_assignedAgentId_fkey` FOREIGN KEY (`assignedAgentId`) REFERENCES `agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_requests` ADD CONSTRAINT `plan_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property` ADD CONSTRAINT `property_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property` ADD CONSTRAINT `property_tourismSiteId_fkey` FOREIGN KEY (`tourismSiteId`) REFERENCES `tourismsite`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session` ADD CONSTRAINT `session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_payouts` ADD CONSTRAINT `transport_payouts_approvedBy_fkey` FOREIGN KEY (`approvedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_payouts` ADD CONSTRAINT `transport_payouts_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_payouts` ADD CONSTRAINT `transport_payouts_paidBy_fkey` FOREIGN KEY (`paidBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_payouts` ADD CONSTRAINT `transport_payouts_transportBookingId_fkey` FOREIGN KEY (`transportBookingId`) REFERENCES `transportbooking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transportbooking` ADD CONSTRAINT `transportbooking_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transportbooking` ADD CONSTRAINT `transportbooking_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transportbooking` ADD CONSTRAINT `transportbooking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transportmessage` ADD CONSTRAINT `transportmessage_transportBookingId_fkey` FOREIGN KEY (`transportBookingId`) REFERENCES `transportbooking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userdocument` ADD CONSTRAINT `userdocument_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `userId` TO `Agent_userId_key`;

-- RenameIndex
ALTER TABLE `cancellation_requests` RENAME INDEX `cancellation_requests_reviewedBy_idx` TO `cancellation_requests_reviewedBy_fkey`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_approvedBy_fkey` TO `invoice_approvedBy_fkey`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_paidBy_fkey` TO `invoice_paidBy_fkey`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_verifiedBy_fkey` TO `invoice_verifiedBy_fkey`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_updatedBy_fkey` TO `job_updatedBy_fkey`;

-- RenameIndex
ALTER TABLE `payment_events` RENAME INDEX `payment_events_payment_channel_status_created_at_idx` TO `payment_events_payment_channel_status_createdAt_idx`;

-- RenameIndex
ALTER TABLE `property_images` RENAME INDEX `PropertyImage_propertyId_status_createdAt_idx` TO `property_images_propertyId_status_createdAt_idx`;
