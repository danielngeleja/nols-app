-- Twiga read receipts
--
-- Replaces the repeated "your message has been added to the thread" notice
-- with real delivery state. Two nullable timestamps on the conversation:
--
--   agentLastReadAt    set when an admin opens the thread or replies in it.
--                      Visitor messages created at or before it read as seen.
--   visitorLastReadAt  set while the visitor has the chat open and visible.
--                      Agent replies created at or before it read as seen.
--
-- Additive and nullable: existing rows need no backfill (null reads as "not
-- seen yet"), and no index is added because both columns are only ever read
-- alongside a conversation already fetched by primary key or session id.

-- AlterTable
ALTER TABLE `chatbot_conversations`
    ADD COLUMN `agentLastReadAt` DATETIME(3) NULL,
    ADD COLUMN `visitorLastReadAt` DATETIME(3) NULL;
