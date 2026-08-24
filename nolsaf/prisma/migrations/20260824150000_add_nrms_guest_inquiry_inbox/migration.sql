-- Property-scoped pre-booking inbox. Social provider identifiers remain
-- nullable until Meta/WhatsApp adapters are connected; WEB and tracked
-- handoff inquiries are usable immediately.

CREATE TABLE `nrms_guest_inquiry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `propertyId` INTEGER NOT NULL,
  `ownerId` INTEGER NOT NULL,
  `reference` VARCHAR(40) NOT NULL,
  `sessionRef` VARCHAR(100) NULL,
  `channel` VARCHAR(20) NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'DIRECT',
  `externalConversationId` VARCHAR(191) NULL,
  `guestName` VARCHAR(160) NULL,
  `guestHandle` VARCHAR(160) NULL,
  `guestPhone` VARCHAR(40) NULL,
  `guestEmail` VARCHAR(160) NULL,
  `intent` VARCHAR(30) NOT NULL DEFAULT 'AVAILABILITY',
  `status` VARCHAR(20) NOT NULL DEFAULT 'NEW',
  `checkIn` DATE NULL,
  `checkOut` DATE NULL,
  `adults` INTEGER NOT NULL DEFAULT 1,
  `children` INTEGER NOT NULL DEFAULT 0,
  `roomTypeId` INTEGER NULL,
  `reservationId` INTEGER NULL,
  `assignedToId` INTEGER NULL,
  `firstResponseAt` DATETIME(3) NULL,
  `lastMessageAt` DATETIME(3) NULL,
  `convertedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `nrms_guest_inquiry_reference_key`(`reference`),
  UNIQUE INDEX `nrms_guest_inquiry_reservationId_key`(`reservationId`),
  UNIQUE INDEX `nrms_guest_inquiry_property_session_channel_key`(`propertyId`, `sessionRef`, `channel`),
  INDEX `nrms_guest_inquiry_property_status_activity_idx`(`propertyId`, `status`, `lastMessageAt`, `createdAt`),
  INDEX `nrms_guest_inquiry_property_channel_created_idx`(`propertyId`, `channel`, `createdAt`),
  INDEX `nrms_guest_inquiry_assignedToId_status_idx`(`assignedToId`, `status`),
  INDEX `nrms_guest_inquiry_externalConversationId_idx`(`externalConversationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nrms_guest_message` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `inquiryId` INTEGER NOT NULL,
  `direction` VARCHAR(20) NOT NULL,
  `channel` VARCHAR(20) NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `senderName` VARCHAR(160) NULL,
  `body` TEXT NOT NULL,
  `deliveryStatus` VARCHAR(20) NOT NULL DEFAULT 'RECORDED',
  `sentById` INTEGER NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `nrms_guest_message_providerMessageId_key`(`providerMessageId`),
  INDEX `nrms_guest_message_inquiryId_createdAt_idx`(`inquiryId`, `createdAt`),
  INDEX `nrms_guest_message_sentById_createdAt_idx`(`sentById`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `nrms_guest_inquiry`
  ADD CONSTRAINT `nrms_guest_inquiry_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_guest_inquiry_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_guest_inquiry_roomTypeId_fkey` FOREIGN KEY (`roomTypeId`) REFERENCES `room_type`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_guest_inquiry_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `nrms_guest_inquiry_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `nrms_guest_message`
  ADD CONSTRAINT `nrms_guest_message_inquiryId_fkey` FOREIGN KEY (`inquiryId`) REFERENCES `nrms_guest_inquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
