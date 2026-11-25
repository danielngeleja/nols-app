-- Long-stay tenant ID to international standards (docs/LONG_STAY_RENTALS.md, decision 10).
--
-- Passports (ICAO 9303), national ID cards and Tanzania residence permits,
-- with the expiry date, the holder's name and date of birth as printed, the
-- nationality (ISO 3166-1 alpha-2), the back of a card and a selfie holding
-- the document. The full ID number is still never stored.
-- Runs on MySQL 8 and MariaDB 11.8. Apply after 20261121110000.

-- AlterTable
ALTER TABLE `long_stay_tenant_profile`
    ADD COLUMN `idExpiresOn` DATE NULL,
    ADD COLUMN `holderName` VARCHAR(120) NULL,
    ADD COLUMN `dateOfBirth` DATE NULL,
    ADD COLUMN `nationality` VARCHAR(2) NULL,
    ADD COLUMN `documentBackId` INTEGER NULL,
    ADD COLUMN `selfieDocumentId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `long_stay_tenant_profile_status_idExpiresOn_idx` ON `long_stay_tenant_profile`(`status`, `idExpiresOn`);

-- CreateIndex
CREATE INDEX `long_stay_tenant_profile_documentBackId_idx` ON `long_stay_tenant_profile`(`documentBackId`);

-- CreateIndex
CREATE INDEX `long_stay_tenant_profile_selfieDocumentId_idx` ON `long_stay_tenant_profile`(`selfieDocumentId`);

-- AddForeignKey
ALTER TABLE `long_stay_tenant_profile` ADD CONSTRAINT `long_stay_tenant_profile_documentBackId_fkey` FOREIGN KEY (`documentBackId`) REFERENCES `userdocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `long_stay_tenant_profile` ADD CONSTRAINT `long_stay_tenant_profile_selfieDocumentId_fkey` FOREIGN KEY (`selfieDocumentId`) REFERENCES `userdocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
