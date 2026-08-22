-- Add nationality to the agency identity. Separate migration because
-- 20260820000000_add_nrms_agent_b2b was already applied; that one must not be edited.

-- AlterTable
ALTER TABLE `nrms_agent_account` ADD COLUMN `nationality` VARCHAR(80) NULL;
