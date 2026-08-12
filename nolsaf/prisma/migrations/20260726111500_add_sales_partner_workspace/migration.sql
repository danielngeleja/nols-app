-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `salesMarketplaceRevenuePercent` DECIMAL(5, 2) NULL DEFAULT 20.00,
    ADD COLUMN `salesNrmsCommissionPercent` DECIMAL(5, 2) NULL DEFAULT 14.00;

-- CreateTable
CREATE TABLE `user_workspace_access` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `workspace` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `grantedById` INTEGER NULL,
    `grantedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedById` INTEGER NULL,
    `statusReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_workspace_access_workspace_status_idx`(`workspace`, `status`),
    INDEX `user_workspace_access_status_expiresAt_idx`(`status`, `expiresAt`),
    UNIQUE INDEX `user_workspace_access_userId_workspace_key`(`userId`, `workspace`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_partner_profile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `agentCode` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `level` VARCHAR(30) NOT NULL DEFAULT 'STARTER',
    `region` VARCHAR(120) NULL,
    `territory` VARCHAR(200) NULL,
    `phone` VARCHAR(40) NULL,
    `payoutName` VARCHAR(160) NULL,
    `payoutMethod` VARCHAR(40) NULL,
    `payoutAccount` VARCHAR(80) NULL,
    `activatedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `terminatedAt` DATETIME(3) NULL,
    `levelUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_partner_profile_userId_key`(`userId`),
    UNIQUE INDEX `sales_partner_profile_agentCode_key`(`agentCode`),
    INDEX `sales_partner_profile_status_idx`(`status`),
    INDEX `sales_partner_profile_level_idx`(`level`),
    INDEX `sales_partner_profile_region_idx`(`region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_partner_contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `contractNumber` VARCHAR(40) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `startsAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `nrmsCommissionRate` DECIMAL(5, 2) NOT NULL,
    `marketplaceRevenueRate` DECIMAL(5, 2) NOT NULL,
    `territory` VARCHAR(200) NULL,
    `contractFileUrl` VARCHAR(500) NULL,
    `contractVersion` VARCHAR(20) NULL,
    `renderedContractBody` LONGTEXT NULL,
    `renderedFieldSnapshot` JSON NULL,
    `acceptedTermsHash` VARCHAR(64) NULL,
    `renderedBodyHash` VARCHAR(64) NULL,
    `pdfSha256` VARCHAR(64) NULL,
    `sentAt` DATETIME(3) NULL,
    `viewedAt` DATETIME(3) NULL,
    `signedAt` DATETIME(3) NULL,
    `activatedAt` DATETIME(3) NULL,
    `terminatedAt` DATETIME(3) NULL,
    `acceptedIpAddress` VARCHAR(64) NULL,
    `acceptedUserAgent` VARCHAR(255) NULL,
    `acceptanceHash` VARCHAR(128) NULL,
    `acceptedName` VARCHAR(160) NULL,
    `reminder60SentAt` DATETIME(3) NULL,
    `reminder30SentAt` DATETIME(3) NULL,
    `reminder7SentAt` DATETIME(3) NULL,
    `renewedByContractId` INTEGER NULL,
    `terminationReason` VARCHAR(300) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_partner_contract_contractNumber_key`(`contractNumber`),
    INDEX `sales_partner_contract_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_partner_contract_expiresAt_idx`(`expiresAt`),
    INDEX `sales_partner_contract_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_lead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `propertyName` VARCHAR(200) NOT NULL,
    `propertyNameNormalized` VARCHAR(200) NOT NULL,
    `contactPerson` VARCHAR(160) NULL,
    `contactPhone` VARCHAR(40) NULL,
    `contactPhoneNormalized` VARCHAR(40) NULL,
    `contactEmail` VARCHAR(190) NULL,
    `contactEmailNormalized` VARCHAR(190) NULL,
    `location` VARCHAR(200) NULL,
    `locationNormalized` VARCHAR(200) NULL,
    `region` VARCHAR(120) NULL,
    `propertyType` VARCHAR(60) NULL,
    `estimatedRooms` INTEGER NULL,
    `registrationNumber` VARCHAR(80) NULL,
    `registrationNumberNormalized` VARCHAR(80) NULL,
    `taxNumber` VARCHAR(80) NULL,
    `taxNumberNormalized` VARCHAR(80) NULL,
    `proposedProduct` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'NEW',
    `duplicateReviewStatus` VARCHAR(30) NOT NULL DEFAULT 'CLEAR',
    `duplicateEvidence` JSON NULL,
    `nextFollowUpAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `lostReason` VARCHAR(300) NULL,
    `protectionStartsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `protectionExpiresAt` DATETIME(3) NULL,
    `conversionRequestedAt` DATETIME(3) NULL,
    `convertedPropertyId` INTEGER NULL,
    `convertedAt` DATETIME(3) NULL,
    `convertedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_lead_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_lead_status_nextFollowUpAt_idx`(`status`, `nextFollowUpAt`),
    INDEX `sales_lead_contactPhoneNormalized_idx`(`contactPhoneNormalized`),
    INDEX `sales_lead_contactEmailNormalized_idx`(`contactEmailNormalized`),
    INDEX `sales_lead_propertyNameNormalized_idx`(`propertyNameNormalized`),
    INDEX `sales_lead_registrationNumberNormalized_idx`(`registrationNumberNormalized`),
    INDEX `sales_lead_taxNumberNormalized_idx`(`taxNumberNormalized`),
    INDEX `sales_lead_protectionExpiresAt_idx`(`protectionExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_lead_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `description` TEXT NOT NULL,
    `fileUrl` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_lead_activity_leadId_createdAt_idx`(`leadId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `property_sales_attribution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `salesPartnerId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `contractId` INTEGER NULL,
    `productType` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attributedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `verifiedById` INTEGER NULL,
    `commissionStartsAt` DATETIME(3) NULL,
    `commissionEndsAt` DATETIME(3) NULL,
    `reassignedAt` DATETIME(3) NULL,
    `reassignedToPartnerId` INTEGER NULL,
    `revokedAt` DATETIME(3) NULL,
    `disputeReason` VARCHAR(300) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `property_sales_attribution_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `property_sales_attribution_status_productType_idx`(`status`, `productType`),
    UNIQUE INDEX `property_sales_attribution_propertyId_productType_key`(`propertyId`, `productType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_commission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `propertyId` INTEGER NULL,
    `attributionId` INTEGER NULL,
    `contractId` INTEGER NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `sourceKey` VARCHAR(120) NOT NULL,
    `sourceStatementId` INTEGER NULL,
    `sourceInvoiceId` INTEGER NULL,
    `sourceBookingId` INTEGER NULL,
    `grossAmount` DECIMAL(12, 2) NOT NULL,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `processingFeeAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `refundAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `eligibleNetRevenue` DECIMAL(12, 2) NOT NULL,
    `commissionRate` DECIMAL(5, 2) NOT NULL,
    `commissionAmount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `description` VARCHAR(300) NULL,
    `earnedAt` DATETIME(3) NOT NULL,
    `eligibleAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `availableAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversalOfId` INTEGER NULL,
    `reversalReason` VARCHAR(300) NULL,
    `adjustmentReason` VARCHAR(300) NULL,
    `approvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_commission_sourceKey_key`(`sourceKey`),
    INDEX `sales_commission_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_commission_salesPartnerId_earnedAt_idx`(`salesPartnerId`, `earnedAt`),
    INDEX `sales_commission_propertyId_type_idx`(`propertyId`, `type`),
    INDEX `sales_commission_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `sales_commission_sourceStatementId_idx`(`sourceStatementId`),
    INDEX `sales_commission_sourceInvoiceId_idx`(`sourceInvoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_payout_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesPartnerId` INTEGER NOT NULL,
    `referenceNumber` VARCHAR(40) NOT NULL,
    `requestedAmount` DECIMAL(12, 2) NOT NULL,
    `approvedAmount` DECIMAL(12, 2) NULL,
    `deductionAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netPaidAmount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `status` VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    `payoutMethod` VARCHAR(40) NOT NULL,
    `payoutName` VARCHAR(160) NOT NULL,
    `payoutAccount` VARCHAR(80) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `processedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `rejectionReason` VARCHAR(300) NULL,
    `paymentReference` VARCHAR(120) NULL,
    `receiptUrl` VARCHAR(500) NULL,
    `adminNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_payout_request_referenceNumber_key`(`referenceNumber`),
    INDEX `sales_payout_request_salesPartnerId_status_idx`(`salesPartnerId`, `status`),
    INDEX `sales_payout_request_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_payout_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payoutId` INTEGER NOT NULL,
    `commissionId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_payout_item_commissionId_key`(`commissionId`),
    INDEX `sales_payout_item_payoutId_idx`(`payoutId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_material` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(60) NOT NULL,
    `fileUrl` VARCHAR(500) NULL,
    `externalUrl` VARCHAR(500) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_material_category_isPublished_sortOrder_idx`(`category`, `isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_workspace_access` ADD CONSTRAINT `user_workspace_access_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_workspace_access` ADD CONSTRAINT `user_workspace_access_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_workspace_access` ADD CONSTRAINT `user_workspace_access_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_profile` ADD CONSTRAINT `sales_partner_profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_contract` ADD CONSTRAINT `sales_partner_contract_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_partner_contract` ADD CONSTRAINT `sales_partner_contract_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead` ADD CONSTRAINT `sales_lead_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead` ADD CONSTRAINT `sales_lead_convertedPropertyId_fkey` FOREIGN KEY (`convertedPropertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead` ADD CONSTRAINT `sales_lead_convertedById_fkey` FOREIGN KEY (`convertedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead_activity` ADD CONSTRAINT `sales_lead_activity_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `sales_lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_lead_activity` ADD CONSTRAINT `sales_lead_activity_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_sales_attribution` ADD CONSTRAINT `property_sales_attribution_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_sales_attribution` ADD CONSTRAINT `property_sales_attribution_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_sales_attribution` ADD CONSTRAINT `property_sales_attribution_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `sales_lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_sales_attribution` ADD CONSTRAINT `property_sales_attribution_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `sales_partner_contract`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `property_sales_attribution` ADD CONSTRAINT `property_sales_attribution_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_commission` ADD CONSTRAINT `sales_commission_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_commission` ADD CONSTRAINT `sales_commission_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_commission` ADD CONSTRAINT `sales_commission_attributionId_fkey` FOREIGN KEY (`attributionId`) REFERENCES `property_sales_attribution`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_commission` ADD CONSTRAINT `sales_commission_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `sales_partner_contract`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_commission` ADD CONSTRAINT `sales_commission_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_payout_request` ADD CONSTRAINT `sales_payout_request_salesPartnerId_fkey` FOREIGN KEY (`salesPartnerId`) REFERENCES `sales_partner_profile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_payout_request` ADD CONSTRAINT `sales_payout_request_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_payout_item` ADD CONSTRAINT `sales_payout_item_payoutId_fkey` FOREIGN KEY (`payoutId`) REFERENCES `sales_payout_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_payout_item` ADD CONSTRAINT `sales_payout_item_commissionId_fkey` FOREIGN KEY (`commissionId`) REFERENCES `sales_commission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_material` ADD CONSTRAINT `sales_material_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
