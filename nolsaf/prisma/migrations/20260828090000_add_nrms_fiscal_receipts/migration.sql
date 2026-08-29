-- Owner-activated TRA fiscal receipting (VFD). See docs/NRMS_FISCAL_RECEIPTS.md.
--
-- Purely additive: three new tables and no change to any existing one. A
-- property with no `nrms_fiscal_connection` row behaves exactly as it does
-- today, which is every property at the time of this migration and the
-- permanent state of most of them. Guesthouses below the VAT threshold are not
-- required to fiscalise, so this is opt-in per property and stays off unless an
-- owner switches it on.
--
-- NoLSAF is not the taxpayer. The property registers with TRA under its own TIN
-- and VRN and NRMS transmits on that registration, so credentials are held per
-- property and there is no shared platform secret anywhere in this schema.

-- The property's TRA registration and the state of its connection.
CREATE TABLE `nrms_fiscal_connection` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `propertyId` INT NOT NULL,
  -- Regime is carried from day one so a second country does not need a rewrite,
  -- even though only TZ_TRA is implemented.
  `regime`     VARCHAR(20) NOT NULL DEFAULT 'TZ_TRA',
  -- OFF, ON_REQUEST, ALWAYS. OFF is the default and the no-op state.
  `mode`       VARCHAR(20) NOT NULL DEFAULT 'OFF',
  -- DISABLED, PENDING, VALIDATED, ACTIVE, FAILED, SUSPENDED.
  `status`     VARCHAR(20) NOT NULL DEFAULT 'DISABLED',

  -- Taxpayer identity. Not secret: printed on every receipt.
  `tin`          VARCHAR(20) NULL,
  `vrn`          VARCHAR(20) NULL,
  `businessName` VARCHAR(180) NULL,
  `taxOffice`    VARCHAR(120) NULL,

  -- Issued by TRA at registration, required on every document afterwards.
  `regId`        VARCHAR(60) NULL,
  `receiptCode`  VARCHAR(40) NULL,
  `serialNumber` VARCHAR(60) NULL,

  -- Counters TRA validates and we generate. Global starts at 1, never resets,
  -- and always equals the receipt number. Daily resets at CALENDAR midnight,
  -- deliberately not at business-day close: a sale rung at 01:30 belongs to
  -- yesterday's business day and to today's fiscal day, and both are true.
  `globalCounter`    INT NOT NULL DEFAULT 0,
  `dailyCounter`     INT NOT NULL DEFAULT 0,
  `dailyCounterDate` DATE NULL,
  `lastZReportDate`  DATE NULL,

  -- Switching on or off lands on a business-day boundary so no day closes half
  -- fiscalised. Stored as a date, not a business-day id, so the intent survives
  -- that row being reopened or recreated.
  `activatesOnBusinessDate`   DATE NULL,
  `deactivatesOnBusinessDate` DATE NULL,

  `lastSuccessAt` DATETIME(3) NULL,
  `lastErrorAt`   DATETIME(3) NULL,
  `lastError`     VARCHAR(1000) NULL,
  -- Set when a failure first survives a cashier-shift boundary. Drives the
  -- undismissable banner; cleared on the next success.
  `escalatedAt`   DATETIME(3) NULL,

  -- The owner accepts that they are the taxpayer of record and NoLSAF only
  -- transmits. Recorded, not assumed.
  `acknowledgedAt`         DATETIME(3) NULL,
  `acknowledgedById`       INT NULL,
  `acknowledgementVersion` VARCHAR(20) NULL,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_fiscal_connection_propertyId_key` (`propertyId`),
  KEY `nrms_fiscal_connection_status_mode_idx` (`status`, `mode`),
  CONSTRAINT `nrms_fiscal_connection_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_fiscal_connection_acknowledgedById_fkey`
    FOREIGN KEY (`acknowledgedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Versioned encrypted credentials, staged then activated, same shape as
-- channel_credential_version so rotation behaves the way it already does there.
CREATE TABLE `nrms_fiscal_credential_version` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `version`      INT NOT NULL,
  -- STAGED, ACTIVE, REVOKED.
  `status`       VARCHAR(20) NOT NULL DEFAULT 'STAGED',

  -- AES-256-GCM (apps/api/src/lib/crypto.ts) over JSON holding the token-grant
  -- username and password AND the PKCS12 bundle plus its passphrase. Every TRA
  -- document is signed with that private key, so the certificate is a
  -- credential, not a setting. Never returned by any endpoint.
  `encryptedData` TEXT NOT NULL,

  -- UNTESTED, VALIDATED, FAILED.
  `validationStatus` VARCHAR(20) NOT NULL DEFAULT 'UNTESTED',
  `validatedAt`      DATETIME(3) NULL,
  `validationError`  VARCHAR(500) NULL,
  -- Signing certificate expiry, so the health strip warns before it lapses
  -- rather than after receipts start failing.
  `expiresAt`        DATETIME(3) NULL,
  `activatedAt`      DATETIME(3) NULL,
  `revokedAt`        DATETIME(3) NULL,
  `createdById`      INT NULL,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `nrms_fiscal_credential_version_connectionId_version_key` (`connectionId`, `version`),
  KEY `nrms_fiscal_credential_version_connectionId_status_idx` (`connectionId`, `status`),
  CONSTRAINT `nrms_fiscal_credential_version_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `nrms_fiscal_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_fiscal_credential_version_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One fiscalisation attempt and its outcome. Created at settle, delivered by a
