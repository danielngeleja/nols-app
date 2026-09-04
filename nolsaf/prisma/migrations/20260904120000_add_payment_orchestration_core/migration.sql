-- Payment orchestration core (provider-neutral). Phase 1 of
-- docs/private/NRMS_PAYMENT_ORCHESTRATION.md.
--
-- WHY THIS EXISTS
-- Every AzamPay collection that predates this migration settles money that is
-- NoLSAF's own: marketplace invoices, tour bookings, group deposits (which
-- equal the NoLSAF commission) and NRMS service fees. That is why they all
-- share one global merchant identity, `AZAMPAY_APP_NAME`.
--
-- Owner money cannot use that identity. When a guest pays a lodge for a room,
-- a bar tab or a folio, the owner is the merchant of record and the money must
-- reach the owner's own provider wallet without first entering a NoLSAF-held
-- account. These 19 tables are the domain that makes that expressible.
--
-- PURELY ADDITIVE AND INERT
-- 19 CREATE TABLE plus their foreign keys. No existing table is altered, no
-- column is dropped, no data is moved or backfilled. `user`, `property` and
-- `nrms_outlet` gain only inbound foreign keys from the new tables; their own
-- definitions are untouched, because a Prisma back-relation is virtual and
-- creates no column.
--
-- Nothing reads these tables on arrival. The orchestration routes ship behind
-- a disabled feature flag in a later phase, so applying this migration changes
-- no current behaviour and is safe to apply ahead of the code that uses it,
-- which is the expand step of the expand-and-contract rule in
-- docs/ENGINEERING_DELIVERY_POLICY.md section 7.
--
-- updatedAt CARRIES NO DATABASE DEFAULT
-- Deliberate, and not an omission. `@updatedAt` is Prisma-managed in this
-- repository. The fiscal tables originally shipped with
-- ON UPDATE CURRENT_TIMESTAMP(3) and drifted from schema.prisma, which is what
-- migration 20260829210000_reconcile_nrms_fiscal_updated_at_defaults exists to
-- undo. This migration follows the reconciled convention so it does not
-- reintroduce that drift.
--
-- Per-table and per-column rationale lives in the /// doc comments on each
-- model in prisma/schema.prisma rather than being duplicated here.
--
-- NOT YET APPLIED to any database. Application to staging requires Daniel's
-- explicit approval for this specific migration.

