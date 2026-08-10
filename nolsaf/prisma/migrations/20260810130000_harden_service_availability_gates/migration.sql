-- Forward-only hardening for service availability gates.
-- The preceding migration may already be applied; do not rewrite it.

-- Preserve the pre-gate behavior for regions containing existing approved
-- properties, but only when no administrator has configured transport yet.
-- New regions remain opt-in and therefore locked until explicitly opened.
INSERT IGNORE INTO `transport_availability`
  (`regionId`, `regionName`, `district`, `ward`, `isEnabled`, `reason`)
SELECT
  NULL,
  UPPER(TRIM(p.`regionName`)),
  '',
  '',
  1,
  NULL
FROM `Property` p
WHERE p.`status` = 'APPROVED'
  AND p.`regionName` IS NOT NULL
  AND TRIM(p.`regionName`) <> ''
  AND NOT EXISTS (SELECT 1 FROM `transport_availability` LIMIT 1)
GROUP BY UPPER(TRIM(p.`regionName`));

-- Provider integrations understood by the backend but not deliberately
-- published in checkout must start disabled. INSERT IGNORE preserves any
-- explicit administrator decision already made after the first migration.
INSERT IGNORE INTO `payment_method_availability`
  (`provider`, `label`, `isEnabled`, `reason`)
VALUES
  ('BANK_NBC',     'NBC Bank',                     0, 'This payment method is not configured for checkout yet.'),
  ('BANK_STANBIC', 'Stanbic Bank Tanzania',        0, 'This payment method is not configured for checkout yet.'),
  ('BANK_EQUITY',  'Equity Bank Tanzania',         0, 'This payment method is not configured for checkout yet.'),
  ('BANK_IM',      'I&M Bank',                     0, 'This payment method is not configured for checkout yet.'),
  ('BANK_ABSA',    'ABSA Bank Tanzania',           0, 'This payment method is not configured for checkout yet.'),
  ('BANK_TCB',     'Tanzania Commercial Bank',     0, 'This payment method is not configured for checkout yet.'),
  ('BANK_BOA',     'Bank of Africa Tanzania',      0, 'This payment method is not configured for checkout yet.'),
  ('BANK_DTB',     'Diamond Trust Bank',           0, 'This payment method is not configured for checkout yet.'),
  ('BANK_UBA',     'UBA Tanzania',                 0, 'This payment method is not configured for checkout yet.'),
  ('BANK_AZANIA',  'Azania Bank',                  0, 'This payment method is not configured for checkout yet.'),
  ('BANK_KCB',     'KCB Bank Tanzania',            0, 'This payment method is not configured for checkout yet.'),
  ('BANK_NCBA',    'NCBA Bank Tanzania',           0, 'This payment method is not configured for checkout yet.'),
  ('BANK_YETU',    'Yetu Microfinance Bank',       0, 'This payment method is not configured for checkout yet.');