-- worker: a guest at the counter cannot wait for night audit, and TRA's own
-- guidance is to keep transacting while offline and resend pending documents in
-- order once the connection returns.
CREATE TABLE `nrms_fiscal_receipt` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `propertyId`   INT NOT NULL,
  `connectionId` INT NOT NULL,

  -- Shared identity with the night-audit ledger posting for the same money
  -- movement, e.g. 'PAYMENT:12:3391' or 'OUTLET:12:8842'. The two systems can be
  -- reconciled without either knowing about the other.
  `sourceKey`  VARCHAR(100) NOT NULL,
  `sourceType` VARCHAR(40) NOT NULL,
  `sourceId`   INT NULL,

  -- RECEIPT, CREDIT_NOTE.
  `kind`   VARCHAR(20) NOT NULL DEFAULT 'RECEIPT',
  -- PENDING, SENDING, CONFIRMED, FAILED, DEAD_LETTER, BURNED.
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',

  -- Allocated inside the committing transaction. receiptNumber equals
  -- globalCounter by TRA's rule; both are stored because the document carries
  -- them as separate fields.
  `receiptNumber` INT NOT NULL,
  `globalCounter` INT NOT NULL,
  `dailyCounter`  INT NOT NULL,
  -- Calendar day the counters belong to. Not the business date.
  `fiscalDate`    DATE NOT NULL,

  -- When the money actually moved, which is not the issue date when a guest
  -- returns on Wednesday for Monday's receipt.
  `saleOccurredAt` DATETIME(3) NOT NULL,
  -- When TRA confirmed it.
  `issuedAt`       DATETIME(3) NULL,

  `currency`     VARCHAR(3) NOT NULL DEFAULT 'TZS',
  `grossAmount`  DECIMAL(12, 2) NOT NULL,
  `taxAmount`    DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `taxBreakdown` JSON NULL,
  -- The document we built, signature and secrets excluded.
  `payload`      JSON NULL,

  -- Returned by TRA. verificationUrl is what the printed QR encodes; the QR
  -- image is generated by us, TRA does not supply one.
  `fiscalReceiptNumber` VARCHAR(60) NULL,
  `verificationCode`    VARCHAR(80) NULL,
  `verificationUrl`     VARCHAR(500) NULL,
  `signature`           TEXT NULL,
  -- Digest only. Raw provider payloads are not retained, matching the decision
  -- already taken for channel reservations.
  `responseDigest`      VARCHAR(64) NULL,

  `attemptCount`  INT NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NULL,
  `lastAttemptAt` DATETIME(3) NULL,
  `lastError`     VARCHAR(1000) NULL,
  -- Why a number was consumed without a document being issued. TRA forbids
  -- reusing it, so the burn is recorded rather than hidden.
  `burnReason`    VARCHAR(300) NULL,

  `replacesReceiptId` INT NULL,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- One fiscal document per money movement, enforced by the database rather
  -- than by remembering to check.
  UNIQUE KEY `nrms_fiscal_receipt_propertyId_sourceKey_kind_key` (`propertyId`, `sourceKey`, `kind`),
  -- The counter series cannot fork, even under concurrent settlements.
  UNIQUE KEY `nrms_fiscal_receipt_connectionId_globalCounter_key` (`connectionId`, `globalCounter`),
  KEY `nrms_fiscal_receipt_connectionId_status_nextAttemptAt_idx` (`connectionId`, `status`, `nextAttemptAt`),
  KEY `nrms_fiscal_receipt_propertyId_fiscalDate_idx` (`propertyId`, `fiscalDate`),
  KEY `nrms_fiscal_receipt_replacesReceiptId_idx` (`replacesReceiptId`),
  CONSTRAINT `nrms_fiscal_receipt_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `nrms_fiscal_receipt_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `nrms_fiscal_connection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A credit note points at the receipt it reverses, so this one is
-- self-referencing. Added after the table rather than inline: no other migration
-- in this repository does a self-reference, and this is the form Prisma itself
-- emits for it.
ALTER TABLE `nrms_fiscal_receipt`
  ADD CONSTRAINT `nrms_fiscal_receipt_replacesReceiptId_fkey`
    FOREIGN KEY (`replacesReceiptId`) REFERENCES `nrms_fiscal_receipt` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
