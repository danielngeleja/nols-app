"use client";
import SalesShell from "@/components/SalesShell";
import EventHireWorkspace from "@/components/events/EventHireWorkspace";
export default function SalesEventRequestsPage() {
  return <SalesShell><EventHireWorkspace audience="sales" /></SalesShell>;
}
