import { redirect } from "next/navigation";

export default function LegacyLongStaysPage() {
  redirect("/account/bookings/long-stays");
}
