ALTER TABLE `agent`
  ADD COLUMN `publicKey` VARCHAR(40) NULL;

-- Backfill every existing operator before making the opaque key mandatory.
UPDATE `agent`
SET `publicKey` = LOWER(REPLACE(UUID(), '-', ''))
WHERE `publicKey` IS NULL;

ALTER TABLE `agent`
  MODIFY `publicKey` VARCHAR(40) NOT NULL;

CREATE UNIQUE INDEX `agent_publicKey_key`
  ON `agent`(`publicKey`);
