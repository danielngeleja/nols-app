"use client";

/**
 * The admin switch that lets one landlord list long stays
 * (docs/LONG_STAY_RENTALS.md, decision 7). Pause and switch off need a reason;
 * every change is audited on the server.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Summary = {
  granted: boolean;
  paused: boolean;
  pauseReason: string | null;
  enabledAt: string | null;
  listings: Array<{ title: string; status: string }>;
};
type Action = "ENABLE" | "DISABLE" | "PAUSE" | "RESUME";

export default function OwnerLongStayCard({ ownerId }: { ownerId: number }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<"PAUSE" | "DISABLE" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<Summary>(`/api/admin/long-stay/landlords/${ownerId}`);
      setData(response.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [ownerId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: Action) => {
    if ((action === "PAUSE" || action === "DISABLE") && reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post<Summary>(`/api/admin/long-stay/landlords/${ownerId}`, { action, reason: reason.trim() || null });
      setData(response.data);
      setAsking(null);
      setReason("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (failed) return null;

  const state = !data ? "loading" : !data.granted ? "off" : data.paused ? "paused" : "on";
  const chip = state === "on" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : state === "paused" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-gray-50 text-gray-500 ring-gray-200";
  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-60";

  return (
    <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarRange className="h-4 w-4 shrink-0 text-[#02665e]" />
          <h3 className="m-0 truncate text-sm font-bold text-slate-900">Long stays</h3>
        </div>
        {data ? <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ${chip}`}>{state === "on" ? "On" : state === "paused" ? "Paused" : "Off"}</span> : null}
      </div>

      {!data ? (
        <div className="mt-3 flex justify-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : (
        <>
          <p className="m-0 mt-2 text-xs leading-5 text-gray-600">
            {state === "off" ? "This owner can only list by the night. Switch on to let them list homes for monthly rent."
              : state === "paused" ? `Paused${data.pauseReason ? `: ${data.pauseReason}` : ""}. New long-stay listings, submits and approvals are blocked.`
              : `Can list homes for monthly rent${data.enabledAt ? ` since ${new Date(data.enabledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}` : ""}.`}
          </p>

          {data.listings.length ? (
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {data.listings.slice(0, 4).map((listing, index) => (
                <li key={`${listing.title}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-gray-700">{listing.title}</span>
                  <span className="shrink-0 text-gray-400">{listing.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {asking ? (
            <div className="mt-3">
              <label htmlFor="long-stay-reason" className="block text-xs font-semibold text-gray-700">
                {asking === "PAUSE" ? "Why pause?" : "Why switch off?"}
              </label>
              <input
                id="long-stay-reason"
                value={reason}
                onChange={(event) => { setReason(event.target.value); setError(""); }}
                maxLength={300}
                autoFocus
                className="mt-1 h-9 w-full rounded-md border border-solid border-gray-300 px-2.5 text-sm outline-none focus:border-[#02665e]"
              />
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => act(asking)} className={`${btn} flex-1 border-0 bg-amber-600 text-white hover:bg-amber-700`}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{asking === "PAUSE" ? "Pause" : "Switch off"}
                </button>
                <button type="button" onClick={() => { setAsking(null); setReason(""); setError(""); }} className={`${btn} border border-solid border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {state === "off" ? (
                <button type="button" disabled={busy} onClick={() => act("ENABLE")} className={`${btn} w-full border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Switch on
                </button>
              ) : (
                <>
                  {state === "paused" ? (
                    <button type="button" disabled={busy} onClick={() => act("RESUME")} className={`${btn} flex-1 border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Resume</button>
                  ) : (
                    <button type="button" onClick={() => setAsking("PAUSE")} className={`${btn} flex-1 border border-solid border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>Pause</button>
                  )}
                  <button type="button" onClick={() => setAsking("DISABLE")} className={`${btn} border border-solid border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>Switch off</button>
                </>
              )}
            </div>
          )}
          {error ? <p className="m-0 mt-2 text-xs text-red-700">{error}</p> : null}
        </>
      )}
    </div>
  );
}
