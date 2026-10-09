"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Coffee, Gift, Loader2, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type View = "due" | "serving" | "paid" | "all";
type KaribuGift = {
  id: number; status: string; payableStatus: string; amount: number; currency: string; issuedAt: string; servedAt: string | null; paidAt: string | null;
  paymentReference: string | null; orderNumber: string | null; guestName: string | null; bookingReference: string; drink: string;
};
type Karibu =
  | { visible: false }
  | {
      visible: true; enrolled: boolean; agreedAt: string | null;
      drinks: Array<{ name: string; outlet: string | null; agreedPrice: number; menuPrice: number; available: boolean }>;
      totals: { due: { count: number; amount: number }; paid: { count: number; amount: number }; serving: number; all: number };
      view: View; page: number; pageSize: number; total: number; gifts: KaribuGift[];
    };

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "due", label: "Due from NoLSAF" },
  { key: "serving", label: "Awaiting service" },
  { key: "paid", label: "Repaid" },
  { key: "all", label: "All" },
];
// Inline so no layout style can cancel it.
const BACKDROP = { backgroundColor: "rgba(2, 12, 10, 0.58)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" } as const;
const tzs = (value: number) => `TZS ${Math.round(value || 0).toLocaleString("en-US")}`;
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "Not yet");
const headCell = "px-4 py-2.5 text-[11px] font-semibold text-neutral-400";

