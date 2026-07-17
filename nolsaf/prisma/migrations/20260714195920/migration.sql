-- AlterTable
ALTER TABLE `guest_profile` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `guest_sms_annual_quota` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `guest_sms_campaign` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `guest_sms_campaign_recipient` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `guest_sms_preference` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `owner_payg_account` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `owner_service_enrollment` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `reservation` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `reservation_room_allocation` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `room_type` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `room_unit` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `service_plan` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AddForeignKey
ALTER TABLE `jobapplication` ADD CONSTRAINT `jobapplication_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobapplication` ADD CONSTRAINT `jobapplication_reviewedBy_fkey` FOREIGN KEY (`reviewedBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobapplication` ADD CONSTRAINT `jobapplication_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `savedproperty` ADD CONSTRAINT `savedproperty_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `savedproperty` ADD CONSTRAINT `savedproperty_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `propertyavailabilityblock` ADD CONSTRAINT `propertyavailabilityblock_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `propertyavailabilityblock` ADD CONSTRAINT `propertyavailabilityblock_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_estimates` ADD CONSTRAINT `trip_estimates_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_estimates` ADD CONSTRAINT `trip_estimates_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `adminaudit` RENAME INDEX `AdminAudit_action_idx` TO `adminaudit_action_idx`;

-- RenameIndex
ALTER TABLE `adminaudit` RENAME INDEX `AdminAudit_adminId_idx` TO `adminaudit_adminId_idx`;

-- RenameIndex
ALTER TABLE `adminaudit` RENAME INDEX `AdminAudit_createdAt_idx` TO `adminaudit_createdAt_idx`;

-- RenameIndex
ALTER TABLE `adminaudit` RENAME INDEX `AdminAudit_targetUserId_idx` TO `adminaudit_targetUserId_idx`;

-- RenameIndex
ALTER TABLE `adminnote` RENAME INDEX `AdminNote_adminId_idx` TO `adminnote_adminId_idx`;

-- RenameIndex
ALTER TABLE `adminnote` RENAME INDEX `AdminNote_ownerId_idx` TO `adminnote_ownerId_idx`;

-- RenameIndex
ALTER TABLE `adminotp` RENAME INDEX `AdminOtp_adminId_purpose_idx` TO `adminotp_adminId_purpose_idx`;

-- RenameIndex
ALTER TABLE `adminotp` RENAME INDEX `AdminOtp_expiresAt_idx` TO `adminotp_expiresAt_idx`;

-- RenameIndex
ALTER TABLE `adminotp` RENAME INDEX `AdminOtp_usedAt_idx` TO `adminotp_usedAt_idx`;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `Agent_isAvailable_idx` TO `agent_isAvailable_idx`;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `Agent_status_idx` TO `agent_status_idx`;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `Agent_status_isAvailable_idx` TO `agent_status_isAvailable_idx`;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `Agent_userId_idx` TO `agent_userId_idx`;

-- RenameIndex
ALTER TABLE `agent` RENAME INDEX `Agent_userId_key` TO `agent_userId_key`;

-- RenameIndex
ALTER TABLE `auditlog` RENAME INDEX `AuditLog_actorId_idx` TO `auditlog_actorId_idx`;

-- RenameIndex
ALTER TABLE `auditlog` RENAME INDEX `AuditLog_createdAt_idx` TO `auditlog_createdAt_idx`;

-- RenameIndex
ALTER TABLE `auditlog` RENAME INDEX `AuditLog_entity_entityId_idx` TO `auditlog_entity_entityId_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_checkIn_idx` TO `booking_checkIn_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_checkOut_idx` TO `booking_checkOut_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_createdAt_idx` TO `booking_createdAt_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_driverId_idx` TO `booking_driverId_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_includeTransport_idx` TO `booking_includeTransport_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_includeTransport_transportScheduledDate_idx` TO `booking_includeTransport_transportScheduledDate_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_propertyId_checkIn_checkOut_idx` TO `booking_propertyId_checkIn_checkOut_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_propertyId_idx` TO `booking_propertyId_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_status_checkIn_idx` TO `booking_status_checkIn_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_status_createdAt_idx` TO `booking_status_createdAt_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_status_idx` TO `booking_status_idx`;

-- RenameIndex
ALTER TABLE `booking` RENAME INDEX `Booking_userId_idx` TO `booking_userId_idx`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_bookingId_key` TO `checkincode_bookingId_key`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_codeHash_key` TO `checkincode_codeHash_key`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_code_idx` TO `checkincode_code_idx`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_code_key` TO `checkincode_code_key`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_generatedAt_idx` TO `checkincode_generatedAt_idx`;

-- RenameIndex
ALTER TABLE `checkincode` RENAME INDEX `CheckinCode_status_idx` TO `checkincode_status_idx`;

-- RenameIndex
ALTER TABLE `emailverificationtoken` RENAME INDEX `EmailVerificationToken_expiresAt_idx` TO `emailverificationtoken_expiresAt_idx`;

-- RenameIndex
ALTER TABLE `emailverificationtoken` RENAME INDEX `EmailVerificationToken_token_key` TO `emailverificationtoken_token_key`;

-- RenameIndex
ALTER TABLE `emailverificationtoken` RENAME INDEX `EmailVerificationToken_userId_idx` TO `emailverificationtoken_userId_idx`;

-- RenameIndex
ALTER TABLE `groupbookingaudit` RENAME INDEX `GroupBookingAudit_action_idx` TO `groupbookingaudit_action_idx`;

-- RenameIndex
ALTER TABLE `groupbookingaudit` RENAME INDEX `GroupBookingAudit_adminId_idx` TO `groupbookingaudit_adminId_idx`;

-- RenameIndex
ALTER TABLE `groupbookingaudit` RENAME INDEX `GroupBookingAudit_createdAt_idx` TO `groupbookingaudit_createdAt_idx`;

-- RenameIndex
ALTER TABLE `groupbookingaudit` RENAME INDEX `GroupBookingAudit_groupBookingId_idx` TO `groupbookingaudit_groupBookingId_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_bookingId_idx` TO `invoice_bookingId_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_invoiceNumber_key` TO `invoice_invoiceNumber_key`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_issuedAt_idx` TO `invoice_issuedAt_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_ownerId_idx` TO `invoice_ownerId_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_paidAt_idx` TO `invoice_paidAt_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_paymentRef_key` TO `invoice_paymentRef_key`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_receiptNumber_key` TO `invoice_receiptNumber_key`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_status_idx` TO `invoice_status_idx`;

-- RenameIndex
ALTER TABLE `invoice` RENAME INDEX `Invoice_status_issuedAt_idx` TO `invoice_status_issuedAt_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_applicationDeadline_idx` TO `job_applicationDeadline_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_category_idx` TO `job_category_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_createdBy_idx` TO `job_createdBy_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_featured_idx` TO `job_featured_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_location_idx` TO `job_location_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_postedDate_idx` TO `job_postedDate_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_status_applicationDeadline_idx` TO `job_status_applicationDeadline_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_status_idx` TO `job_status_idx`;

-- RenameIndex
ALTER TABLE `job` RENAME INDEX `Job_type_idx` TO `job_type_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_email_idx` TO `jobapplication_email_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_jobId_idx` TO `jobapplication_jobId_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_reviewedBy_idx` TO `jobapplication_reviewedBy_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_status_idx` TO `jobapplication_status_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_status_submittedAt_idx` TO `jobapplication_status_submittedAt_idx`;

-- RenameIndex
ALTER TABLE `jobapplication` RENAME INDEX `JobApplication_submittedAt_idx` TO `jobapplication_submittedAt_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_createdAt_idx` TO `notification_createdAt_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_ownerId_idx` TO `notification_ownerId_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_ownerId_unread_idx` TO `notification_ownerId_unread_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_type_idx` TO `notification_type_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_unread_idx` TO `notification_unread_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_userId_idx` TO `notification_userId_idx`;

-- RenameIndex
ALTER TABLE `notification` RENAME INDEX `Notification_userId_unread_idx` TO `notification_userId_unread_idx`;

-- RenameIndex
ALTER TABLE `passkey` RENAME INDEX `Passkey_credentialId_idx` TO `passkey_credentialId_idx`;

-- RenameIndex
ALTER TABLE `passkey` RENAME INDEX `Passkey_credentialId_key` TO `passkey_credentialId_key`;

-- RenameIndex
ALTER TABLE `passkey` RENAME INDEX `Passkey_userId_idx` TO `passkey_userId_idx`;

-- RenameIndex
ALTER TABLE `phoneotp` RENAME INDEX `PhoneOtp_expiresAt_idx` TO `phoneotp_expiresAt_idx`;

-- RenameIndex
ALTER TABLE `phoneotp` RENAME INDEX `PhoneOtp_phone_idx` TO `phoneotp_phone_idx`;

-- RenameIndex
ALTER TABLE `phoneotp` RENAME INDEX `PhoneOtp_usedAt_idx` TO `phoneotp_usedAt_idx`;

-- RenameIndex
ALTER TABLE `phoneotp` RENAME INDEX `PhoneOtp_userId_idx` TO `phoneotp_userId_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_createdAt_idx` TO `property_createdAt_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_district_idx` TO `property_district_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_latitude_idx` TO `property_latitude_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_latitude_longitude_idx` TO `property_latitude_longitude_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_longitude_idx` TO `property_longitude_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_ownerId_idx` TO `property_ownerId_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_regionId_idx` TO `property_regionId_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_regionName_idx` TO `property_regionName_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_status_createdAt_regionId_idx` TO `property_status_createdAt_regionId_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_status_idx` TO `property_status_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_status_latitude_longitude_idx` TO `property_status_latitude_longitude_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_tourismSiteId_idx` TO `property_tourismSiteId_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_type_idx` TO `property_type_idx`;

-- RenameIndex
ALTER TABLE `property` RENAME INDEX `Property_ward_idx` TO `property_ward_idx`;

-- RenameIndex
ALTER TABLE `propertyavailabilityblock` RENAME INDEX `PropertyAvailabilityBlock_ownerId_idx` TO `propertyavailabilityblock_ownerId_idx`;

-- RenameIndex
ALTER TABLE `propertyavailabilityblock` RENAME INDEX `PropertyAvailabilityBlock_propertyId_idx` TO `propertyavailabilityblock_propertyId_idx`;

-- RenameIndex
ALTER TABLE `propertyavailabilityblock` RENAME INDEX `PropertyAvailabilityBlock_propertyId_startDate_endDate_idx` TO `propertyavailabilityblock_propertyId_startDate_endDate_idx`;

-- RenameIndex
ALTER TABLE `propertyavailabilityblock` RENAME INDEX `PropertyAvailabilityBlock_roomCode_idx` TO `propertyavailabilityblock_roomCode_idx`;

-- RenameIndex
ALTER TABLE `propertyavailabilityblock` RENAME INDEX `PropertyAvailabilityBlock_startDate_endDate_idx` TO `propertyavailabilityblock_startDate_endDate_idx`;

-- RenameIndex
ALTER TABLE `savedproperty` RENAME INDEX `SavedProperty_propertyId_idx` TO `savedproperty_propertyId_idx`;

-- RenameIndex
ALTER TABLE `savedproperty` RENAME INDEX `SavedProperty_savedAt_idx` TO `savedproperty_savedAt_idx`;

-- RenameIndex
ALTER TABLE `savedproperty` RENAME INDEX `SavedProperty_sharedAt_idx` TO `savedproperty_sharedAt_idx`;

-- RenameIndex
ALTER TABLE `savedproperty` RENAME INDEX `SavedProperty_userId_idx` TO `savedproperty_userId_idx`;

-- RenameIndex
ALTER TABLE `savedproperty` RENAME INDEX `SavedProperty_userId_propertyId_key` TO `savedproperty_userId_propertyId_key`;

-- RenameIndex
ALTER TABLE `session` RENAME INDEX `Session_lastSeenAt_idx` TO `session_lastSeenAt_idx`;

-- RenameIndex
ALTER TABLE `session` RENAME INDEX `Session_revokedAt_idx` TO `session_revokedAt_idx`;

-- RenameIndex
ALTER TABLE `session` RENAME INDEX `Session_userId_idx` TO `session_userId_idx`;

-- RenameIndex
ALTER TABLE `session` RENAME INDEX `Session_userId_revokedAt_idx` TO `session_userId_revokedAt_idx`;

-- RenameIndex
ALTER TABLE `tour_bookings` RENAME INDEX `tour_bookings_operator_status_created_idx` TO `tour_bookings_operatorAgentId_status_createdAt_idx`;

-- RenameIndex
ALTER TABLE `tour_bookings` RENAME INDEX `tour_bookings_payment_status_created_idx` TO `tour_bookings_paymentStatus_createdAt_idx`;

-- RenameIndex
ALTER TABLE `tourismsite` RENAME INDEX `TourismSite_country_idx` TO `tourismsite_country_idx`;

-- RenameIndex
ALTER TABLE `tourismsite` RENAME INDEX `TourismSite_slug_idx` TO `tourismsite_slug_idx`;

-- RenameIndex
ALTER TABLE `tourismsite` RENAME INDEX `TourismSite_slug_key` TO `tourismsite_slug_key`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_driverId_idx` TO `transportbooking_driverId_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_paymentStatus_idx` TO `transportbooking_paymentStatus_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_propertyId_idx` TO `transportbooking_propertyId_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_scheduledDate_idx` TO `transportbooking_scheduledDate_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_status_idx` TO `transportbooking_status_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_tripCodeHash_idx` TO `transportbooking_tripCodeHash_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_tripCodeHash_key` TO `transportbooking_tripCodeHash_key`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_tripCode_idx` TO `transportbooking_tripCode_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_tripCode_key` TO `transportbooking_tripCode_key`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_userId_idx` TO `transportbooking_userId_idx`;

-- RenameIndex
ALTER TABLE `transportbooking` RENAME INDEX `TransportBooking_vehicleType_idx` TO `transportbooking_vehicleType_idx`;

-- RenameIndex
ALTER TABLE `transportmessage` RENAME INDEX `TransportMessage_readAt_idx` TO `transportmessage_readAt_idx`;

-- RenameIndex
ALTER TABLE `transportmessage` RENAME INDEX `TransportMessage_senderId_idx` TO `transportmessage_senderId_idx`;

-- RenameIndex
ALTER TABLE `transportmessage` RENAME INDEX `TransportMessage_transportBookingId_createdAt_idx` TO `transportmessage_transportBookingId_createdAt_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_email_idx` TO `user_email_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_email_key` TO `user_email_key`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_kycStatus_idx` TO `user_kycStatus_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_phone_idx` TO `user_phone_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_phone_key` TO `user_phone_key`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_referredBy_idx` TO `user_referredBy_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_role_idx` TO `user_role_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_suspendedAt_idx` TO `user_suspendedAt_idx`;

-- RenameIndex
ALTER TABLE `userdocument` RENAME INDEX `UserDocument_status_idx` TO `userdocument_status_idx`;

-- RenameIndex
ALTER TABLE `userdocument` RENAME INDEX `UserDocument_userId_idx` TO `userdocument_userId_idx`;
