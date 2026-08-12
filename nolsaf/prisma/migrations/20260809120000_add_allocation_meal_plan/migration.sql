-- Meal plan on the stay, for the breakfast list and any future package report.
--
-- Breakfast entitlement is a rate-plan inclusion. Until now the plan was used
-- to quote a price and then forgotten: nothing on a reservation said which
-- plan was sold, so no report could answer "is this guest entitled to
-- breakfast".
--
-- The columns land on reservation_room_allocation, not reservation, because
-- that is the granularity the industry uses and the one this schema already
-- has: one row per allocated room per date range, replaced rather than edited
-- when a room or stay changes, which makes these rows a per-night rate detail
-- by another name. A family on two rooms can sit on two plans, and a mid-stay
-- plan change is a new row.
--
-- meal_plan is a SNAPSHOT, not a join. Editing a rate plan in March must not
-- rewrite what a January guest was entitled to, exactly as reservation
-- snapshots its price when applied.

ALTER TABLE `reservation_room_allocation`
  ADD COLUMN `ratePlanId` INT NULL,
  ADD COLUMN `mealPlan` VARCHAR(30) NULL;

CREATE INDEX `ReservationRoomAllocation_ratePlanId_idx`
  ON `reservation_room_allocation`(`ratePlanId`);

-- SET NULL, not CASCADE: retiring a rate plan must never delete stay history.
ALTER TABLE `reservation_room_allocation`
  ADD CONSTRAINT `reservation_room_allocation_ratePlanId_fkey`
  FOREIGN KEY (`ratePlanId`) REFERENCES `nrms_rate_plan`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing stays get their property's default active rate plan.
-- Only where exactly one default exists, so an ambiguous property is left
-- NULL and prints as "verify" on the list rather than being asserted wrongly.
-- ratePlanId is deliberately left NULL for these rows: the plan is inferred,
-- not what was sold, and a NULL link keeps that distinction readable later.
UPDATE `reservation_room_allocation` alloc
JOIN `reservation` res ON res.`id` = alloc.`reservationId`
JOIN (
  SELECT `propertyId`, MIN(`mealPlan`) AS `mealPlan`
  FROM `nrms_rate_plan`
  WHERE `isDefault` = 1 AND `status` = 'ACTIVE'
  GROUP BY `propertyId`
  HAVING COUNT(*) = 1
) plan ON plan.`propertyId` = res.`propertyId`
SET alloc.`mealPlan` = plan.`mealPlan`
WHERE alloc.`mealPlan` IS NULL;
