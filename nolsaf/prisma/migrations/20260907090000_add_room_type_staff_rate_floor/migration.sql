-- The lowest nightly rate a staff member may agree for a room type.
--
-- Group blocks let whoever agrees the business type the rate per room line,
-- and that number becomes the guest's own rate: pickup writes it straight to
-- Reservation.roomRate and totalAmount. The only validation was
-- `z.number().min(0)`, so zero was a valid group rate.
--
-- That was tolerable while agreeing a block was owner-only, because it was an
-- owner pricing their own rooms. It stopped being tolerable when the block
-- lifecycle opened to MANAGER and SALES_EXECUTIVE, which turned "type a number"
-- into an unlimited discount authority for staff.
--
-- NULL, which is every row this adds, means no floor has been set, and the
-- application then refuses a staff rate below the room type's baseRate.
-- Discount authority is granted, not assumed. An owner who wants their sales
-- team to negotiate sets a lower number here; 0 lifts the limit entirely; a
-- room type with no baseRate has nothing to floor against and is unrestricted.
--
-- The owner is never floored, so no behaviour that existed before the block
-- lifecycle was opened changes.

ALTER TABLE `room_type`
  ADD COLUMN `staffRateFloor` DECIMAL(12,2) NULL;
