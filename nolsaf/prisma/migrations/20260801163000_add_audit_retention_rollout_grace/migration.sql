-- Give pre-policy evidence a review window before automated enforcement begins.
-- New audit rows retain their normal class-specific expiry from the insert triggers.

SET @audit_retention_grace_end = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY);

UPDATE `auditlog`
SET `expiresAt` = @audit_retention_grace_end
WHERE `expiresAt` < @audit_retention_grace_end
  AND `legalHoldAt` IS NULL;

UPDATE `adminaudit`
SET `expiresAt` = @audit_retention_grace_end
WHERE `expiresAt` < @audit_retention_grace_end
  AND `legalHoldAt` IS NULL;

UPDATE `admin_work_item`
SET `expiresAt` = @audit_retention_grace_end
WHERE `status` = 'RESOLVED'
  AND `expiresAt` < @audit_retention_grace_end
  AND `legalHoldAt` IS NULL;

INSERT INTO `auditlog` (
  `actorId`, `actorRole`, `action`, `entity`, `entityId`,
  `beforeJson`, `afterJson`, `ip`, `ua`, `createdAt`
) VALUES (
  NULL,
  'SYSTEM',
  'AUDIT_RETENTION_POLICY_ROLLOUT',
  'AUDIT_RETENTION',
  NULL,
  NULL,
  JSON_OBJECT('historicalReviewDays', 30, 'enforcementBeginsAt', @audit_retention_grace_end),
  NULL,
  NULL,
  CURRENT_TIMESTAMP(3)
);
