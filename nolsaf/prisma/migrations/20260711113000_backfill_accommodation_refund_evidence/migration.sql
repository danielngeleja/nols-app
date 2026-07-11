UPDATE `cancellation_requests` AS `cr`
SET
  `cr`.`refundAmount` = ROUND(
    COALESCE((
      SELECT `i`.`total`
      FROM `Invoice` AS `i`
      WHERE `i`.`bookingId` = `cr`.`bookingId`
      ORDER BY `i`.`createdAt` DESC
      LIMIT 1
    ), 0) * COALESCE(`cr`.`policyRefundPercent`, 0) / 100,
    2
  ),
  `cr`.`refundProvider` = COALESCE(
    `cr`.`refundProvider`,
    (
      SELECT `i`.`paymentMethod`
      FROM `Invoice` AS `i`
      WHERE `i`.`bookingId` = `cr`.`bookingId`
      ORDER BY `i`.`createdAt` DESC
      LIMIT 1
    )
  )
WHERE `cr`.`status` = 'REFUND_PENDING'
  AND `cr`.`refundAmount` IS NULL;
