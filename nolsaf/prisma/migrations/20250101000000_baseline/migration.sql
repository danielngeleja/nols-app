-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorSecret` VARCHAR(191) NULL,
    `twoFactorMethod` VARCHAR(191) NULL,
    `totpSecretEnc` VARCHAR(191) NULL,
    `backupCodesHash` JSON NULL,
    `sms2faEnabled` BOOLEAN NULL DEFAULT false,
    `previousPasswordHashes` JSON NULL,
    `previousPasswords` JSON NULL,
    `resetPasswordToken` VARCHAR(191) NULL,
    `resetPasswordExpires` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `isDisabled` BOOLEAN NULL DEFAULT false,
    `kycStatus` VARCHAR(191) NULL,
    `rating` DECIMAL(3, 2) NULL,
    `available` BOOLEAN NULL DEFAULT true,
    `isAvailable` BOOLEAN NULL DEFAULT true,
    `payout` JSON NULL,
    `referredBy` INTEGER NULL,
    `referralCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    INDEX `User_role_idx`(`role`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_phone_idx`(`phone`),
    INDEX `User_suspendedAt_idx`(`suspendedAt`),
    INDEX `User_kycStatus_idx`(`kycStatus`),
    INDEX `User_referredBy_idx`(`referredBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Property` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `title` VARCHAR(200) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `regionId` VARCHAR(50) NULL,
    `regionName` VARCHAR(120) NULL,
    `district` VARCHAR(120) NULL,
    `street` VARCHAR(200) NULL,
    `apartment` VARCHAR(120) NULL,
    `city` VARCHAR(120) NULL,
    `zip` VARCHAR(30) NULL,
    `country` VARCHAR(120) NULL DEFAULT 'Tanzania',
    `latitude` DECIMAL(10, 6) NULL,
    `longitude` DECIMAL(10, 6) NULL,
    `description` TEXT NULL,
    `photos` JSON NULL,
    `hotelStar` VARCHAR(191) NULL,
    `roomsSpec` JSON NULL,
    `services` JSON NULL,
    `layout` JSON NULL,
    `basePrice` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(3) NULL DEFAULT 'TZS',
    `totalBedrooms` INTEGER NULL,
    `totalBathrooms` INTEGER NULL,
    `maxGuests` INTEGER NULL,
    `lastSubmittedAt` DATETIME(3) NULL,
    `rejectionReasons` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Property_ownerId_idx`(`ownerId`),
    INDEX `Property_status_idx`(`status`),
    INDEX `Property_type_idx`(`type`),
    INDEX `Property_regionId_idx`(`regionId`),
    INDEX `Property_regionName_idx`(`regionName`),
    INDEX `Property_district_idx`(`district`),
    INDEX `Property_status_createdAt_regionId_idx`(`status`, `createdAt`, `regionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `roomCode` VARCHAR(60) NULL,
    `guestName` VARCHAR(160) NULL,
    `guestPhone` VARCHAR(40) NULL,
    `nationality` VARCHAR(80) NULL,
    `sex` VARCHAR(20) NULL,
    `ageGroup` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Booking_propertyId_idx`(`propertyId`),
    INDEX `Booking_userId_idx`(`userId`),
    INDEX `Booking_status_idx`(`status`),
    INDEX `Booking_checkIn_idx`(`checkIn`),
    INDEX `Booking_checkOut_idx`(`checkOut`),
    INDEX `Booking_status_checkIn_idx`(`status`, `checkIn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckinCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookingId` INTEGER NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `codeHash` VARCHAR(128) NOT NULL,
    `codeVisible` VARCHAR(32) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `usedByOwner` INTEGER NULL,
    `voidReason` VARCHAR(255) NULL,
    `voidedAt` DATETIME(3) NULL,

    UNIQUE INDEX `CheckinCode_bookingId_key`(`bookingId`),
    INDEX `CheckinCode_status_idx`(`status`),
    INDEX `CheckinCode_generatedAt_idx`(`generatedAt`),
    INDEX `CheckinCode_code_idx`(`code`),
    UNIQUE INDEX `CheckinCode_codeHash_key`(`codeHash`),
    UNIQUE INDEX `CheckinCode_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `bookingId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `total` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `commissionPercent` DECIMAL(5, 2) NULL,
    `commissionAmount` DECIMAL(12, 2) NULL,
    `taxPercent` DECIMAL(5, 2) NULL,
    `netPayable` DECIMAL(12, 2) NULL,
    `invoiceNumber` VARCHAR(50) NULL,
    `receiptNumber` VARCHAR(50) NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `verifiedBy` INTEGER NULL,
    `approvedBy` INTEGER NULL,
    `paidBy` INTEGER NULL,
    `paymentMethod` VARCHAR(40) NULL,
    `paymentRef` VARCHAR(80) NULL,
    `notes` TEXT NULL,
    `receiptQrPayload` TEXT NULL,
    `receiptQrPng` LONGBLOB NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `Invoice_receiptNumber_key`(`receiptNumber`),
    UNIQUE INDEX `Invoice_paymentRef_key`(`paymentRef`),
    INDEX `Invoice_status_idx`(`status`),
    INDEX `Invoice_ownerId_idx`(`ownerId`),
    INDEX `Invoice_bookingId_idx`(`bookingId`),
    INDEX `Invoice_issuedAt_idx`(`issuedAt`),
    INDEX `Invoice_paidAt_idx`(`paidAt`),
    INDEX `Invoice_status_issuedAt_idx`(`status`, `issuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminIpAllow` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cidr` VARCHAR(64) NOT NULL,
    `note` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NULL,
    `actorRole` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity` VARCHAR(80) NOT NULL,
    `entityId` INTEGER NULL,
    `beforeJson` JSON NULL,
    `afterJson` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `ua` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAudit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adminId` INTEGER NOT NULL,
    `targetUserId` INTEGER NULL,
    `performedBy` INTEGER NULL,
    `action` VARCHAR(80) NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAudit_adminId_idx`(`adminId`),
    INDEX `AdminAudit_targetUserId_idx`(`targetUserId`),
    INDEX `AdminAudit_action_idx`(`action`),
    INDEX `AdminAudit_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_revokedAt_idx`(`revokedAt`),
    INDEX `Session_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminOtp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adminId` INTEGER NOT NULL,
    `purpose` VARCHAR(60) NOT NULL,
    `codeHash` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminOtp_adminId_purpose_idx`(`adminId`, `purpose`),
    INDEX `AdminOtp_expiresAt_idx`(`expiresAt`),
    INDEX `AdminOtp_usedAt_idx`(`usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailVerificationToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `token` VARCHAR(128) NOT NULL,
    `newEmail` VARCHAR(190) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailVerificationToken_token_key`(`token`),
    INDEX `EmailVerificationToken_userId_idx`(`userId`),
    INDEX `EmailVerificationToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhoneOtp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `phone` VARCHAR(40) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PhoneOtp_userId_idx`(`userId`),
    INDEX `PhoneOtp_phone_idx`(`phone`),
    INDEX `PhoneOtp_expiresAt_idx`(`expiresAt`),
    INDEX `PhoneOtp_usedAt_idx`(`usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ownerId` INTEGER NOT NULL,
    `adminId` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminNote_ownerId_idx`(`ownerId`),
    INDEX `AdminNote_adminId_idx`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NULL,
    `url` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserDocument_userId_idx`(`userId`),
    INDEX `UserDocument_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Passkey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `credentialId` VARCHAR(191) NOT NULL,
    `publicKey` TEXT NOT NULL,
    `transports` JSON NULL,
    `signCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Passkey_credentialId_key`(`credentialId`),
    INDEX `Passkey_userId_idx`(`userId`),
    INDEX `Passkey_credentialId_idx`(`credentialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `groupType` VARCHAR(191) NOT NULL,
    `fromRegion` VARCHAR(191) NULL,
    `fromDistrict` VARCHAR(191) NULL,
    `fromWard` VARCHAR(191) NULL,
    `fromLocation` VARCHAR(191) NULL,
    `toRegion` VARCHAR(191) NOT NULL,
    `toDistrict` VARCHAR(191) NULL,
    `toWard` VARCHAR(191) NULL,
    `toLocation` VARCHAR(191) NULL,
    `accommodationType` VARCHAR(191) NOT NULL,
    `headcount` INTEGER NOT NULL,
    `roomSize` INTEGER NOT NULL,
    `roomsNeeded` INTEGER NOT NULL,
    `needsPrivateRoom` BOOLEAN NOT NULL DEFAULT false,
    `privateRoomCount` INTEGER NOT NULL DEFAULT 0,
    `checkIn` DATETIME(3) NULL,
    `checkOut` DATETIME(3) NULL,
    `useDates` BOOLEAN NOT NULL DEFAULT true,
    `arrPickup` BOOLEAN NOT NULL DEFAULT false,
    `arrTransport` BOOLEAN NOT NULL DEFAULT false,
    `arrMeals` BOOLEAN NOT NULL DEFAULT false,
    `arrGuide` BOOLEAN NOT NULL DEFAULT false,
    `arrEquipment` BOOLEAN NOT NULL DEFAULT false,
    `pickupLocation` TEXT NULL,
    `pickupTime` VARCHAR(191) NULL,
    `arrangementNotes` TEXT NULL,
    `roster` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `totalAmount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TZS',
    `adminNotes` TEXT NULL,
    `cancelReason` TEXT NULL,
    `canceledAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `group_bookings_userId_idx`(`userId`),
    INDEX `group_bookings_status_idx`(`status`),
    INDEX `group_bookings_groupType_idx`(`groupType`),
    INDEX `group_bookings_toRegion_idx`(`toRegion`),
    INDEX `group_bookings_checkIn_checkOut_idx`(`checkIn`, `checkOut`),
    INDEX `group_bookings_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_booking_passengers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupBookingId` INTEGER NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `gender` VARCHAR(191) NULL,
    `nationality` VARCHAR(191) NULL,
    `sequenceNumber` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `group_booking_passengers_groupBookingId_idx`(`groupBookingId`),
    INDEX `group_booking_passengers_lastName_firstName_idx`(`lastName`, `firstName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransportBooking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `driverId` INTEGER NULL,
    `propertyId` INTEGER NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    `scheduledDate` DATETIME(3) NOT NULL,
    `pickupTime` DATETIME(3) NULL,
    `dropoffTime` DATETIME(3) NULL,
    `fromRegion` VARCHAR(120) NULL,
    `fromDistrict` VARCHAR(120) NULL,
    `fromWard` VARCHAR(120) NULL,
    `fromAddress` VARCHAR(255) NULL,
    `fromLatitude` DECIMAL(10, 6) NULL,
    `fromLongitude` DECIMAL(10, 6) NULL,
    `toRegion` VARCHAR(120) NULL,
    `toDistrict` VARCHAR(120) NULL,
    `toWard` VARCHAR(120) NULL,
    `toAddress` VARCHAR(255) NULL,
    `toLatitude` DECIMAL(10, 6) NULL,
    `toLongitude` DECIMAL(10, 6) NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(3) NULL DEFAULT 'TZS',
    `numberOfPassengers` INTEGER NULL DEFAULT 1,
    `notes` TEXT NULL,
    `rating` DECIMAL(3, 2) NULL,
    `ratingComment` TEXT NULL,
    `paymentStatus` VARCHAR(40) NULL DEFAULT 'PENDING',
    `paymentMethod` VARCHAR(40) NULL,
    `paymentRef` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TransportBooking_userId_idx`(`userId`),
    INDEX `TransportBooking_driverId_idx`(`driverId`),
    INDEX `TransportBooking_propertyId_idx`(`propertyId`),
    INDEX `TransportBooking_status_idx`(`status`),
    INDEX `TransportBooking_scheduledDate_idx`(`scheduledDate`),
    INDEX `TransportBooking_paymentStatus_idx`(`paymentStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trust_partners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `logoUrl` VARCHAR(191) NULL,
    `href` VARCHAR(191) NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `trust_partners_isActive_idx`(`isActive`),
    INDEX `trust_partners_displayOrder_idx`(`displayOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `referral_earnings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `driverId` INTEGER NOT NULL,
    `referredUserId` INTEGER NOT NULL,
    `bookingId` INTEGER NULL,
    `invoiceId` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `bonusPaymentRef` VARCHAR(191) NULL,
    `withdrawalId` INTEGER NULL,
    `adminNotes` TEXT NULL,
    `paidAsBonusAt` DATETIME(3) NULL,
    `availableAt` DATETIME(3) NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `referral_earnings_driverId_idx`(`driverId`),
    INDEX `referral_earnings_referredUserId_idx`(`referredUserId`),
    INDEX `referral_earnings_bookingId_idx`(`bookingId`),
    INDEX `referral_earnings_invoiceId_idx`(`invoiceId`),
    INDEX `referral_earnings_status_idx`(`status`),
    INDEX `referral_earnings_withdrawalId_idx`(`withdrawalId`),
    INDEX `referral_earnings_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `referral_withdrawals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `driverId` INTEGER NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `paymentMethod` VARCHAR(191) NULL,
    `paymentRef` VARCHAR(191) NULL,
    `processedBy` INTEGER NULL,
    `rejectionReason` TEXT NULL,
    `adminNotes` TEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `referral_withdrawals_driverId_idx`(`driverId`),
    INDEX `referral_withdrawals_status_idx`(`status`),
    INDEX `referral_withdrawals_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `commissionPercent` DECIMAL(5, 2) NULL DEFAULT 10.00,
    `taxPercent` DECIMAL(5, 2) NULL DEFAULT 0.00,
    `invoicePrefix` VARCHAR(191) NULL DEFAULT 'INV',
    `receiptPrefix` VARCHAR(191) NULL DEFAULT 'RCPT',
    `branding` JSON NULL,
    `emailEnabled` BOOLEAN NULL DEFAULT true,
    `smsEnabled` BOOLEAN NULL DEFAULT true,
    `referralCreditPercent` DECIMAL(10, 6) NULL DEFAULT 0.0035,
    `driverLevelGoldThreshold` INTEGER NULL DEFAULT 500000,
    `driverLevelDiamondThreshold` INTEGER NULL DEFAULT 2000000,
    `goalMultiplier` DECIMAL(5, 2) NULL DEFAULT 1.1,
    `goalMinimumMonthly` INTEGER NULL DEFAULT 3000000,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(200) NULL,
    `comment` TEXT NULL,
    `categoryRatings` JSON NULL,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `isHidden` BOOLEAN NOT NULL DEFAULT false,
    `bookingId` INTEGER NULL,
    `ownerResponse` TEXT NULL,
    `ownerResponseAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `property_reviews_propertyId_idx`(`propertyId`),
    INDEX `property_reviews_userId_idx`(`userId`),
    INDEX `property_reviews_bookingId_idx`(`bookingId`),
    INDEX `property_reviews_rating_idx`(`rating`),
    INDEX `property_reviews_isPublished_isHidden_idx`(`isPublished`, `isHidden`),
    INDEX `property_reviews_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NULL,
    `url` TEXT NULL,
    `thumbnailKey` VARCHAR(191) NULL,
    `thumbnailUrl` TEXT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `moderationNote` TEXT NULL,
    `moderatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_images_storageKey_key`(`storageKey`),
    INDEX `property_images_propertyId_idx`(`propertyId`),
    INDEX `property_images_status_idx`(`status`),
    INDEX `property_images_storageKey_idx`(`storageKey`),
    INDEX `property_images_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `invoiceId` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_events_eventId_key`(`eventId`),
    INDEX `payment_events_provider_idx`(`provider`),
    INDEX `payment_events_eventId_idx`(`eventId`),
    INDEX `payment_events_invoiceId_idx`(`invoiceId`),
    INDEX `payment_events_status_idx`(`status`),
    INDEX `payment_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `ownerId` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `unread` BOOLEAN NOT NULL DEFAULT true,
    `meta` JSON NULL,
    `type` VARCHAR(50) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Notification_userId_idx`(`userId`),
    INDEX `Notification_ownerId_idx`(`ownerId`),
    INDEX `Notification_unread_idx`(`unread`),
    INDEX `Notification_type_idx`(`type`),
    INDEX `Notification_createdAt_idx`(`createdAt`),
    INDEX `Notification_userId_unread_idx`(`userId`, `unread`),
    INDEX `Notification_ownerId_unread_idx`(`ownerId`, `unread`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role` VARCHAR(100) NOT NULL,
    `tripType` VARCHAR(100) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'NEW',
    `fullName` VARCHAR(200) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `destinations` VARCHAR(500) NULL,
    `dateFrom` DATETIME(3) NULL,
    `dateTo` DATETIME(3) NULL,
    `groupSize` INTEGER NULL,
    `budget` DECIMAL(12, 2) NULL,
    `notes` TEXT NULL,
    `transportRequired` BOOLEAN NULL DEFAULT false,
    `vehicleType` VARCHAR(100) NULL,
    `pickupLocation` VARCHAR(500) NULL,
    `dropoffLocation` VARCHAR(500) NULL,
    `vehiclesNeeded` INTEGER NULL,
    `passengerCount` INTEGER NULL,
    `vehicleRequirements` TEXT NULL,
    `roleSpecificData` JSON NULL,
    `adminResponse` TEXT NULL,
    `suggestedItineraries` TEXT NULL,
    `requiredPermits` TEXT NULL,
    `estimatedTimeline` TEXT NULL,
    `assignedAgent` VARCHAR(200) NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `plan_requests_role_idx`(`role`),
    INDEX `plan_requests_tripType_idx`(`tripType`),
    INDEX `plan_requests_status_idx`(`status`),
    INDEX `plan_requests_email_idx`(`email`),
    INDEX `plan_requests_phone_idx`(`phone`),
    INDEX `plan_requests_createdAt_idx`(`createdAt`),
    INDEX `plan_requests_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Property` ADD CONSTRAINT `Property_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckinCode` ADD CONSTRAINT `CheckinCode_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckinCode` ADD CONSTRAINT `CheckinCode_usedByOwner_fkey` FOREIGN KEY (`usedByOwner`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_verifiedBy_fkey` FOREIGN KEY (`verifiedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_approvedBy_fkey` FOREIGN KEY (`approvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_paidBy_fkey` FOREIGN KEY (`paidBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAudit` ADD CONSTRAINT `AdminAudit_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminOtp` ADD CONSTRAINT `AdminOtp_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailVerificationToken` ADD CONSTRAINT `EmailVerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhoneOtp` ADD CONSTRAINT `PhoneOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminNote` ADD CONSTRAINT `AdminNote_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminNote` ADD CONSTRAINT `AdminNote_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDocument` ADD CONSTRAINT `UserDocument_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Passkey` ADD CONSTRAINT `Passkey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_bookings` ADD CONSTRAINT `group_bookings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_booking_passengers` ADD CONSTRAINT `group_booking_passengers_groupBookingId_fkey` FOREIGN KEY (`groupBookingId`) REFERENCES `group_bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransportBooking` ADD CONSTRAINT `TransportBooking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransportBooking` ADD CONSTRAINT `TransportBooking_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransportBooking` ADD CONSTRAINT `TransportBooking_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_earnings` ADD CONSTRAINT `referral_earnings_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_earnings` ADD CONSTRAINT `referral_earnings_referredUserId_fkey` FOREIGN KEY (`referredUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_earnings` ADD CONSTRAINT `referral_earnings_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_earnings` ADD CONSTRAINT `referral_earnings_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_earnings` ADD CONSTRAINT `referral_earnings_withdrawalId_fkey` FOREIGN KEY (`withdrawalId`) REFERENCES `referral_withdrawals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_withdrawals` ADD CONSTRAINT `referral_withdrawals_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `referral_withdrawals` ADD CONSTRAINT `referral_withdrawals_processedBy_fkey` FOREIGN KEY (`processedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_reviews` ADD CONSTRAINT `property_reviews_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_reviews` ADD CONSTRAINT `property_reviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_reviews` ADD CONSTRAINT `property_reviews_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_images` ADD CONSTRAINT `property_images_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

