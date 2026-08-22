"use client";

// NRMS Agent B2B portal shell: sidebar, header and operational footer, mirroring
// the sales workspace frame. Every page in the (agent) route group renders inside
// this. Identity comes from /api/agent-portal/hotels, which is session gated on
// the server; the shell shows nothing sensitive on its own.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { BadgeCheck, Building2, CalendarSearch, ClipboardList, Handshake, Loader2, LogOut, Menu, ShieldAlert, X } from "lucide-react";

const NAV = [
  { href: "/agent-portal", label: "Book a stay", Icon: CalendarSearch },
  { href: "/agent-portal/partners", label: "Partner hotels", Icon: Handshake },
  { href: "/agent-portal/bookings", label: "My bookings", Icon: ClipboardList },
  { href: "/agent-portal/profile", label: "Agency profile & KYC", Icon: Building2 },
];

type Agency = { legalName: string; tradingName: string | null; reference: string; verificationStatus: string; status: string };

function initials(name?: string | null) {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (w.length ? (w[0]![0]! + (w[1]?.[0] ?? "")) : "AG").toUpperCase();
}

function HealthFooter() {
  const [ok, setOk] = useState<"checking" | "up" | "down">("checking");
  useEffect(() => {
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const r = await fetch("/api/ready", { cache: "no-store", credentials: "include", signal: ctrl.signal });
        const p = await r.json().catch(() => null);
        setOk(r.ok && p?.status === "ready" ? "up" : "down");
      } catch (e) { if ((e as Error).name !== "AbortError") setOk("down"); }
    };
    void run();
    const t = window.setInterval(() => void run(), 60_000);
    return () => { ctrl.abort(); window.clearInterval(t); };
  }, []);
  const tone = ok === "up" ? "bg-emerald-500" : ok === "down" ? "bg-red-500" : "bg-amber-400";
  const label = ok === "up" ? "All systems operational" : ok === "down" ? "Service unavailable" : "Checking status";
  return (
    <footer className="mx-3 mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-solid border-neutral-200 bg-white px-4 py-2.5">
      <span className="flex items-center gap-2 text-[11px] font-medium text-neutral-500"><span className={`h-2 w-2 rounded-full ${tone}`} /> {label}</span>
      <span className="text-[11px] text-neutral-400">NoLSAF Travel Agent Portal</span>
    </footer>
  );
}

