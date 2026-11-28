"use client";
import EventHireWorkspace from "@/components/events/EventHireWorkspace";
import BookingTypeNav from "@/components/longStay/BookingTypeNav";
export default function EventRequestsPage() {
  return <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6"><BookingTypeNav current="events" /><EventHireWorkspace audience="customer" /></main>;
}
