"use client";

// Search approved operator tour packages and pick one to recommend. Prices are
// what the client pays per person at checkout; the partner never sets them.
import { useEffect, useState } from "react";
import { Check, Loader2, MapPin, Search, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type TourOption = {
  key: string;
  title: string;
  operator: string;
  destination: string | null;
  category: string | null;
  clientPricePerPerson: number;
  currency: string;
  minPax: number;
  maxPax: number;
  duration: string | null;
};

const money = (v: number, c = "TZS") => `${c === "TZS" ? "TSh" : c} ${Math.round(v).toLocaleString("en-US")}`;

export default function TourPicker({ selected, onPick }: { selected: TourOption | null; onPick: (tour: TourOption) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<TourOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiClient.get("/api/sales/agency/tours", { params: q.trim() ? { q: q.trim() } : {} });
        if (alive) {
          setItems(res.data?.items || []);
          setError("");
        }
      } catch (cause: any) {
        if (alive) setError(cause?.response?.data?.error || "Could not load tours.");
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tours by name, place or operator" aria-label="Search tours"
          className="block min-h-10 w-full rounded-lg border border-solid border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
      </div>
      {error ? <p className="m-0 mt-2 text-sm text-red-700">{error}</p> : null}
      <ul className="m-0 mt-2 max-h-72 list-none space-y-1.5 overflow-y-auto p-0">
        {loading && !items.length ? (
          <li className="grid h-20 place-items-center text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></li>
        ) : items.length ? items.map((t) => {
          const on = selected?.key === t.key;
          return (
            <li key={t.key}>
              <button type="button" onClick={() => onPick(t)} aria-pressed={on}
                className={`flex w-full items-start gap-3 rounded-lg border border-solid px-3 py-2.5 text-left ${on ? "border-emerald-400 bg-emerald-50/60" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-solid ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}>{on ? <Check className="h-3 w-3" /> : null}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{t.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span>{t.operator}</span>
                    {t.destination ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{t.destination}</span> : null}
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{t.minPax} to {t.maxPax}</span>
                    {t.duration ? <span>{t.duration}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{money(t.clientPricePerPerson, t.currency)}<span className="block text-[11px] font-normal text-slate-500">per person</span></span>
              </button>
            </li>
          );
        }) : (
          <li className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">No tours match. Only tours from approved operators are listed.</li>
        )}
      </ul>
    </div>
  );
}
