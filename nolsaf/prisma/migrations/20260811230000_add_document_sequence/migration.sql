-- Collision-free, monotonic receipt numbering. Numbers may contain deliberate
-- gaps when a caller allocates a receipt and then loses the settlement claim.
--
-- Today both settlement paths (webhooks.payments.markInvoicePaid and
-- admin.invoices POST /:id/mark-paid) derive the receipt number from
-- COUNT(*) WHERE status='PAID' and then write it into invoice.receiptNumber,
-- which is UNIQUE. Two invoices settling in the same moment derive the same
-- string and one of them fails on the unique index, which fails a real
-- customer payment. The count is also not stable: it drops if an invoice is
-- ever moved out of PAID, so the same number can be derived twice on
-- different days.
--
-- This table replaces the count with an atomic allocator. The application runs
-- the upsert and select in one interactive transaction, so concurrent callers
-- serialize on the row lock:
--
--   INSERT INTO document_sequence (scope, period, lastValue)
--   VALUES ('RCPT', '2026', 1)
--   ON DUPLICATE KEY UPDATE lastValue = lastValue + 1;
--   SELECT lastValue FROM document_sequence WHERE scope='RCPT' AND period='2026';
--
-- The application then formats `RCPT/<period>/<lastValue padded to 5>`,
-- matching every receipt number already issued.

CREATE TABLE `document_sequence` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  -- Document class: RCPT today, INV/PF later without another migration.
  `scope`     VARCHAR(20) NOT NULL,
  -- Reset boundary. Calendar year for receipts, matching RCPT/2026/00001.
  `period`    VARCHAR(10) NOT NULL,
  `lastValue` INT NOT NULL DEFAULT 0,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `document_sequence_scope_period_key` (`scope`, `period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed from what has already been issued, per year, or the allocator will
-- hand out numbers that already exist and collide on invoice.receiptNumber.
-- Reads the numeric tail of every RCPT/<year>/<n> currently in the table.
INSERT INTO `document_sequence` (`scope`, `period`, `lastValue`, `createdAt`, `updatedAt`)
SELECT
  'RCPT' AS `scope`,
  SUBSTRING_INDEX(SUBSTRING_INDEX(`receiptNumber`, '/', 2), '/', -1) AS `period`,
  MAX(CAST(SUBSTRING_INDEX(`receiptNumber`, '/', -1) AS UNSIGNED))   AS `lastValue`,
  NOW(3) AS `createdAt`,
  NOW(3) AS `updatedAt`
FROM `invoice`
WHERE `receiptNumber` REGEXP '^RCPT/[0-9]{4}/[0-9]+$'
GROUP BY 2
ON DUPLICATE KEY UPDATE
  `lastValue` = GREATEST(`document_sequence`.`lastValue`, VALUES(`lastValue`));

-- Make sure the current year exists even when no receipt was ever issued in it.
INSERT IGNORE INTO `document_sequence` (`scope`, `period`, `lastValue`, `createdAt`, `updatedAt`)
VALUES ('RCPT', DATE_FORMAT(NOW(), '%Y'), 0, NOW(3), NOW(3));
