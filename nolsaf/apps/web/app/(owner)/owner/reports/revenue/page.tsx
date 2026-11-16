"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import TableRow from "@/components/TableRow";
import ReportsFilter, { ReportsFilters } from "@/components/ReportsFilter";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";

const api = apiClient;

export default function Revenue() {
  const [filters, setFilters] = useState<ReportsFilters | null>(null);
  const [data, setData] = useState<any>(null);
  useEffect(() => { if (!filters) return; api.get("/api/owner/reports/revenue", { params: filters }).then(r => setData(r.data)); }, [filters]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports — Revenue</h1>
      <ReportsFilter onChangeAction={setFilters} />

      {data && (
        <>
          <div className="bg-white border rounded-lg p-3">
            <div className="text-sm font-medium mb-2">Amount Paid vs Your Payout</div>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="gross" name="Amount Paid" />
                  <Line type="monotone" dataKey="net" name="Your Payout" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-900">Payout by Property</div>
              <div className="text-xs text-gray-500 mt-0.5">Total customer payments and your net payout per property</div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <th className="text-left px-5 py-3 font-medium">Property</th>
                  <th className="text-right px-5 py-3 font-medium">Your Payout</th>
                </tr>
              </thead>
              <tbody>
                {data.byProperty.map((p: any) => (
                  <tr key={p.title} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{p.title}</td>
                    <td className="px-5 py-3 text-right font-semibold text-emerald-700">TZS {fmt(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border rounded-lg p-3 overflow-x-auto">
            <div className="text-sm font-medium mb-2">Invoices</div>
            <table className="w-full text-sm">
              <thead><tr className="[&>th]:text-left [&>th]:py-2">
                <th>Date</th><th>Invoice</th><th>Property</th><th>Amount Paid</th><th>Your Payout</th><th>Status</th>
              </tr></thead>
              <tbody>
                {data.table.filter((r:any) => String(r.invoiceNumber ?? "").startsWith("OINV")).map((r:any)=>(
                  <TableRow key={r.id} className="border-t">
                    <td>{new Date(r.issuedAt).toLocaleDateString()}</td>
                    <td>{r.invoiceNumber}</td>
                    <td>{r.property}</td>
                    <td>TZS {fmt(r.gross)}</td>
                    <td>TZS {fmt(r.net)}</td>
                    <td>{r.status}</td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
function fmt(n:number){ return Math.round(Number(n)).toLocaleString(); }
