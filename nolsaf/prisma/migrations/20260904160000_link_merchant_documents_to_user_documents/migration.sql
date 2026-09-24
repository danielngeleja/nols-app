-- Link merchant application documents to the owner's existing KYC uploads.
--
-- WHY
-- Owners already upload BUSINESS_LICENCE and TIN_CERTIFICATE through the
-- ordinary Owner Workspace, into `userdocument`. That table owns the storage,
-- the trusted-URL checks in lib/userDocumentSecurity.ts and the per-role
-- allowed types. A merchant application should therefore LINK to that record
-- rather than hold a second copy: two copies of the same passport is two
-- things to secure, two to expire, and two to fall out of step.
--
-- `storageKey` becomes nullable because a linked document's location belongs
-- to `userdocument.url` and is deliberately not duplicated here. It stays on
-- the table for a document sourced outside the Owner Workspace, which nothing
-- does today.
--
-- SAFETY
-- Additive and widening only: one nullable column, one NOT NULL to NULL
-- relaxation, one index, one foreign key. No column is dropped and no data is
-- rewritten. `merchant_application_document` has no rows at the time of this
-- migration, since no write path to it exists yet, so the MODIFY cannot
-- conflict with existing values.
--
-- The foreign key is ON DELETE SET NULL rather than CASCADE on purpose: an
-- owner deleting an upload must not silently delete the evidence record of
-- what was attached to a reviewed application.
--
-- NOT YET APPLIED to any shared database.

-- AlterTable
ALTER TABLE `merchant_application_document` ADD COLUMN `userDocumentId` INTEGER NULL,
    MODIFY `storageKey` VARCHAR(400) NULL;

-- CreateIndex
CREATE INDEX `merchant_application_document_userDocumentId_idx` ON `merchant_application_document`(`userDocumentId`);

-- AddForeignKey
ALTER TABLE `merchant_application_document` ADD CONSTRAINT `merchant_application_document_userDocumentId_fkey` FOREIGN KEY (`userDocumentId`) REFERENCES `userdocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
