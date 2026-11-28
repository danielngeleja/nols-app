import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const tab = typeof p.tab === "string" ? p.tab : "overview";
  const route = ({ overview: "", requests: "/requests", bookings: "/bookings", calendar: "/availability", payments: "/payments" } as Record<string, string>)[tab] ?? "";
  const query = new URLSearchParams();
  if (typeof p.eventBooking === "string") query.set("eventBooking", p.eventBooking);
  redirect(`/admin/event-hire${route}${query.size ? `?${query}` : ""}`);
}
