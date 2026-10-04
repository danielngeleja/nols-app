-- Optional last day of access for an NRMS staff assignment.
--
-- Seasonal and contract staff are already a recognised case: the revoke reasons
-- offered in the owner UI include "End of season" and "Contract ended". Until
-- now the system could record why access ended but never when it should, so a
-- casual hired for one season kept bar access indefinitely unless somebody
-- remembered to revoke them.
--
-- NULL means open ended, which is every assignment that exists today, so this
-- column changes no current behaviour. A dated assignment is reported as lapsed
-- once the date passes; nothing revokes automatically, because silently cutting
-- access mid shift is worse than an administrator seeing it flagged and acting.

ALTER TABLE `nrms_staff_membership`
  ADD COLUMN `accessEndsAt` DATETIME(3) NULL;

-- Supports "which assignments have lapsed or are about to" without scanning
-- the whole table per property.
CREATE INDEX `nrms_staff_membership_accessEndsAt_idx`
  ON `nrms_staff_membership` (`accessEndsAt`);
