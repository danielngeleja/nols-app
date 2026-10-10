"use client";

import "@/styles/globals.css";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Clock3, LogOut, ShieldCheck } from "lucide-react";
import OwnerSiteHeader from "@/components/OwnerSiteHeader";
import OwnerFooter from "@/components/OwnerFooter";
import OwnerSidebar from "@/components/OwnerSidebar";
import MobileOwnerNav from "@/components/MobileOwnerNav";
import apiClient, { clearAuthToken } from "@/lib/apiClient";

export default function OwnerLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [supportSession, setSupportSession] = useState<{
    impersonated: boolean;
    canReturn: boolean;
    ownerEmail: string | null;
    expiresAt: number | null;
  } | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    apiClient.get<{ impersonated: boolean; canReturn: boolean; ownerEmail: string | null; expiresAt: number | null }>("/api/auth/impersonation/status")
      .then(({ data }) => { if (mounted) setSupportSession(data); })
      .catch(() => { if (mounted) setSupportSession(null); });
    return () => { mounted = false; };
  }, [pathname]);

  useEffect(() => {
    if (!supportSession?.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const untilWarning = supportSession.expiresAt - Date.now() - 5 * 60_000;
    const warningTimer = window.setTimeout(() => setNow(Date.now()), Math.max(0, untilWarning));
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(warningTimer);
    };
  }, [supportSession?.expiresAt]);

  const isSupportSession = Boolean(supportSession?.impersonated || supportSession?.canReturn);
  const remainingMs = supportSession?.expiresAt ? supportSession.expiresAt - now : null;
  const minutesLeft = supportSession?.expiresAt
    ? Math.max(0, Math.ceil((remainingMs ?? 0) / 60_000))
    : null;
  const urgentSupportSession = isSupportSession && (
    !supportSession?.impersonated || (remainingMs !== null && remainingMs <= 5 * 60_000)
  );
  const isNrmsPage = pathname.startsWith("/owner/nrms");

  async function returnToAdmin() {
    if (!supportSession?.canReturn) {
      window.location.assign("/api/auth/logout?next=/login");
      return;
    }
    setReturning(true);
    setReturnError("");
    try {
      const { data } = await apiClient.post<{ ok: boolean; redirectTo: string }>("/api/auth/impersonation/end");
      if (!data.ok || !data.redirectTo.startsWith("/admin/owners")) throw new Error("Could not restore administrator session");
      clearAuthToken();
      window.location.replace(data.redirectTo);
    } catch (error: any) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        setSupportSession((current) => current ? { ...current, canReturn: false } : current);
        setReturnError("Your administrator session expired. Sign out to continue.");
      } else {
        setReturnError("Could not return to Admin. Please try again.");
      }
      setReturning(false);
    }
  }

  const supportBanner = isSupportSession ? (
    <section aria-label="Admin support session" className="relative z-[70] box-border w-full min-w-0 max-w-full">
      <div className={`box-border w-full min-w-0 overflow-hidden rounded-2xl border shadow-[0_16px_40px_-20px_rgba(1,42,38,0.5),0_4px_14px_-7px_rgba(1,42,38,0.18)] ${urgentSupportSession ? "border-rose-300 bg-rose-50" : "border-[#b9ddd6] bg-white"}`}>
        <div className="flex min-h-[4.5rem] min-w-0 items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${urgentSupportSession ? "bg-rose-100 text-rose-700" : "bg-[#e7f6f1] text-[#02665e]"}`} aria-hidden="true">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong className={`text-sm font-bold leading-tight sm:text-base ${urgentSupportSession ? "text-rose-950" : "text-[#123c37]"}`}>
                {supportSession?.impersonated ? "Support session" : "Support session ended"}
              </strong>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${urgentSupportSession ? "border-rose-300 bg-white/80 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                {supportSession?.impersonated ? "Read only" : "Expired"}
              </span>
            </div>
            <p className={`mt-0.5 truncate text-xs sm:text-sm ${urgentSupportSession ? "text-rose-800" : "text-slate-600"}`} title={supportSession?.ownerEmail || undefined}>
              {supportSession?.impersonated
                ? supportSession.ownerEmail ? `Viewing ${supportSession.ownerEmail}` : "Viewing the owner's workspace"
                : "Return to your administrator workspace"}
            </p>
          </div>
          {minutesLeft !== null && (
            <span className={`hidden shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 md:inline-flex ${urgentSupportSession ? "bg-white/80 text-rose-800 ring-rose-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {minutesLeft > 0 ? `${minutesLeft} min left` : "Expired"}
            </span>
          )}
          <button
            type="button"
            onClick={returnToAdmin}
            disabled={returning}
            aria-label={supportSession?.canReturn ? "Return to Admin" : "Sign out of support session"}
            className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold text-white shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 sm:px-4 sm:text-sm ${urgentSupportSession ? "border-rose-700 bg-rose-700 hover:bg-rose-800 focus-visible:outline-rose-700" : "border-[#02665e] bg-[#02665e] hover:bg-[#014e49] focus-visible:outline-[#02665e]"}`}
          >
            {supportSession?.canReturn ? <ArrowLeft className="h-4 w-4" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{returning ? "Returning…" : supportSession?.canReturn ? "Return to Admin" : "Sign out"}</span>
            <span className="sm:hidden">{returning ? "Wait…" : supportSession?.canReturn ? "Return" : "Sign out"}</span>
          </button>
        </div>
        {returnError && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-800">{returnError}</p>}
      </div>
    </section>
  ) : null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch("/api/owner/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
        });
        if (!response.ok || !mounted) return;
        const payload = await response.json();
        setUnreadCount(Number(payload?.totalUnread ?? payload?.total ?? 0));
      } catch {
        // Notification count is non-critical layout data.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        setSidebarOpen((current) => !current);
      } else {
        setMobileSidebarOpen((current) => !current);
      }
    };
    window.addEventListener("toggle-owner-sidebar", handler as EventListener);
    return () => window.removeEventListener("toggle-owner-sidebar", handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  // NRMS remains a self-contained operational workspace with its own shell.
  if (isNrmsPage) {
    return <div className="min-h-screen min-w-0 bg-neutral-100">{supportBanner && <div className="box-border w-full px-3 pb-2 pt-3">{supportBanner}</div>}{children}</div>;
  }

  return (
    <div className="owner-workspace flex h-dvh min-h-[36rem] min-w-0 flex-col overflow-hidden bg-neutral-100">
      <OwnerSiteHeader unreadMessages={unreadCount} />
      <div className="box-border w-full shrink-0 px-3 pt-16">
        {supportBanner && <div className="pb-2 pt-2">{supportBanner}</div>}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`hidden shrink-0 p-3 pr-0 transition-[width] duration-300 ease-in-out md:block ${
            sidebarOpen ? "w-[15rem]" : "w-[4.75rem]"
          }`}
        >
          <aside className="owner-sidebar-container h-full min-h-0" aria-label="Owner workspace navigation">
            <OwnerSidebar collapsed={!sidebarOpen} />
          </aside>
        </div>

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 border-0 bg-black/35 backdrop-blur-sm nols-soft-overlay"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-0 top-16 w-[min(18rem,calc(100vw-1rem))] p-3 nols-soft-popover">
              <div
                className="h-full min-h-0"
                onClickCapture={(event) => {
                  const target = event.target as HTMLElement | null;
                  if (target?.closest("a[href]")) setMobileSidebarOpen(false);
                }}
              >
                <OwnerSidebar collapsed={false} />
              </div>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-24 pt-3 sm:px-3 md:pb-3">
            <div className="w-full min-w-0 max-w-none">{children}</div>
          </main>

          <div className="hidden shrink-0 md:block">
            <OwnerFooter />
          </div>
        </div>
      </div>

      <MobileOwnerNav />
    </div>
  );
}
