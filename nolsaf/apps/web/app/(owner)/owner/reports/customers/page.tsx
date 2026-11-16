"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import ReportsFilter, { ReportsFilters } from "@/components/ReportsFilter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function Customers() {
  const [filters, setFilters] = useState<ReportsFilters | null>(null);
  const [data, setData] = useState<any>(null);
  useEffect(()=>{ if(!filters) return; api.get("/api/owner/reports/customers",{params:filters}).then(r=>setData(r.data));},[filters]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports — Customers</h1>
      <ReportsFilter onChangeAction={setFilters} />

      {data && (
        <>
          <div className="bg-white border border-solid rounded-lg p-3">
            <div className="text-sm font-medium mb-2">Guests by Nationality</div>
            <div className="w-full h-64">
              <ResponsiveContainer>
                <BarChart data={data.byNationality} barCategoryGap={18}>
                  <defs>
                    <linearGradient id="nolsafBrandBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#02665e" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#02665e" stopOpacity={0.65} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="nationality" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Guests" fill="url(#nolsafBrandBar)" radius={[8, 8, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-solid rounded-lg p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-sm font-medium">Top Customers</div>
              <div className="text-xs text-slate-500">Sorted by spend</div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[680px]">
                <div className="max-h-[520px] overflow-auto rounded-md border border-solid">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr className="text-xs font-semibold tracking-wide text-slate-600">
                        <th className="w-12 px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="w-24 px-3 py-2 text-right">Stays</th>
                        <th className="w-40 px-3 py-2 text-right">Spend (TZS)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.topCustomers.map((c: any, idx: number) => (
                        <tr key={`${c.name}-${idx}`} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="max-w-[420px] truncate font-medium text-slate-900" title={c.name}>
                              {c.name}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900">{c.stays}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                            {Number(c.spend).toLocaleString()}
                          </td>
                        </tr>
                      ))}

                      {data.topCustomers.length === 0 && (
                        <tr>
                          <td className="px-3 py-8 text-center text-slate-500" colSpan={4}>
                            No data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
