-- Counted menu inventory. stockQuantity NULL = untracked (manual availability
-- toggle only). Tracked items decrement at order creation, restore on
-- cancellation, and auto-flip inStock to false when they reach zero.
ALTER TABLE `nrms_menu_item`
  ADD COLUMN `stockQuantity` INTEGER NULL,
  ADD COLUMN `lowStockThreshold` INTEGER NOT NULL DEFAULT 5;
