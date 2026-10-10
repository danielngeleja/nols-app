import { redirect } from "next/navigation";

/** My Revenue moved into the Payouts workspace (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md). */
export default function RevenueRedirect() {
  redirect("/owner/payouts");
}
