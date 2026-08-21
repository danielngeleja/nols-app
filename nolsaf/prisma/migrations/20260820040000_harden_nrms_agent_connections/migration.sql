-- Preserve who owns a partnership suspension. Central compliance suspensions
-- must not be reversible from the hotel workspace.
ALTER TABLE `nrms_agent_property_link`
  ADD COLUMN `suspensionAuthority` VARCHAR(20) NULL;

-- Reconstruct the best available authority for existing suspended rows. Admin
-- actors retain central ownership; older hotel-side suspensions remain hotel-owned.
UPDATE `nrms_agent_property_link` AS `link`
LEFT JOIN `user` AS `actor` ON `actor`.`id` = `link`.`decidedByUserId`
SET `link`.`suspensionAuthority` = CASE
  WHEN UPPER(COALESCE(`actor`.`role`, '')) = 'ADMIN' THEN 'ADMIN'
  ELSE 'HOTEL'
END
WHERE `link`.`status` = 'SUSPENDED';
