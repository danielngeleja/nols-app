-- Preserve the selected Tanzania location hierarchy on each sales lead.
ALTER TABLE `sales_lead`
    ADD COLUMN `district` VARCHAR(120) NULL AFTER `region`,
    ADD COLUMN `ward` VARCHAR(120) NULL AFTER `district`;
