-- NRMS rooming list.
--
-- The desk shares a capability link with the agency or group leader, who fills
-- in who is staying. The alternative is a clerk typing twenty names off a phone
-- call, which is where group check-in goes wrong everywhere.
--
-- Two rules enforced in application code:
--   1. `publicToken` is a bearer credential, served with no-store, no-referrer
--      and noindex, exactly like nrms_guest_payment_request.publicToken.
--   2. Submitting never touches inventory. Rows are staging text until the desk
--      accepts them and pickup materialises reservations, so an agency
--      submitting at midnight can never oversell the property.

CREATE TABLE `nrms_rooming_list` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `blockId`        INT NOT NULL,
  `publicToken`    VARCHAR(80) NOT NULL,
  `status`         VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `expiresAt`      DATETIME(3) NOT NULL,
  `sentAt`         DATETIME(3) NULL,
  `submittedAt`    DATETIME(3) NULL,
  `reviewedAt`     DATETIME(3) NULL,
  `reviewedById`   INT NULL,
  `submitterName`  VARCHAR(160) NULL,
  `submitterEmail` VARCHAR(160) NULL,
  `deskNotes`      TEXT NULL,
  `instructions`   TEXT NULL,
  `createdById`    INT NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_rooming_list_blockId_key` (`blockId`),
  UNIQUE KEY `nrms_rooming_list_publicToken_key` (`publicToken`),
  KEY `nrms_rooming_list_status_expiresAt_idx` (`status`, `expiresAt`),

  CONSTRAINT `nrms_rooming_list_blockId_fkey`
    FOREIGN KEY (`blockId`) REFERENCES `nrms_group_block` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_rooming_list_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_rooming_list_reviewedById_fkey`
    FOREIGN KEY (`reviewedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE `nrms_rooming_list_row` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `roomingListId`   INT NOT NULL,
  `blockRoomId`     INT NULL,
  `fullName`        VARCHAR(160) NOT NULL,
  `phone`           VARCHAR(40) NULL,
  `email`           VARCHAR(160) NULL,
  `nationality`     VARCHAR(80) NULL,
  `adults`          INT NOT NULL DEFAULT 1,
  `children`        INT NOT NULL DEFAULT 0,
  `sharingWith`     VARCHAR(160) NULL,
  `notes`           TEXT NULL,
  `status`          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `rejectionReason` VARCHAR(300) NULL,
  `reservationId`   INT NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- One row can only ever become one reservation, so a confirmed row cannot be
  -- picked up twice.
  UNIQUE KEY `nrms_rooming_list_row_reservationId_key` (`reservationId`),
  KEY `nrms_rooming_list_row_roomingListId_status_idx` (`roomingListId`, `status`),
  KEY `nrms_rooming_list_row_blockRoomId_idx` (`blockRoomId`),

  CONSTRAINT `nrms_rooming_list_row_roomingListId_fkey`
    FOREIGN KEY (`roomingListId`) REFERENCES `nrms_rooming_list` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_rooming_list_row_blockRoomId_fkey`
    FOREIGN KEY (`blockRoomId`) REFERENCES `nrms_group_block_room` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_rooming_list_row_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `reservation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
