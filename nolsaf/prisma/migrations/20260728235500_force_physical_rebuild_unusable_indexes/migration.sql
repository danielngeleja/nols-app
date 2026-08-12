-- Migration 20260728230000 used DROP INDEX and ADD INDEX in the same ALTER
-- statement. MariaDB optimized those pairs without physically rebuilding the
-- unusable indexes. Separate DDL statements force each index to be recreated.

ALTER TABLE `adminotp` DROP INDEX `adminotp_usedAt_idx`;
ALTER TABLE `adminotp` ADD INDEX `adminotp_usedAt_idx` (`usedAt`);

ALTER TABLE `agent` DROP INDEX `agent_userId_key`;
ALTER TABLE `agent` ADD UNIQUE INDEX `agent_userId_key` (`userId`);

ALTER TABLE `auditlog` DROP INDEX `auditlog_entity_entityId_idx`;
ALTER TABLE `auditlog` ADD INDEX `auditlog_entity_entityId_idx` (`entity`, `entityId`);

-- Keep a temporary userId index while rebuilding because the foreign key needs
-- a supporting index at every DDL boundary.
ALTER TABLE `emailverificationtoken` ADD INDEX `emailverificationtoken_userId_rebuild_tmp_idx` (`userId`);
ALTER TABLE `emailverificationtoken` DROP INDEX `emailverificationtoken_userId_idx`;
ALTER TABLE `emailverificationtoken` ADD INDEX `emailverificationtoken_userId_idx` (`userId`);
ALTER TABLE `emailverificationtoken` DROP INDEX `emailverificationtoken_userId_rebuild_tmp_idx`;

ALTER TABLE `invoice` DROP INDEX `invoice_status_issuedAt_idx`;
ALTER TABLE `invoice` ADD INDEX `invoice_status_issuedAt_idx` (`status`, `issuedAt`);

ALTER TABLE `job` DROP INDEX `job_type_idx`;
ALTER TABLE `job` ADD INDEX `job_type_idx` (`type`);

ALTER TABLE `notification` DROP INDEX `notification_userId_unread_idx`;
ALTER TABLE `notification` ADD INDEX `notification_userId_unread_idx` (`userId`, `unread`);

-- Keep a temporary userId index while rebuilding because the foreign key needs
-- a supporting index at every DDL boundary.
ALTER TABLE `passkey` ADD INDEX `passkey_userId_rebuild_tmp_idx` (`userId`);
ALTER TABLE `passkey` DROP INDEX `passkey_userId_idx`;
ALTER TABLE `passkey` ADD INDEX `passkey_userId_idx` (`userId`);
ALTER TABLE `passkey` DROP INDEX `passkey_userId_rebuild_tmp_idx`;

ALTER TABLE `propertyavailabilityblock` DROP INDEX `propertyavailabilityblock_startDate_endDate_idx`;
ALTER TABLE `propertyavailabilityblock` ADD INDEX `propertyavailabilityblock_startDate_endDate_idx` (`startDate`, `endDate`);

ALTER TABLE `savedproperty` DROP INDEX `savedproperty_userId_propertyId_key`;
ALTER TABLE `savedproperty` ADD UNIQUE INDEX `savedproperty_userId_propertyId_key` (`userId`, `propertyId`);

ALTER TABLE `tourismsite` DROP INDEX `tourismsite_slug_key`;
ALTER TABLE `tourismsite` ADD UNIQUE INDEX `tourismsite_slug_key` (`slug`);

ALTER TABLE `transportbooking` DROP INDEX `transportbooking_vehicleType_idx`;
ALTER TABLE `transportbooking` ADD INDEX `transportbooking_vehicleType_idx` (`vehicleType`);

-- Keep a temporary transportBookingId index while rebuilding because the
-- foreign key needs a supporting index at every DDL boundary.
ALTER TABLE `transportmessage` ADD INDEX `transportmessage_transportBookingId_rebuild_tmp_idx` (`transportBookingId`);
ALTER TABLE `transportmessage` DROP INDEX `transportmessage_transportBookingId_createdAt_idx`;
ALTER TABLE `transportmessage` ADD INDEX `transportmessage_transportBookingId_createdAt_idx` (`transportBookingId`, `createdAt`);
ALTER TABLE `transportmessage` DROP INDEX `transportmessage_transportBookingId_rebuild_tmp_idx`;
