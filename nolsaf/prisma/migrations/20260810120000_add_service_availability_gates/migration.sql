-- Admin-controlled service availability gates.
--
-- transport_availability: opt-in, geographic. No matching row (checked
-- ward -> district -> region, see lib/serviceAvailability.ts) means locked,
-- so a property listed in a region with no driver coverage never offers
-- transport until an admin explicitly opens that area.
--
-- payment_method_availability: opt-out, global per provider. No matching
-- row means enabled, matching today's always-on behavior. Seeded here with
-- every provider already wired into checkout so nothing changes on deploy;
-- admin only needs to flip a row off when a specific rail isn't ready.

CREATE TABLE IF NOT EXISTS `transport_availability` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `regionId`    VARCHAR(50) NULL,
  `regionName`  VARCHAR(120) NOT NULL,
  -- Empty string, never NULL: MySQL treats NULLs as distinct in a UNIQUE index,
  -- so nullable columns here would allow duplicate region-wide rows.
  `district`    VARCHAR(120) NOT NULL DEFAULT '',
  `ward`        VARCHAR(120) NOT NULL DEFAULT '',
  `isEnabled`   TINYINT(1) NOT NULL DEFAULT 1,
  `reason`      VARCHAR(300) NULL,
  `updatedById` INT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `transport_availability_regionName_district_ward_key` (`regionName`, `district`, `ward`),
  KEY `transport_availability_regionName_district_idx` (`regionName`, `district`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_method_availability` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `provider`    VARCHAR(40) NOT NULL,
  `label`       VARCHAR(80) NOT NULL,
  `isEnabled`   TINYINT(1) NOT NULL DEFAULT 1,
  `reason`      VARCHAR(300) NULL,
  `updatedById` INT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `payment_method_availability_provider_key` (`provider`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed every provider currently wired into checkout as enabled, so this
-- migration never changes live behavior on its own — admin toggles from here.
INSERT IGNORE INTO `payment_method_availability` (`provider`, `label`, `isEnabled`) VALUES
  ('Airtel',    'Airtel Money', 1),
  ('Mpesa',     'Mpesa',        1),
  ('Tigo',      'Tigo Pesa',    1),
  ('Halopesa',  'HaloPesa',     1),
  ('Azampesa',  'AzamPesa',     1),
  ('CARD',      'Debit / Credit Card', 1),
  ('BANK_CRDB', 'CRDB Bank',    1),
  ('BANK_NMB',  'NMB Bank',     1);
