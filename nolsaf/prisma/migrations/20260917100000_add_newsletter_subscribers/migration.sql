-- Newsletter subscribers (public footer signup, double opt-in)
--
-- NOT APPLIED. Prepared for review; run only after approval.
--
-- New table only: nothing existing is altered, so this is safe to apply ahead of
-- the code that uses it, and the API answers "not available yet" until it exists.
--
--   status                  PENDING until the confirmation link is clicked, then
--                           SUBSCRIBED; UNSUBSCRIBED keeps the opt-out on record.
--   confirmTokenHash        SHA-256 of the single-use confirmation token.
--   unsubscribeToken        random token for one-click unsubscribe links.
--   lastConfirmationSentAt  throttles repeat confirmation emails to one address.

-- CreateTable
CREATE TABLE `newsletter_subscribers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(254) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `source` VARCHAR(40) NOT NULL DEFAULT 'footer',
    `confirmTokenHash` CHAR(64) NULL,
    `confirmTokenExpiresAt` DATETIME(3) NULL,
    `unsubscribeToken` CHAR(64) NOT NULL,
    `lastConfirmationSentAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `unsubscribedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `newsletter_subscribers_email_key`(`email`),
    UNIQUE INDEX `newsletter_subscribers_confirmTokenHash_key`(`confirmTokenHash`),
    UNIQUE INDEX `newsletter_subscribers_unsubscribeToken_key`(`unsubscribeToken`),
    INDEX `newsletter_subscribers_status_idx`(`status`),
    INDEX `newsletter_subscribers_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
