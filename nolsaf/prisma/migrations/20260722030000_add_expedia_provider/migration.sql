INSERT INTO `channel_provider` (`code`, `name`, `status`, `createdAt`, `updatedAt`)
VALUES ('EXPEDIA', 'Expedia Group', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `status` = VALUES(`status`),
  `updatedAt` = CURRENT_TIMESTAMP(3);
