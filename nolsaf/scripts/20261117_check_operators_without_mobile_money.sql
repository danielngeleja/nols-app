-- READ ONLY. Lists active tour operators who cannot be paid today.
--
-- Since 2026-11-17 operator payouts go to a verified mobile money account only
-- (Tour Operator Disbursement Policy 5.4; the ledger has never been able to pay
-- a bank account). Operators below would be refused when they claim a balance,
-- and advances stay closed to them, until they verify a mobile money wallet.
--
-- situation:
--   BANK_ONLY          a verified bank account, no verified mobile money
--   UNVERIFIED_ONLY    payout details saved but never verified
--   NONE               no payout account at all
--
-- Runs on MySQL 8 (staging) and MariaDB 11.8 (prod). Changes nothing.

SELECT
  a.id                                   AS agent_id,
  u.fullName                             AS operator_name,
  u.email                                AS email,
  CASE
    WHEN SUM(pa.type = 'BANK' AND pa.isVerified = 1 AND pa.isActive = 1) > 0 THEN 'BANK_ONLY'
    WHEN COUNT(pa.id) > 0 THEN 'UNVERIFIED_ONLY'
    ELSE 'NONE'
  END                                    AS situation,
  (SELECT COUNT(*) FROM tour_bookings tb
    WHERE tb.operatorAgentId = a.id
      AND (tb.paymentStatus = 'PAID' OR tb.paidAt IS NOT NULL)
      AND (tb.payoutStatus IS NULL OR tb.payoutStatus NOT IN ('DISBURSED', 'PAID', 'REJECTED', 'RECOVERED', 'RECOVERY_PENDING'))
      AND tb.status NOT IN ('CANCELED', 'CANCELLED', 'REFUNDED')
  )                                      AS unpaid_paid_trips
FROM agent a
JOIN `user` u ON u.id = a.userId
LEFT JOIN payout_account pa ON pa.userId = a.userId
WHERE a.status = 'ACTIVE'
GROUP BY a.id, u.fullName, u.email
HAVING SUM(pa.type = 'MOBILE_MONEY' AND pa.isVerified = 1 AND pa.isActive = 1) = 0
    OR COUNT(pa.id) = 0
ORDER BY unpaid_paid_trips DESC, a.id;
