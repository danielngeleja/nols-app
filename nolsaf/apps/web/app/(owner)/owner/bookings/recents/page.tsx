"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function RecentBookings() {
  const [list, setList] = useState<any[]>([]);

  useEffect(() => {
    api.get<any[]>("/owner/bookings/recent").then(r => setList(r.data));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Recent Bookings</h1>
      <div className="grid gap-3">
        {list.map(b => (
          <div key={b.id} className="bg-white border border-solid rounded-lg p-3 flex justify-between">
            <div>
              <div className="font-medium">#{b.id} • {b.property?.title}</div>
              <div className="text-xs opacity-70">{new Date(b.createdAt).toLocaleString()}</div>
            </div>
            <div className="text-sm">TZS {b.ownerBaseAmount ?? Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0))}</div>
          </div>
        ))}
        {list.length === 0 && <div className="text-sm opacity-70">No recent activity.</div>}
      </div>
    </div>
  );
}
