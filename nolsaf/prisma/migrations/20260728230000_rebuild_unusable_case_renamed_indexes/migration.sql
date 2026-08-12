-- Rebuild indexes that became unusable after the case-only index renames in
-- 20260714195920. Production verification returned MariaDB/InnoDB error 1030
-- whenever these indexes were selected. Each ALTER preserves the existing
-- index name, columns, ordering, and uniqueness; application data is unchanged.

ALTER TABLE `adminotp`
  DROP INDEX `adminotp_usedAt_idx`,
  ADD INDEX `adminotp_usedAt_idx` (`usedAt`);

ALTER TABLE `agent`
  DROP INDEX `agent_userId_key`,
  ADD UNIQUE INDEX `agent_userId_key` (`userId`);

ALTER TABLE `auditlog`
  DROP INDEX `auditlog_entity_entityId_idx`,
  ADD INDEX `auditlog_entity_entityId_idx` (`entity`, `entityId`);

ALTER TABLE `emailverificationtoken`
  DROP INDEX `emailverificationtoken_userId_idx`,
  ADD INDEX `emailverificationtoken_userId_idx` (`userId`);

ALTER TABLE `invoice`
  DROP INDEX `invoice_status_issuedAt_idx`,
  ADD INDEX `invoice_status_issuedAt_idx` (`status`, `issuedAt`);

ALTER TABLE `job`
  DROP INDEX `job_type_idx`,
  ADD INDEX `job_type_idx` (`type`);

ALTER TABLE `notification`
  DROP INDEX `notification_userId_unread_idx`,
  ADD INDEX `notification_userId_unread_idx` (`userId`, `unread`);

ALTER TABLE `passkey`
  DROP INDEX `passkey_userId_idx`,
  ADD INDEX `passkey_userId_idx` (`userId`);

ALTER TABLE `propertyavailabilityblock`
  DROP INDEX `propertyavailabilityblock_startDate_endDate_idx`,
  ADD INDEX `propertyavailabilityblock_startDate_endDate_idx` (`startDate`, `endDate`);

ALTER TABLE `savedproperty`
  DROP INDEX `savedproperty_userId_propertyId_key`,
  ADD UNIQUE INDEX `savedproperty_userId_propertyId_key` (`userId`, `propertyId`);

ALTER TABLE `tourismsite`
  DROP INDEX `tourismsite_slug_key`,
  ADD UNIQUE INDEX `tourismsite_slug_key` (`slug`);

ALTER TABLE `transportbooking`
  DROP INDEX `transportbooking_vehicleType_idx`,
  ADD INDEX `transportbooking_vehicleType_idx` (`vehicleType`);

ALTER TABLE `transportmessage`
  DROP INDEX `transportmessage_transportBookingId_createdAt_idx`,
  ADD INDEX `transportmessage_transportBookingId_createdAt_idx` (`transportBookingId`, `createdAt`);
