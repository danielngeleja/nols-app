-- Separate account creation / OTP verification from completion of the
-- identity profile required by both the web and mobile applications.
ALTER TABLE `User`
  ADD COLUMN `registrationStatus` VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE',
  ADD COLUMN `registrationSource` VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `profileCompletedAt` DATETIME(3) NULL;

-- Existing accounts did not record their source. Mark them explicitly as
-- legacy and derive completion only from the canonical required fields.
UPDATE `User`
SET
  `registrationSource` = 'LEGACY',
  `registrationStatus` = CASE
    WHEN COALESCE(NULLIF(TRIM(`name`), ''), NULLIF(TRIM(`fullName`), '')) IS NOT NULL
      AND NULLIF(TRIM(COALESCE(`email`, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(`phone`, '')), '') IS NOT NULL
    THEN 'COMPLETE'
    ELSE 'INCOMPLETE'
  END,
  `profileCompletedAt` = CASE
    WHEN COALESCE(NULLIF(TRIM(`name`), ''), NULLIF(TRIM(`fullName`), '')) IS NOT NULL
      AND NULLIF(TRIM(COALESCE(`email`, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(`phone`, '')), '') IS NOT NULL
    THEN COALESCE(`updatedAt`, `createdAt`)
    ELSE NULL
  END;

CREATE INDEX `User_role_registrationStatus_idx` ON `User`(`role`, `registrationStatus`);
CREATE INDEX `User_registrationSource_idx` ON `User`(`registrationSource`);
