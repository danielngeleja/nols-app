import { redirect } from "next/navigation";

/** Expenses moved into its own workspace at /admin/expenses. */
export default function LegacyExpensesRedirect() {
  redirect("/admin/expenses/ledger");
}