function giftState(gift: KaribuGift) {
  if (gift.status === "ORDERED") return { label: "Awaiting service", dot: "bg-sky-500", text: "text-sky-700" };
  if (gift.payableStatus === "PAID") return { label: "Repaid", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (gift.payableStatus === "DUE") return { label: "Due from NoLSAF", dot: "bg-amber-500", text: "text-amber-700" };
  return { label: "Served", dot: "bg-emerald-500", text: "text-emerald-700" };
}

/**
 * Karibu NoLSAF for the owner or manager: one line on the Orders page with
 * what NoLSAF owes, opening the agreement, the approved drinks and every gift
 * with its repayment. Hidden for properties that never joined.
 */
export default function KaribuPanel({ propertyId, refreshKey }: { propertyId: number | null; refreshKey?: number }) {
  const [summary, setSummary] = useState<Karibu | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("due");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Karibu | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) { setSummary(null); return; }
    let live = true;
    apiClient.get<Karibu>(`/api/nrms/operations/property/${propertyId}/karibu`, { params: { view: "due" } })
      .then((r) => { if (live) setSummary(r.data); })
      .catch(() => { if (live) setSummary(null); }); // staff without access simply see nothing
    return () => { live = false; };
  }, [propertyId, refreshKey]);

  const loadDetail = useCallback(async (nextView: View, nextPage: number) => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const r = await apiClient.get<Karibu>(`/api/nrms/operations/property/${propertyId}/karibu`, { params: { view: nextView, page: nextPage } });
      setDetail(r.data);
      if (r.data.visible) {
        const fresh = r.data;
        setSummary((s) => (s && s.visible ? { ...s, totals: fresh.totals, drinks: fresh.drinks, enrolled: fresh.enrolled } : s));
      }
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { if (open) void loadDetail(view, page); }, [open, view, page, loadDetail]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!summary || !summary.visible) return null;
  const due = summary.totals.due;
  const data = detail && detail.visible ? detail : null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const countFor = (key: View) => (key === "due" ? summary.totals.due.count : key === "paid" ? summary.totals.paid.count : key === "serving" ? summary.totals.serving : summary.totals.all);

  return (
    <>
      <section className="box-border flex flex-wrap items-center gap-3 rounded-2xl border border-solid border-neutral-200 bg-white px-4 py-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Gift className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-bold text-neutral-900">Karibu NoLSAF</p>
          <p className="m-0 text-xs text-neutral-500">
            {summary.enrolled ? "First-stay welcome gifts. Serve them free; NoLSAF repays the agreed price." : "Paused. No new welcome gifts, earlier repayments still show here."}
          </p>
        </div>
        <div className="text-right">
          <p className={`m-0 text-sm font-bold tabular-nums ${due.amount > 0 ? "text-amber-700" : "text-neutral-900"}`}>{tzs(due.amount)}</p>
          <p className="m-0 text-[11px] text-neutral-500">due from NoLSAF · {due.count} {due.count === 1 ? "gift" : "gifts"}</p>
        </div>
        <button type="button" onClick={() => { setView(due.count > 0 ? "due" : "all"); setPage(1); setOpen(true); }} className="inline-flex h-9 items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800">
          View <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </section>

      {open && createPortal(
        <div className="fixed inset-0 z-[1000] box-border flex items-center justify-center p-3 sm:p-6 [&_*]:box-border" style={BACKDROP} onMouseDown={() => setOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="owner-karibu-title" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[calc(100dvh-24px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]">
            <header className="flex items-start justify-between gap-4 border-0 border-b border-solid border-neutral-200 px-5 py-4">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Guest welcome</p>
                <h2 id="owner-karibu-title" className="m-0 mt-1 text-lg font-bold text-neutral-950">Karibu NoLSAF</h2>
                <p className="m-0 mt-0.5 text-xs text-neutral-500">{summary.enrolled ? `Taking part since ${day(summary.agreedAt)}` : "Paused"}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close"><X className="h-4 w-4" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Totals */}
              <dl className="m-0 grid grid-cols-2 border-0 border-b border-solid border-neutral-200 sm:grid-cols-3">
                {[
                  ["Due from NoLSAF", tzs(summary.totals.due.amount), `${summary.totals.due.count} served ${summary.totals.due.count === 1 ? "gift" : "gifts"}`, "text-amber-700"],
                  ["Repaid to you", tzs(summary.totals.paid.amount), `${summary.totals.paid.count} ${summary.totals.paid.count === 1 ? "gift" : "gifts"}`, "text-emerald-700"],
                  ["Awaiting service", String(summary.totals.serving), "Ordered, not served yet", "text-sky-700"],
                ].map(([label, value, hint, tone], i) => (
                  <div key={label} className={`px-5 py-4 ${i > 0 ? "border-0 border-l border-solid border-neutral-200" : ""} ${i === 2 ? "col-span-2 border-l-0 border-t sm:col-span-1 sm:border-l sm:border-t-0" : ""}`}>
                    <dt className="text-[11px] font-semibold text-neutral-500">{label}</dt>
                    <dd className={`m-0 mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</dd>
                    <dd className="m-0 text-[11px] text-neutral-400">{hint}</dd>
                  </div>
                ))}
              </dl>

              {/* Agreed drinks */}
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Drinks you agreed to serve</h3>
                  <span className="text-[11px] text-neutral-400">To change a drink or price, contact NoLSAF</span>
                </div>
                {summary.drinks.length === 0 ? (
                  <p className="m-0 mt-2 text-sm text-neutral-500">No drinks approved yet.</p>
                ) : (
                  <ul className="m-0 mt-2 list-none rounded-xl border border-solid border-neutral-200 p-0">
                    {summary.drinks.map((d, i) => (
                      <li key={`${d.name}-${i}`} className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-100 px-3 py-2.5 last:border-b-0">
                        <Coffee className="h-4 w-4 shrink-0 text-neutral-400" />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-sm font-semibold text-neutral-900">{d.name}</p>
                          <p className="m-0 text-[11px] text-neutral-400">{d.outlet || "Outlet"} · menu {tzs(d.menuPrice)}</p>
                        </div>
                        {!d.available && <span className="text-[11px] font-semibold text-amber-700">Out of stock, cannot be offered</span>}
                        <span className="text-sm font-bold tabular-nums text-neutral-900">{tzs(d.agreedPrice)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Gifts */}
              <div className="border-0 border-t border-solid border-neutral-200">
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">Welcome gifts</h3>
                  <div className="ml-auto flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Gift status">
                    {VIEWS.map((v) => (
                      <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => { setView(v.key); setPage(1); }} className={`inline-flex h-7 items-center gap-1.5 rounded-md border-0 px-2.5 text-[11px] font-semibold transition-colors ${view === v.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
                        {v.label} <span className="tabular-nums text-neutral-400">{countFor(v.key)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {loading && !data ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
                ) : !data || data.gifts.length === 0 ? (
                  <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-10 text-center text-sm text-neutral-500">No gifts in this view.</p>
                ) : (
                  <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
                    <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
                      <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                        <thead>
                          <tr>
                            <th className={`${headCell} pl-5`}>Guest</th>
                            <th className={headCell}>Drink</th>
                            <th className={headCell}>Served</th>
                            <th className={`${headCell} text-right`}>Amount</th>
                            <th className={`${headCell} pr-5`}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.gifts.map((g) => {
                            const s = giftState(g);
                            return (
                              <tr key={g.id} className="border-0 border-t border-solid border-neutral-100">
                                <td className="px-4 py-3 pl-5">
                                  <p className="m-0 max-w-[13rem] truncate font-medium text-neutral-900">{g.guestName || "Guest"}</p>
                                  <p className="m-0 font-mono text-[11px] text-neutral-400">{g.orderNumber || g.bookingReference}</p>
                                </td>
                                <td className="px-4 py-3 text-neutral-700">{g.drink}</td>
                                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500">{g.servedAt ? day(g.servedAt) : "Not yet"}</td>
                                <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">{tzs(g.amount)}</td>
                                <td className="px-4 py-3 pr-5">
                                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${s.text}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />{s.label}</span>
                                  {g.payableStatus === "PAID" && <p className="m-0 mt-0.5 text-[11px] text-neutral-400">{day(g.paidAt)}{g.paymentReference ? ` · ref ${g.paymentReference}` : ""}</p>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between border-0 border-t border-solid border-neutral-100 px-5 py-3 text-xs text-neutral-500">
                        <span className="tabular-nums">Page {data.page} of {totalPages}</span>
                        <div className="flex gap-1.5">
                          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-600 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <footer className="border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3 text-xs leading-5 text-neutral-600">
              A Karibu NoLSAF order is never charged to the guest or the room. Mark it served when it reaches the guest; NoLSAF then repays the agreed price.
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
