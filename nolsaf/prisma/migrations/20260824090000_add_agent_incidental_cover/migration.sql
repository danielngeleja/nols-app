-- Persist the agency's declared responsibility for guest incidentals. These
-- nullable fields keep historical bookings valid while allowing an agency to
-- cover all extras, selected categories, and an optional capped amount.

ALTER TABLE `nrms_agent_booking_request`
  ADD COLUMN `incidentalScope` VARCHAR(20) NULL,
  ADD COLUMN `incidentalCategories` JSON NULL,
  ADD COLUMN `incidentalCapAmount` DECIMAL(12, 2) NULL,
  ADD COLUMN `incidentalCapBasis` VARCHAR(30) NULL;
