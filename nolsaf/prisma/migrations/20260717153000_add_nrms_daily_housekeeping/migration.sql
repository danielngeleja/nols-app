-- Daily occupied-room housekeeping configuration and idempotency key.
ALTER TABLE `property`
  ADD COLUMN `housekeepingDailyServiceEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `housekeepingDailyServiceTime` VARCHAR(5) NOT NULL DEFAULT '11:00',
  ADD COLUMN `housekeepingLastDailyServiceDate` DATETIME(3) NULL;

ALTER TABLE `nrms_housekeeping_task`
  ADD COLUMN `serviceDate` DATETIME(3) NULL;

CREATE UNIQUE INDEX `uq_nrms_hk_room_type_service_date`
  ON `nrms_housekeeping_task` (`roomUnitId`, `type`, `serviceDate`);
