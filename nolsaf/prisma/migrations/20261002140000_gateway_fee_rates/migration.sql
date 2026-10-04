-- Payment gateway fee rates by channel (lib/gatewayFees.ts).
-- Additive only. Must come after 20261002090000_add_platform_expense_ledger.
--
-- systemsetting.gatewayFeeRates  { provider, MNO, BANK, CARD } in percent.
--     Null uses AzamPay's defaults: mobile money 2.5, bank 2.5, card 2.9.
--     Used to estimate gateway costs until a period has fees recorded from a
--     settlement statement.

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `gatewayFeeRates` JSON NULL;
