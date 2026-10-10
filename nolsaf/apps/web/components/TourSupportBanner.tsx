"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Clock3, ShieldCheck } from "lucide-react";
import apiClient, { clearAuthToken } from "@/lib/apiClient";

type SupportStatus = {
  impersonated: boolean;
  canReturn: boolean;
  targetRole: string | null;
  ownerEmail: string | null;
  expiresAt: number | null;
};

export default function TourSupportBanner() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    apiClient.get<SupportStatus>("/api/auth/impersonation/status")
      .then(({ data }) => { if (mounted) setStatus(data); })
      .catch(() => { if (mounted) setStatus(null); });
    return () => { mounted = false; };
  }, [pathname]);

  useEffect(() => {
    if (!status?.expiresAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    const warning = window.setTimeout(() => setNow(Date.now()), Math.max(0, status.expiresAt - Date.now() - 5 * 60_000));
    return () => { window.clearInterval(interval); window.clearTimeout(warning); };
  }, [status?.expiresAt]);

  if (!status?.impersonated || status.targetRole !== "AGENT") return null;

  const remaining = status.expiresAt == null ? null : status.expiresAt - now;
  const minutes = remaining == null ? null : Math.max(0, Math.ceil(remaining / 60_000));
  const urgent = remaining != null && remaining <= 5 * 60_000;

  async function returnToAdmin() {
    if (!status?.canReturn) {
      window.location.assign("/api/auth/logout?next=/login");
      return;
    }
    setReturning(true);
    setError("");
    try {
      const { data } = await apiClient.post<{ ok: boolean; redirectTo: string }>("/api/auth/impersonation/end");
      if (!data.ok || data.redirectTo !== "/admin/agents") throw new Error("Administrator session could not be restored");
      clearAuthToken();
      window.location.replace(data.redirectTo);
    } catch {
      setError("Could not return to Admin. Sign in again if this session has expired.");
      setReturning(false);
    }
  }

  return (
    <section aria-label="Tour operator support session" className={`mt-2 box-border w-full min-w-0 rounded-2xl border px-3 py-2.5 shadow-sm sm:px-4 ${urgent ? "border-rose-300 bg-rose-50" : "border-emerald-200 bg-white"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${urgent ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700"}`} aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className={`m-0 text-sm font-bold ${urgent ? "text-rose-950" : "text-emerald-950"}`}>Support session <span className="ml-1 rounded-full border border-current px-1.5 py-0.5 text-[10px] uppercase">Read only</span></p>
          <p className={`m-0 mt-1 truncate text-xs ${urgent ? "text-rose-800" : "text-slate-600"}`} title={status.ownerEmail || undefined}>{status.ownerEmail ? `Viewing ${status.ownerEmail}` : "Viewing tour operator workspace"}</p>
        </div>
        {minutes !== null && <span className={`hidden shrink-0 items-center gap-1 text-xs md:inline-flex ${urgent ? "text-rose-800" : "text-slate-600"}`}><Clock3 className="h-4 w-4" aria-hidden="true" />{minutes} min left</span>}
        <button type="button" onClick={() => void returnToAdmin()} disabled={returning} className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold text-white disabled:opacity-60 ${urgent ? "border-rose-700 bg-rose-700" : "border-emerald-700 bg-emerald-700"}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{returning ? "Returning…" : status.canReturn ? "Return to Admin" : "Sign out"}</span><span className="sm:hidden">{returning ? "Wait…" : status.canReturn ? "Return" : "Sign out"}</span></button>
      </div>
      {error && <p role="alert" className="m-0 mt-2 rounded-lg bg-rose-100 px-3 py-2 text-xs font-medium text-rose-800">{error}</p>}
    </section>
  );
}
