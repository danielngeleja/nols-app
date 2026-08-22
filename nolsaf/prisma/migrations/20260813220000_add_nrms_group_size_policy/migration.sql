-- A group block is a commercial workflow, not merely a user-entered label.
-- Five rooms qualify normally; an owner may approve a contracted party of two
-- to four rooms with a recorded reason. Existing blocks are grandfathered.
ALTER TABLE `nrms_group_block`
  ADD COLUMN `groupMinimumRooms` INT NOT NULL DEFAULT 5,
  ADD COLUMN `agreedRoomsAtCreation` INT NULL,
  ADD COLUMN `smallGroupApprovedAt` DATETIME(3) NULL,
  ADD COLUMN `smallGroupApprovalReason` VARCHAR(300) NULL;
