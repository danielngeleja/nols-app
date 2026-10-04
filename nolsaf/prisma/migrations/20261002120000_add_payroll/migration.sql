-- Payroll: employees, monthly pay runs and payslips (lib/payroll.ts).
-- Additive only. Paying a run posts one STAFF row to platform_expense, so
-- this migration must come after 20261002090000_add_platform_expense_ledger.
--
-- employee     staff register: identity (NIDA, TIN, NSSF no.), job, pay,
--              statutory flags and pay account. Never deleted.
-- payroll_run  one month: DRAFT -> APPROVED -> PAID (or CANCELLED), with the
--              statutory rates snapshot and totals.
-- payslip      one employee per run, with an employee snapshot.
-- systemsetting.payrollSettings  statutory rates; null uses code defaults.

-- CreateTable
CREATE TABLE `employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeNo` VARCHAR(20) NOT NULL,
    `fullName` VARCHAR(150) NOT NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `nationalId` VARCHAR(30) NULL,
    `tin` VARCHAR(20) NULL,
    `nssfNumber` VARCHAR(30) NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `gender` VARCHAR(10) NULL,
    `address` VARCHAR(255) NULL,
    `jobTitle` VARCHAR(120) NOT NULL,
    `department` VARCHAR(80) NULL,
    `employmentType` VARCHAR(20) NOT NULL DEFAULT 'PERMANENT',
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `basicSalary` DECIMAL(14, 2) NOT NULL,
    `housingAllowance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `transportAllowance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `otherAllowance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'TZS',
    `nssfEnrolled` BOOLEAN NOT NULL DEFAULT true,
    `payeExempt` BOOLEAN NOT NULL DEFAULT false,
    `paymentMethod` VARCHAR(20) NOT NULL DEFAULT 'BANK',
    `bankName` VARCHAR(80) NULL,
    `bankBranch` VARCHAR(80) NULL,
    `bankAccountName` VARCHAR(150) NULL,
    `bankAccountNumber` VARCHAR(40) NULL,
    `mobileMoneyProvider` VARCHAR(40) NULL,
    `mobileMoneyNumber` VARCHAR(30) NULL,
    `emergencyContactName` VARCHAR(150) NULL,
    `emergencyContactPhone` VARCHAR(30) NULL,
    `notes` VARCHAR(1000) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_employeeNo_key`(`employeeNo`),
    INDEX `employee_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runNumber` VARCHAR(20) NOT NULL,
    `periodMonth` VARCHAR(7) NOT NULL,
    `payDate` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `rates` JSON NOT NULL,
    `sdlApplies` BOOLEAN NOT NULL DEFAULT false,
    `headcount` INTEGER NOT NULL DEFAULT 0,
    `gross` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `nssfEmployee` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paye` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `otherDeductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `nssfEmployer` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `wcf` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `sdl` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `employerCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `note` VARCHAR(500) NULL,
    `paymentReference` VARCHAR(120) NULL,
    `createdById` INTEGER NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidById` INTEGER NULL,
    `paidAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `expenseId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_run_runNumber_key`(`runNumber`),
    INDEX `payroll_run_periodMonth_status_idx`(`periodMonth`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslip` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `payslipNumber` VARCHAR(30) NOT NULL,
    `employeeSnapshot` JSON NOT NULL,
    `basicSalary` DECIMAL(14, 2) NOT NULL,
    `allowances` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `overtime` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `bonus` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `gross` DECIMAL(14, 2) NOT NULL,
    `nssfEmployee` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `taxable` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `paye` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `loanDeduction` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `otherDeductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalDeductions` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `net` DECIMAL(14, 2) NOT NULL,
    `nssfEmployer` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `wcf` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `sdl` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `employerCost` DECIMAL(14, 2) NOT NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payslip_payslipNumber_key`(`payslipNumber`),
    INDEX `payslip_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `payslip_runId_employeeId_key`(`runId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `systemsetting` ADD COLUMN `payrollSettings` JSON NULL;

-- AddForeignKey
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `payroll_run`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip` ADD CONSTRAINT `payslip_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