-- CreateTable
CREATE TABLE `merchant_legal_entity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `administeredById` INTEGER NOT NULL,
    `legalName` VARCHAR(200) NOT NULL,
    `tradingName` VARCHAR(200) NULL,
    `registrationNumber` VARCHAR(60) NULL,
    `tin` VARCHAR(20) NULL,
    `country` VARCHAR(2) NOT NULL DEFAULT 'TZ',
    `contactEmail` VARCHAR(180) NULL,
    `contactPhone` VARCHAR(20) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `statusReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_legal_entity_administeredById_status_idx`(`administeredById`, `status`),
    INDEX `merchant_legal_entity_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_property_link` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER NOT NULL,
    `propertyId` INTEGER NOT NULL,
    `outletId` INTEGER NULL,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `activeScopeKey` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_property_link_activeScopeKey_key`(`activeScopeKey`),
    INDEX `merchant_property_link_merchantId_idx`(`merchantId`),
    INDEX `merchant_property_link_propertyId_outletId_idx`(`propertyId`, `outletId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_connection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(30) NOT NULL,
    `environment` VARCHAR(20) NOT NULL,
    `displayName` VARCHAR(80) NOT NULL,
    `capabilities` JSON NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `provider_connection_provider_environment_key`(`provider`, `environment`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_provider_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER NOT NULL,
    `connectionId` INTEGER NOT NULL,
    `providerMerchantId` VARCHAR(120) NULL,
    `providerAccountRef` VARCHAR(120) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'NOT_SUBSCRIBED',
    `statusReason` VARCHAR(300) NULL,
    `activatedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_provider_account_status_idx`(`status`),
    INDEX `merchant_provider_account_providerMerchantId_idx`(`providerMerchantId`),
    UNIQUE INDEX `merchant_provider_account_merchantId_connectionId_key`(`merchantId`, `connectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_wallet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerAccountId` INTEGER NOT NULL,
    `providerWalletId` VARCHAR(120) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_wallet_providerAccountId_isActive_idx`(`providerAccountId`, `isActive`),
    UNIQUE INDEX `merchant_wallet_providerAccountId_providerWalletId_currency_key`(`providerAccountId`, `providerWalletId`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_channel_capability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerAccountId` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `enabledAt` DATETIME(3) NULL,
    `disabledReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `merchant_channel_capability_providerAccountId_channel_key`(`providerAccountId`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_application` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER NOT NULL,
    `connectionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    `payloadHash` VARCHAR(128) NULL,
    `frozenAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `providerSubmissionRef` VARCHAR(120) NULL,
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `decisionReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_application_status_idx`(`status`),
    UNIQUE INDEX `merchant_application_merchantId_connectionId_version_key`(`merchantId`, `connectionId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_application_document` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `documentType` VARCHAR(40) NOT NULL,
    `issuingCountry` VARCHAR(2) NULL,
    `expiresAt` DATETIME(3) NULL,
    `storageKey` VARCHAR(400) NOT NULL,
    `verificationState` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `rejectionCode` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `merchant_application_document_applicationId_verificationStat_idx`(`applicationId`, `verificationState`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_acceptance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merchantId` INTEGER NOT NULL,
    `acceptedByUserId` INTEGER NOT NULL,
    `policyId` VARCHAR(60) NOT NULL,
    `policyVersion` VARCHAR(20) NOT NULL,
    `contentHash` VARCHAR(128) NOT NULL,
    `scopePropertyId` INTEGER NULL,
    `ipAddress` VARCHAR(60) NULL,
    `userAgent` VARCHAR(300) NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `supersededAt` DATETIME(3) NULL,

    INDEX `policy_acceptance_merchantId_policyId_supersededAt_idx`(`merchantId`, `policyId`, `supersededAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_intent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference` VARCHAR(40) NOT NULL,
    `idempotencyKey` VARCHAR(120) NOT NULL,
    `merchantId` INTEGER NOT NULL,
    `providerAccountId` INTEGER NULL,
    `walletId` INTEGER NULL,
    `propertyId` INTEGER NULL,
    `purpose` VARCHAR(30) NOT NULL,
    `sourceType` VARCHAR(40) NOT NULL,
    `sourceId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    `routingSnapshot` JSON NULL,
    `businessDate` DATE NULL,
    `shiftId` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `settledAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_intent_reference_key`(`reference`),
    UNIQUE INDEX `payment_intent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `payment_intent_merchantId_status_idx`(`merchantId`, `status`),
    INDEX `payment_intent_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `payment_intent_propertyId_businessDate_idx`(`propertyId`, `businessDate`),
    INDEX `payment_intent_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_attempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intentId` INTEGER NOT NULL,
    `connectionId` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `providerRef` VARCHAR(120) NULL,
    `normalizedStatus` VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    `providerStatus` VARCHAR(80) NULL,
    `requestHash` VARCHAR(128) NULL,
    `checkoutUrl` VARCHAR(2048) NULL,
    `payerMasked` VARCHAR(40) NULL,
    `failureCode` VARCHAR(60) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `payment_attempt_providerRef_key`(`providerRef`),
    INDEX `payment_attempt_intentId_normalizedStatus_idx`(`intentId`, `normalizedStatus`),
    INDEX `payment_attempt_normalizedStatus_startedAt_idx`(`normalizedStatus`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_allocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intentId` INTEGER NOT NULL,
    `targetType` VARCHAR(30) NOT NULL,
    `targetId` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `reversedAt` DATETIME(3) NULL,
    `reversesAllocationId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_allocation_intentId_targetType_idx`(`intentId`, `targetType`),
    INDEX `payment_allocation_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_event_inbox` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connectionId` INTEGER NOT NULL,
    `providerEventId` VARCHAR(160) NOT NULL,
    `eventType` VARCHAR(60) NOT NULL,
    `signatureVerified` BOOLEAN NOT NULL DEFAULT false,
    `providerOccurredAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `payloadDigest` VARCHAR(128) NOT NULL,
    `rawPayload` JSON NULL,
    `processingState` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `processedAt` DATETIME(3) NULL,
    `reviewReason` VARCHAR(300) NULL,
    `matchedIntentId` INTEGER NULL,

    INDEX `provider_event_inbox_processingState_receivedAt_idx`(`processingState`, `receivedAt`),
    INDEX `provider_event_inbox_matchedIntentId_idx`(`matchedIntentId`),
    UNIQUE INDEX `provider_event_inbox_connectionId_providerEventId_key`(`connectionId`, `providerEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_settlement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerAccountId` INTEGER NOT NULL,
    `walletId` INTEGER NULL,
    `providerSettlementRef` VARCHAR(120) NOT NULL,
    `grossAmount` DECIMAL(14, 2) NOT NULL,
    `feeAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `refundAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `settlementDate` DATE NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `rawReport` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `provider_settlement_settlementDate_status_idx`(`settlementDate`, `status`),
    UNIQUE INDEX `provider_settlement_providerAccountId_providerSettlementRef_key`(`providerAccountId`, `providerSettlementRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_refund` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intentId` INTEGER NOT NULL,
    `reference` VARCHAR(40) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `reason` VARCHAR(300) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    `providerRefundRef` VARCHAR(120) NULL,
    `requestedById` INTEGER NULL,
    `approvedById` INTEGER NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `payment_refund_reference_key`(`reference`),
    UNIQUE INDEX `payment_refund_providerRefundRef_key`(`providerRefundRef`),
    INDEX `payment_refund_intentId_status_idx`(`intentId`, `status`),
    INDEX `payment_refund_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_dispute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intentId` INTEGER NOT NULL,
    `providerDisputeRef` VARCHAR(120) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `outcome` VARCHAR(60) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,

    UNIQUE INDEX `payment_dispute_providerDisputeRef_key`(`providerDisputeRef`),
    INDEX `payment_dispute_intentId_status_idx`(`intentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_outbox_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobType` VARCHAR(50) NOT NULL,
    `targetType` VARCHAR(40) NOT NULL,
    `targetId` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(120) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` VARCHAR(500) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_outbox_job_idempotencyKey_key`(`idempotencyKey`),
    INDEX `payment_outbox_job_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `payment_outbox_job_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_routing_rule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scopeType` VARCHAR(20) NOT NULL,
    `scopeId` INTEGER NULL,
    `purpose` VARCHAR(30) NULL,
    `currency` VARCHAR(3) NULL,
    `channel` VARCHAR(20) NULL,
    `connectionId` INTEGER NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_routing_rule_scopeType_scopeId_isActive_priority_idx`(`scopeType`, `scopeId`, `isActive`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_audit_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `action` VARCHAR(60) NOT NULL,
    `actorKind` VARCHAR(20) NOT NULL DEFAULT 'USER',
    `actorUserId` INTEGER NULL,
    `previousState` VARCHAR(40) NULL,
    `nextState` VARCHAR(40) NULL,
    `reason` VARCHAR(300) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `merchant_audit_event_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `merchant_audit_event_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchant_legal_entity` ADD CONSTRAINT `merchant_legal_entity_administeredById_fkey` FOREIGN KEY (`administeredById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_property_link` ADD CONSTRAINT `merchant_property_link_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchant_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_property_link` ADD CONSTRAINT `merchant_property_link_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_property_link` ADD CONSTRAINT `merchant_property_link_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `nrms_outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_provider_account` ADD CONSTRAINT `merchant_provider_account_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchant_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_provider_account` ADD CONSTRAINT `merchant_provider_account_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `provider_connection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_wallet` ADD CONSTRAINT `merchant_wallet_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `merchant_provider_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_channel_capability` ADD CONSTRAINT `merchant_channel_capability_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `merchant_provider_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_application` ADD CONSTRAINT `merchant_application_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchant_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_application` ADD CONSTRAINT `merchant_application_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `provider_connection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_application` ADD CONSTRAINT `merchant_application_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_application_document` ADD CONSTRAINT `merchant_application_document_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `merchant_application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_acceptance` ADD CONSTRAINT `policy_acceptance_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchant_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_acceptance` ADD CONSTRAINT `policy_acceptance_acceptedByUserId_fkey` FOREIGN KEY (`acceptedByUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intent` ADD CONSTRAINT `payment_intent_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `merchant_legal_entity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intent` ADD CONSTRAINT `payment_intent_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `merchant_provider_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intent` ADD CONSTRAINT `payment_intent_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `merchant_wallet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_intent` ADD CONSTRAINT `payment_intent_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_attempt` ADD CONSTRAINT `payment_attempt_intentId_fkey` FOREIGN KEY (`intentId`) REFERENCES `payment_intent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_attempt` ADD CONSTRAINT `payment_attempt_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `provider_connection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocation` ADD CONSTRAINT `payment_allocation_intentId_fkey` FOREIGN KEY (`intentId`) REFERENCES `payment_intent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_allocation` ADD CONSTRAINT `payment_allocation_reversesAllocationId_fkey` FOREIGN KEY (`reversesAllocationId`) REFERENCES `payment_allocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_event_inbox` ADD CONSTRAINT `provider_event_inbox_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `provider_connection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_event_inbox` ADD CONSTRAINT `provider_event_inbox_matchedIntentId_fkey` FOREIGN KEY (`matchedIntentId`) REFERENCES `payment_intent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_settlement` ADD CONSTRAINT `provider_settlement_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `merchant_provider_account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_settlement` ADD CONSTRAINT `provider_settlement_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `merchant_wallet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_refund` ADD CONSTRAINT `payment_refund_intentId_fkey` FOREIGN KEY (`intentId`) REFERENCES `payment_intent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_refund` ADD CONSTRAINT `payment_refund_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_refund` ADD CONSTRAINT `payment_refund_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_dispute` ADD CONSTRAINT `payment_dispute_intentId_fkey` FOREIGN KEY (`intentId`) REFERENCES `payment_intent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_routing_rule` ADD CONSTRAINT `payment_routing_rule_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `provider_connection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_audit_event` ADD CONSTRAINT `merchant_audit_event_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

