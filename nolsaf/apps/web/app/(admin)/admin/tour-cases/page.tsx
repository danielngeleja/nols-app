import { redirect } from "next/navigation";

export default function LegacyTourCasesPage() {
  redirect("/admin/cancellations?service=tours");
}
