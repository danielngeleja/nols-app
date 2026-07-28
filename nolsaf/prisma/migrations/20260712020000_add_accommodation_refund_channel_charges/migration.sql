-- Itemised payment-channel and administrative charges applied to accommodation
-- refunds (cancellation policy section 8.4). Nullable and additive.
ALTER TABLE `cancellation_requests` ADD COLUMN `refundChargesJson` JSON NULL;
