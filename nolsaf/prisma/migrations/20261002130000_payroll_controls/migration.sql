-- Payroll controls (lib/payroll.ts, routes/admin.finance.payroll.ts).
-- Additive only. Must come after 20261002120000_add_payroll.
--
-- employee.heslbDeduct / heslbIndexNumber
--     HESLB student loan repayment, deducted from pay and remitted to HESLB.
-- employee.payDetailsPendingSince / payDetailsChangedById
--     A changed bank or mobile money account waits for a second admin to
--     confirm it; until then the person's pay cannot be approved or paid.
-- payroll_run.heslb, payslip.heslb
--     The HESLB deduction, totalled per run.
-- payslip.daysPaid / periodDays
--     Part-month pay for joiners and leavers; null means the full month.
-- payroll_run.preparedById
--     Who last built or changed the figures. The approver must be someone
--     else, and the payer someone other than the approver.
-- payroll_remittance
--     Statutory payments (PAYE, SDL, NSSF, WCF, HESLB) recorded as paid,
--     with the date and the receipt or control number.

-- AlterTable
ALTER TABLE `employee`
    ADD COLUMN `heslbDeduct` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `heslbIndexNumber` VARCHAR(40) NULL,
    ADD COLUMN `payDetailsPendingSince` DATETIME(3) NULL,
    ADD COLUMN `payDetailsChangedById` INTEGER NULL;

-- AlterTable
ALTER TABLE `payroll_run`
    ADD COLUMN `heslb` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `preparedById` INTEGER NULL;

-- Existing runs were prepared by whoever created them.
UPDATE `payroll_run` SET `preparedById` = `createdById` WHERE `preparedById` IS NULL;

-- AlterTable
ALTER TABLE `payslip`
    ADD COLUMN `heslb` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `daysPaid` INTEGER NULL,
    ADD COLUMN `periodDays` INTEGER NULL;

-- CreateTable
CREATE TABLE `payroll_remittance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `key` VARCHAR(10) NOT NULL,
    `payee` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `dueOn` DATETIME(3) NOT NULL,
    `paidOn` DATETIME(3) NOT NULL,
    `reference` VARCHAR(120) NOT NULL,
    `note` VARCHAR(300) NULL,
    `paidById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_remittance_runId_key_key`(`runId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payroll_remittance` ADD CONSTRAINT `payroll_remittance_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `payroll_run`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
