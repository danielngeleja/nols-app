-- Each property chooses when its hotel business date rolls over. The setting
-- controls close eligibility only; Night Audit remains a manual, reviewed and
-- immutable financial action.
ALTER TABLE `property`
  ADD COLUMN `nrmsNightAuditCloseTime` VARCHAR(5) NOT NULL DEFAULT '20:00';
