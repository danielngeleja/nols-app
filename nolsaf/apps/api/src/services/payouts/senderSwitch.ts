/** Process-wide emergency stop for new AzamPay disbursement submissions. */
export function disbursementSendingEnabled(): boolean {
  return process.env.DISBURSEMENTS_ENABLED !== "false";
}
