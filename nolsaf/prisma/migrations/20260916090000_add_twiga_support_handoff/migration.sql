-- Twiga support handoff
--
-- Lets a chatbot conversation become a two-way thread with a human agent
-- instead of only carrying an internal "needs follow up" flag that the visitor
-- never sees a reply to.
--
-- No foreign keys are added. The chatbot tables were created without any (see
-- 20260714130000_reconcile_legacy_database_drift), and an assignee or author
-- pointing at a removed admin should read as unassigned rather than block the
-- row or fail a delete.

-- AlterTable
ALTER TABLE `chatbot_conversations`
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'BOT',
    ADD COLUMN `assignedToId` INTEGER NULL,
    ADD COLUMN `handoffReason` VARCHAR(160) NULL,
    ADD COLUMN `handoffAt` DATETIME(3) NULL,
    ADD COLUMN `resolvedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `chatbot_messages`
    ADD COLUMN `authorId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `chatbot_conversations_status_idx` ON `chatbot_conversations`(`status` ASC);

-- CreateIndex
CREATE INDEX `chatbot_conversations_assignedToId_idx` ON `chatbot_conversations`(`assignedToId` ASC);

-- CreateIndex
CREATE INDEX `chatbot_messages_authorId_idx` ON `chatbot_messages`(`authorId` ASC);

-- Backfill the new lifecycle from the flags that already exist, so the admin
-- queue is not empty on day one and nothing in flight is lost.
--
-- Already handled: an agent recorded a follow up, so treat it as closed.
UPDATE `chatbot_conversations`
SET `status` = 'RESOLVED',
    `resolvedAt` = `followedUpAt`
WHERE `followedUpAt` IS NOT NULL;

-- Still waiting: flagged for follow up but nobody has acted on it.
-- `updatedAt` is maintained by Prisma and has no ON UPDATE clause on this
-- column, so reading it here is a stable approximation of when it was flagged
-- and this statement will not disturb it.
UPDATE `chatbot_conversations`
SET `status` = 'AWAITING_AGENT',
    `handoffAt` = `updatedAt`,
    `handoffReason` = 'Migrated from needsFollowUp'
WHERE `needsFollowUp` = true
  AND `followedUpAt` IS NULL;
