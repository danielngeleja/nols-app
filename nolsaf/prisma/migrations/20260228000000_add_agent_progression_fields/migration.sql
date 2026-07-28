-- Historical prerequisite for the agent suspension migration.
-- These columns already existed in deployed databases, but their creation was
-- missing from the migration history, which made shadow-database replay fail.
ALTER TABLE `agent`
  ADD COLUMN `level`                 VARCHAR(20)   NOT NULL DEFAULT 'BRONZE' AFTER `performanceMetrics`,
  ADD COLUMN `totalCompletedTrips`   INT           NOT NULL DEFAULT 0        AFTER `level`,
  ADD COLUMN `totalRevenueGenerated` DECIMAL(15,2) NOT NULL DEFAULT 0.00     AFTER `totalCompletedTrips`;
