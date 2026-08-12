-- Actual agency refunds are separate from payment receipts so neither side of
-- the cash movement is rewritten or lost from the audit trail.
CREATE TABLE `nrms_master_folio_refund` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `masterFolioId` INT NOT NULL,
  `amount`        DECIMAL(12, 2) NOT NULL,
  `currency`      VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `method`        VARCHAR(30) NOT NULL,
  `reference`     VARCHAR(120) NULL,
  `refundNumber`  VARCHAR(40) NOT NULL,
  `reason`        VARCHAR(300) NOT NULL,
  `recordedById`  INT NULL,
  `voidedAt`      DATETIME(3) NULL,
  `voidReason`    VARCHAR(300) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_master_folio_refund_refundNumber_key` (`refundNumber`),
  KEY `nrms_master_folio_refund_masterFolioId_createdAt_idx` (`masterFolioId`, `createdAt`),
  KEY `nrms_master_folio_refund_method_idx` (`method`),
  KEY `nrms_master_folio_refund_recordedById_fkey` (`recordedById`),

  CONSTRAINT `nrms_master_folio_refund_masterFolioId_fkey`
    FOREIGN KEY (`masterFolioId`) REFERENCES `nrms_master_folio` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_master_folio_refund_recordedById_fkey`
    FOREIGN KEY (`recordedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
