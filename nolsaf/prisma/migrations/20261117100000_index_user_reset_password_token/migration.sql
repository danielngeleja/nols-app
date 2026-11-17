-- Index the password reset token hash (prepared 2026-11-17, NOT applied; apply only with Daniel's approval)
--
-- Password setup and reset links now carry only the token, so the API finds the
-- user by the SHA-256 of that token (user.resetPasswordToken). Without an index
-- that lookup scans the whole user table on every link check and password save.
--
-- One secondary index, nothing else touched. Valid on MySQL 8 (staging) and
-- MariaDB 11.8 (production); both build it online without locking writes.
-- The API works without it, only slower.
--
-- Rollback:
--   DROP INDEX `user_resetPasswordToken_idx` ON `user`;

-- CreateIndex
CREATE INDEX `user_resetPasswordToken_idx` ON `user`(`resetPasswordToken`);
