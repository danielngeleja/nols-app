import { redirect } from "next/navigation";

export default function UnreadNotificationsPage() {
  redirect("/owner/notifications");
}
