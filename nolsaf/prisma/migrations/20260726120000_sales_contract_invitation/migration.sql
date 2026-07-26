-- Login-bound, single-use invitation for Sales Partner agreements.
-- Raw invitation tokens are never stored; only their SHA-256 digest is kept.
ALTER TABLE `sales_partner_contract`
  ADD COLUMN `invitationTokenHash` VARCHAR(64) NULL,
  ADD COLUMN `invitationSentAt` DATETIME(3) NULL,
  ADD COLUMN `invitationExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `invitationUsedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `sales_partner_contract_invitationTokenHash_key`
  ON `sales_partner_contract`(`invitationTokenHash`);

CREATE INDEX `sales_partner_contract_invitationExpiresAt_idx`
  ON `sales_partner_contract`(`invitationExpiresAt`);
