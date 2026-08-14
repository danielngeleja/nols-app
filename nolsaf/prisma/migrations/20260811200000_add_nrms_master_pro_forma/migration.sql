-- Direct-to-property agency Pro Forma invoices for NRMS group master folios.
-- The receiving bank account is encrypted by the application before storage;
-- the public QR page and PDF decrypt it only for the specific capability token.

CREATE TABLE `nrms_master_folio_pro_forma` (
  `id`                   INT NOT NULL AUTO_INCREMENT,
  `masterFolioId`        INT NOT NULL,
  `number`               VARCHAR(48) NOT NULL,
  `revision`             INT NOT NULL DEFAULT 1,
  `status`               VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `currency`             VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `issuedAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `dueAt`                DATE NOT NULL,
  `validUntil`           DATE NOT NULL,
  `billToName`           VARCHAR(160) NOT NULL,
  `contactName`          VARCHAR(160) NOT NULL,
  `contactEmail`         VARCHAR(160) NOT NULL,
  `contactPhone`         VARCHAR(40) NULL,
  `propertyName`         VARCHAR(200) NOT NULL,
  `propertyLocation`     VARCHAR(500) NULL,
  `propertyTin`          VARCHAR(50) NULL,
  `propertyEmail`        VARCHAR(160) NULL,
  `propertyPhone`        VARCHAR(40) NULL,
  `bankName`             VARCHAR(80) NOT NULL,
  `bankAccountName`      VARCHAR(160) NOT NULL,
  `bankAccountNumberEnc` TEXT NOT NULL,
  `bankBranch`           VARCHAR(120) NULL,
  `itemsSnapshot`        JSON NOT NULL,
  `paymentsSnapshot`     JSON NOT NULL,
  `quotedTotal`          DECIMAL(12, 2) NOT NULL,
  `paidAtIssue`          DECIMAL(12, 2) NOT NULL,
  `balanceDue`           DECIMAL(12, 2) NOT NULL,
  `notes`                VARCHAR(1000) NULL,
  `publicToken`          VARCHAR(96) NOT NULL,
  `viewCount`            INT NOT NULL DEFAULT 0,
  `lastViewedAt`         DATETIME(3) NULL,
  `createdById`          INT NULL,
  `sentById`             INT NULL,
  `sentAt`               DATETIME(3) NULL,
  `sentToEmail`          VARCHAR(160) NULL,
  `deliveryProvider`     VARCHAR(30) NULL,
  `deliveryMessageId`    VARCHAR(160) NULL,
  `supersededAt`         DATETIME(3) NULL,
  `createdAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_master_folio_pro_forma_number_key` (`number`),
  UNIQUE KEY `nrms_master_folio_pro_forma_publicToken_key` (`publicToken`),
  UNIQUE KEY `nrms_master_folio_pro_forma_masterFolioId_revision_key` (`masterFolioId`, `revision`),
  KEY `nrms_master_folio_pro_forma_masterFolioId_status_createdAt_idx` (`masterFolioId`, `status`, `createdAt`),
  KEY `nrms_master_folio_pro_forma_contactEmail_sentAt_idx` (`contactEmail`, `sentAt`),
  KEY `nrms_master_folio_pro_forma_createdById_fkey` (`createdById`),
  KEY `nrms_master_folio_pro_forma_sentById_fkey` (`sentById`),

  CONSTRAINT `nrms_master_folio_pro_forma_masterFolioId_fkey`
    FOREIGN KEY (`masterFolioId`) REFERENCES `nrms_master_folio` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_pro_forma_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_pro_forma_sentById_fkey`
    FOREIGN KEY (`sentById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
