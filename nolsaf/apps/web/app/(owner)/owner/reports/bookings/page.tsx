"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
type ReportsFilters = { [key: string]: any };
function ReportsFilter({ onChangeAction }: { onChangeAction: (f: ReportsFilters | null) => void }) {
  // Minimal stub: invoke onChange once on mount; replace with real UI when available.
  useEffect(() => {
    const now = new Date();
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 2);
    const to = new Date(now);
    to.setFullYear(to.getFullYear() + 2);
    onChangeAction({
      from: from.toISOString().split("T")[0],
      to: to.toISOString().split("T")[0],
    });
  }, [onChangeAction]);
  return null;
}
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, BarChart, Bar } from "recharts";
// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function Bookings() {
  const [filters, setFilters] = useState<ReportsFilters | null>(null);
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!filters) return;
    api.get("/api/owner/reports/bookings", { params: filters }).then((r) => setData(r.data));
  }, [filters]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports — Bookings</h1>
      <ReportsFilter onChangeAction={setFilters} />

      {data && (
        <>
          <div className="bg-white border border-solid rounded-lg p-3">
            <div className="text-sm font-medium mb-2">Bookings Over Time</div>
            <div className="w-full h-64">
              <ResponsiveContainer>
                <LineChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" />
                  <YAxis allowDecimals={false}/>
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="count" name="Bookings" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-solid rounded-lg p-3">
            <div className="text-sm font-medium mb-2">Status Mix</div>
            <div className="w-full h-64">
              <ResponsiveContainer>
                <BarChart data={data.stacked}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  {/* Recharts stacks any unknown keys; list a few typical statuses */}
                  <Bar dataKey="PENDING" stackId="a" name="Pending" />
                  <Bar dataKey="CONFIRMED" stackId="a" name="Confirmed" />
                  <Bar dataKey="CHECKED_IN" stackId="a" name="Checked-in" />
                  <Bar dataKey="CANCELLED" stackId="a" name="Cancelled" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
