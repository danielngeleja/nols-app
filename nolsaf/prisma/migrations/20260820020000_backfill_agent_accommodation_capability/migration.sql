-- Phase 0 identity bridge. Record the accommodation entitlement for every
-- established NRMS agent without changing its User.role, login, KYC identity,
-- hotel links, rates, bookings, or portal behavior.
--
-- INSERT IGNORE is deliberate: an entitlement already suspended or revoked by
-- an administrator must never be silently reactivated by this backfill.
INSERT IGNORE INTO `user_workspace_access` (
    `userId`,
    `workspace`,
    `status`,
    `grantedAt`,
    `statusReason`,
    `createdAt`,
    `updatedAt`
)
SELECT
    `primaryUserId`,
    'ACCOMMODATION',
    'ACTIVE',
    COALESCE(`verifiedAt`, `createdAt`),
    'Backfilled from established NRMS agent identity',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `nrms_agent_account`;
