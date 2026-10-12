import { redirect } from "next/navigation";

export default function ReadNotificationsPage() {
  redirect("/owner/notifications?tab=viewed");
}
