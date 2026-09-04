-- Closed merchant-property links are historical records and must not retain
-- the unique key that represents the currently active property scope.
UPDATE `merchant_property_link`
SET `activeScopeKey` = NULL
WHERE `effectiveTo` IS NOT NULL
  AND `activeScopeKey` IS NOT NULL;
