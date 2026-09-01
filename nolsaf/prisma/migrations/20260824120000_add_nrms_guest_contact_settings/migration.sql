-- A hotel's public reception details must not fall back to the owner's
-- personal User contact. This JSON document is validated by the NRMS API and
-- can evolve as Meta/WhatsApp channel connections are added later.

ALTER TABLE `property`
  ADD COLUMN `nrmsGuestContactSettings` JSON NULL;
