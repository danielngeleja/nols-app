-- The NRMS stock foundation, purchasing, and count migrations already created
-- these eight updatedAt columns with DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE
-- CURRENT_TIMESTAMP(3). Prisma schema.prisma omitted @default(now()) on them,
-- causing a physical-schema diff even though the database was correct.
--
-- This forward migration records the schema reconciliation without rebuilding
-- populated tables or rewriting their timestamps. The matching @default(now())
-- attributes are in schema.prisma; no physical DDL is required.
SELECT 1;