export default function AgentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiClient.get<any>("/api/agent-portal/hotels");
        if (live) setAgency(res.data?.agency ?? null);
      } catch (e: any) {
        if (e?.response?.status === 401) { router.replace("/login"); return; }
        if (e?.response?.status === 403) { router.replace("/account/agent"); return; }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [router]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try { await apiClient.post("/api/auth/logout", {}); } catch { /* ignore */ }
    router.replace("/login");
  }, [router]);

  const verified = agency?.verificationStatus === "VERIFIED";
  const currentNav = NAV.find(({ href }) => href === "/agent-portal" ? pathname === href : pathname.startsWith(href)) ?? NAV[0];
  const CurrentSectionIcon = currentNav.Icon;

  const sidebar = (
    <div className="relative flex h-full w-[17rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-[0_18px_44px_-24px_rgba(15,23,42,0.28)]">
      <div className="relative flex items-center gap-3 px-4 pb-3 pt-4">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
          <Handshake className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[14px] font-extrabold leading-tight tracking-[-0.015em] text-neutral-950">Agent Portal</p>
          <p className="m-0 mt-1 text-[10px] font-medium text-neutral-400">
            Travel partner workspace
          </p>
        </div>
        <button type="button" onClick={() => setMobileOpen(false)} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900 lg:hidden" aria-label="Close navigation">
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-label="Agent portal navigation">
        <div className="rounded-2xl border border-solid border-neutral-200 bg-neutral-50 p-1.5">
          {NAV.map(({ href, label, Icon }) => {
            const active = href === "/agent-portal" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`group mb-0.5 flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-left no-underline outline-none transition-all duration-150 last:mb-0 focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${active ? "bg-neutral-900 text-white shadow-sm" : "text-neutral-600 hover:bg-white hover:text-neutral-950"}`}
              >
                <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg transition-colors duration-150 ${active ? "bg-white/10 text-white" : "bg-white text-neutral-400 shadow-sm ring-1 ring-neutral-200/70 group-hover:text-neutral-700"}`}>
                  <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
                </span>
                <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${active ? "text-white" : "text-neutral-700"}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="relative flex-shrink-0 border-0 border-t border-solid border-neutral-100 bg-white p-3">
        <div className="px-1 py-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-neutral-100 text-[10px] font-extrabold text-neutral-700 ring-1 ring-neutral-200">
              {initials(agency?.legalName)}
            </span>
            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="space-y-1.5">
                  <span className="block h-3 w-28 animate-pulse rounded bg-neutral-200" />
                  <span className="block h-2 w-16 animate-pulse rounded bg-neutral-200/70" />
                </div>
              ) : (
                <>
                  <p className="m-0 truncate text-[11px] font-bold text-neutral-800">{agency?.tradingName || agency?.legalName || "Travel agent"}</p>
                  <p className={`m-0 mt-1 flex items-center gap-1 text-[9px] font-semibold ${verified ? "text-emerald-700" : "text-amber-700"}`}>
                    {verified ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                    {verified ? "Verified agency" : "Verification pending"}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => void signOut()} disabled={signingOut} className="group mt-2 flex w-full items-center gap-2.5 rounded-xl border border-solid border-neutral-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-neutral-600 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/25 disabled:cursor-not-allowed disabled:opacity-50">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-100 text-neutral-500 transition group-hover:bg-white group-hover:text-red-600">
            {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          </span>
          <span>{signingOut ? "Signing out..." : "Sign out"}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div id="agent-workspace" className="flex h-dvh min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
      <style jsx global>{`
        #agent-workspace, #agent-workspace *, #agent-workspace *::before, #agent-workspace *::after { box-sizing: border-box; }
        #agent-workspace button, #agent-workspace input, #agent-workspace select, #agent-workspace textarea { font: inherit; }
      `}</style>

      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 border-0 bg-neutral-950/45" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full p-3">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 flex-shrink-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)]">
          <div className="flex min-h-[4.5rem] items-center gap-3 px-3 sm:px-4">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-neutral-200 bg-neutral-50 text-neutral-700 transition hover:border-neutral-300 hover:bg-white lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-neutral-800 bg-neutral-900 text-[11px] font-extrabold tracking-wide text-white">{initials(agency?.legalName)}</span>
            <div className="min-w-0">
              {loading ? (
                <span className="inline-block h-4 w-40 animate-pulse rounded bg-neutral-100" />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="m-0 max-w-[12rem] truncate text-[13px] font-extrabold text-neutral-900 sm:max-w-[18rem]">{agency?.tradingName || agency?.legalName || "Travel agent"}</p>
                    {agency && (
                      <span className={`hidden items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold sm:inline-flex ${verified ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                        {verified ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />} {verified ? "Verified" : "Awaiting verification"}
                      </span>
                    )}
                  </div>
                  {agency?.reference && <p className="m-0 mt-1 font-mono text-[9px] font-medium tracking-wide text-neutral-400">{agency.reference}</p>}
                </>
              )}
            </div>

            <span className="mx-1 hidden h-8 w-px bg-neutral-200 md:block" aria-hidden />
            <div className="hidden min-w-0 items-center gap-2.5 md:flex">
              <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-solid border-neutral-200 bg-neutral-50 text-emerald-700">
                <CurrentSectionIcon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[8px] font-extrabold uppercase tracking-[0.16em] text-neutral-400">Current section</p>
                <p className="m-0 mt-0.5 truncate text-[11px] font-bold text-neutral-700">{currentNav.label}</p>
              </div>
            </div>

            <div className="min-w-0 flex-1" />
            <button type="button" onClick={() => void signOut()} disabled={signingOut} className="hidden min-h-10 items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20 disabled:opacity-50 sm:inline-flex">
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Sign out
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="w-full min-w-0 max-w-full">{children}</div>
        </main>

        <HealthFooter />
      </div>
    </div>
  );
}
