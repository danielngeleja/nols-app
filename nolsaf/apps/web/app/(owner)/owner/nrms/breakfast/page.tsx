"use client";

// NRMS breakfast list: the sheet the restaurant serves the morning from.
// Produced at night audit for the morning ahead, which is why the date
// defaults to tomorrow rather than today.

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  BedDouble,
  CheckCircle2,
  Coffee,
  FileDown,
  Loader2,
  RefreshCw,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../_components/NrmsProvider";

type Row = {
  sn: number;
  reservationId: number;
  fullName: string;
  roomType: string;
  roomNo: string;
  floor: number | null;
  adults: number;
  children: number;
  mealPlan: string | null;
  mealPlanLabel: string;
  entitled: boolean;
  remark: string;
};

type Totals = {
  rooms: number;
  parties: number;
  adults: number;
  children: number;
  covers: number;
  entitledRooms: number;
  entitledCovers: number;
  unverified: number;
};

type BreakfastList = {
  serviceDate: string;
  nightOf: string;
  property: { id: number; title: string };
  rows: Row[];
  totals: Totals;
};

const actionClass =
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-3.5 text-xs font-semibold text-neutral-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";
/** Tomorrow, matching the server default: the list is prepared the night before service. */
function tomorrow(): string {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

function dayLabel(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function breakfastPdfFilename(propertyName: string, serviceDate: string): string {
  const safeProperty = propertyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 &()_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "HOTEL";
  return `${safeProperty}_BREAKFAST_${serviceDate.replace(/-/g, "")}.pdf`;
}

export default function BreakfastListPage() {
  const { selectedPropertyId } = useNrms();
  const [serviceDate, setServiceDate] = useState(tomorrow());
  const [entitledOnly, setEntitledOnly] = useState(false);
  const [list, setList] = useState<BreakfastList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/breakfast-list`, {
        params: { date: serviceDate, ...(entitledOnly ? { entitledOnly: "1" } : {}) },
      });
      setList(response.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the breakfast list.");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, serviceDate, entitledOnly]);

  useEffect(() => { void load(); }, [load]);

  // The PDF is generated server-side by the same builder as this table, so the
  // printed sheet and the screen can never disagree.
  const openPdf = async () => {
    if (!selectedPropertyId) return;
    setError("");
    try {
      const response = await apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/breakfast-list.pdf`, {
        params: { date: serviceDate, ...(entitledOnly ? { entitledOnly: "1" } : {}) },
        responseType: "blob",
      });
      const pdf = new Blob([response.data], { type: "application/pdf" });
      const url = URL.createObjectURL(pdf);
      const download = document.createElement("a");
      download.href = url;
      download.download = breakfastPdfFilename(list?.property.title || "Hotel", serviceDate);
      download.style.display = "none";
      document.body.appendChild(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not generate the breakfast list PDF.");
    }
  };

  const totals = list?.totals;
  const summaryCards = totals
    ? [
        {
          label: "Room coverage",
          value: totals.rooms,
          unit: totals.rooms === 1 ? "room" : "rooms",
          detail: `${totals.parties} ${totals.parties === 1 ? "party" : "parties"}`,
          icon: BedDouble,
          tone: "slate",
        },
        {
          label: "Guest mix",
          value: totals.covers,
          unit: "total covers",
          detail: `${totals.adults} adults · ${totals.children} children`,
          icon: UsersRound,
          tone: "blue",
        },
        {
          label: "Breakfast entitlement",
          value: totals.entitledCovers,
          unit: "entitled covers",
          detail: `${totals.entitledRooms} of ${totals.rooms} rooms`,
          icon: UtensilsCrossed,
          tone: "emerald",
        },
      ]
    : [];

  return (
    <div id="nrms-breakfast" className="w-full max-w-none space-y-5">
      <style>{`#nrms-breakfast, #nrms-breakfast * { box-sizing: border-box; }`}</style>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_18px_55px_-44px_rgba(15,23,42,0.35)]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <Coffee className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Front office → restaurant</p>
                <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight text-neutral-950">Breakfast service list</h1>
                <p className="mb-0 mt-1.5 max-w-3xl text-xs leading-5 text-neutral-500">
                  A controlled morning handover for rooms that stayed overnight. Departures are included; same-day evening arrivals are excluded.
                </p>
              </div>
            </div>

            <div className="flex w-full flex-nowrap items-center justify-end gap-2 xl:w-auto">
              <div className="w-[140px] shrink-0">
                <DatePickerField
                  label="Breakfast service date"
                  value={serviceDate}
                  onChangeAction={(next) => setServiceDate(next.slice(0, 10))}
                  allowPast
                  twoMonths={false}
                  size="sm"
                  widthClassName="!w-full"
                />
              </div>
              <button type="button" onClick={() => void openPdf()} disabled={loading || !list} className={`${actionClass} !border-emerald-700 !bg-emerald-700 !px-2.5 !text-white hover:!bg-emerald-800`}>
                <FileDown className="h-4 w-4" aria-hidden />
                Export PDF
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className={`${actionClass} w-10 px-0`}
                aria-label="Refresh breakfast list"
                title="Refresh breakfast list"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-neutral-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">
                {list ? `${dayLabel(list.serviceDate)} · night covered: ${dayLabel(list.nightOf)}` : "Prepared the night before service"}
              </span>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 lg:justify-start">
              <span>Breakfast-entitled rooms only</span>
              <span className={`relative h-5 w-9 rounded-full transition ${entitledOnly ? "bg-emerald-600" : "bg-neutral-300"}`}>
                <input type="checkbox" checked={entitledOnly} onChange={(e) => setEntitledOnly(e.target.checked)} className="sr-only" />
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${entitledOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </label>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}

      {totals && (
        <div className="grid gap-3 md:grid-cols-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const iconTone = card.tone === "emerald" ? "bg-emerald-50 text-emerald-700" : card.tone === "blue" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600";
            return (
              <div key={card.label} className="flex min-w-0 items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.45)]">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconTone}`}>
                  <Icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{card.label}</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums text-neutral-950">{card.value}</span>
                    <span className="truncate text-xs font-medium text-neutral-500">{card.unit}</span>
                  </div>
                  <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-400">{card.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totals && totals.unverified > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {totals.unverified} room(s) have no meal plan on file and print as Verify. They are listed rather than dropped, because a guest wrongly
            turned away is worse than one wrongly served. Set a default rate plan in Hotel controls to clear this.
          </span>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_45px_-38px_rgba(15,23,42,0.45)]">
        <div className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-neutral-900">Service register</h2>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-500">{list?.rows.length ?? 0}</span>
            </div>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-400">Sorted by room number for quick floor service.</p>
          </div>
          {totals && totals.unverified === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Meal plans verified
            </span>
          ) : null}
        </div>
        {loading ? (
          <div className="grid min-h-56 place-items-center text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !list || list.rows.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <p className="mb-0 text-sm font-bold text-neutral-800">No occupied rooms for this morning</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Nothing slept in the house on the night this service covers.</p>
            </div>
          </div>
        ) : (
          <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
                  <th className="w-14 px-5 py-3 font-semibold">No.</th>
                  <th className="px-4 py-3 font-semibold">Guest</th>
                  <th className="px-4 py-3 font-semibold">Room type</th>
                  <th className="px-4 py-3 text-center font-semibold">Room</th>
                  <th className="px-4 py-3 text-center font-semibold">Pax</th>
                  <th className="px-4 py-3 font-semibold">Meal plan</th>
                  <th className="px-5 py-3 font-semibold">Service notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {list.rows.map((row) => (
                  <tr key={`${row.reservationId}-${row.sn}`} className="transition-colors hover:bg-emerald-50/30">
                    <td className="px-5 py-3.5 text-xs tabular-nums text-neutral-400">{String(row.sn).padStart(2, "0")}</td>
                    <td className="px-4 py-3.5 text-xs font-semibold text-neutral-900">{row.fullName}</td>
                    <td className="px-4 py-3.5 text-xs text-slate-600">{row.roomType}</td>
                    <td className="px-4 py-3.5 text-center text-xs font-semibold text-neutral-900">
                      {row.roomNo || <span className="font-normal text-amber-600">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3.5 text-center text-xs tabular-nums text-slate-600">{row.adults} + {row.children}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                          row.entitled
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : row.mealPlan
                              ? "border-neutral-200 bg-neutral-100 text-neutral-500"
                              : "border-amber-100 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {row.mealPlanLabel}
                      </span>
                    </td>
                    <td className="max-w-[280px] px-5 py-3.5 text-xs text-neutral-500">{row.remark || <span className="text-neutral-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-neutral-100 md:hidden">
            {list.rows.map((row) => (
              <article key={`mobile-${row.reservationId}-${row.sn}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-neutral-900">{row.fullName}</p>
                    <p className="mb-0 mt-1 text-xs text-neutral-500">{row.roomType} · Room {row.roomNo || "unassigned"}</p>
                  </div>
                  <span className="rounded-lg bg-neutral-100 px-2 py-1 text-[10px] font-semibold tabular-nums text-neutral-500">{row.adults} + {row.children} pax</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className={`whitespace-nowrap rounded-lg border px-2 py-1 text-[10px] font-semibold ${row.entitled ? "border-emerald-100 bg-emerald-50 text-emerald-700" : row.mealPlan ? "border-neutral-200 bg-neutral-100 text-neutral-500" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                    {row.mealPlanLabel}
                  </span>
                  <span className="min-w-0 truncate text-right text-[11px] text-neutral-400">{row.remark || "No service notes"}</span>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </section>
    </div>
  );
}
