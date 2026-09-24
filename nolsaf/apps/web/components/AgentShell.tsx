"use client";

// NRMS Agent B2B portal shell: sidebar, header and operational footer, mirroring
// the sales workspace frame. Every page in the (agent) route group renders inside
// this. Identity comes from /api/agent-portal/hotels, which is session gated on
// the server; the shell shows nothing sensitive on its own.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, BadgeCheck, Building2, CalendarSearch, ClipboardList, Handshake, HeartPulse, Loader2, LogOut, Menu, ShieldAlert, X } from "lucide-react";

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
  const tone = ok === "up" ? "bg-emerald-400" : ok === "down" ? "bg-red-400" : "bg-amber-300";
  const label = ok === "up" ? "Systems ok" : ok === "down" ? "Service unavailable" : "Checking";
  return (
    <footer className="mx-3 mb-3 mt-2 flex flex-shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-solid border-white/10 bg-[#252d2c] px-4 py-2 text-xs font-bold text-white/60">
      <span className="inline-flex items-center gap-1.5">
        <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
          <span className={`absolute h-2 w-2 rounded-full ${tone}`} />
          <HeartPulse className={`relative h-3.5 w-3.5 ${ok === "up" ? "text-emerald-400" : "text-transparent"}`} />
        </span>
        {label}
      </span>
      <span className="text-white/40">NoLSAF Travel Agent Portal</span>
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

  const sidebar = (
    <div className="relative flex h-full w-[15rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-solid border-white/10 bg-[#252d2c] text-white shadow-[0_14px_34px_-18px_rgba(15,23,42,0.45)]">
      <div className="flex min-h-[5rem] flex-shrink-0 items-center gap-3 border-0 border-b border-solid border-white/10 px-4">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center overflow-hidden rounded-lg border border-solid border-white/15 bg-white">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority />
        </span>
        <span className="h-8 w-px flex-shrink-0 bg-white/10" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[12px] font-semibold tracking-[0.08em] text-white/85">AGENT PORTAL</p>
          <p className="m-0 mt-1 text-[10px] text-white/40">Travel partner workspace</p>
        </div>
        <button type="button" onClick={() => setMobileOpen(false)} className="grid h-8 w-8 flex-shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-white/50 transition hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close navigation">
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Agent portal navigation">
        <p className="m-0 px-2.5 pb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">Workspace</p>
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/agent-portal" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`group mb-0.5 flex min-h-9 items-center gap-2.5 rounded-lg border border-solid px-2.5 text-left text-[13px] font-semibold no-underline outline-none transition last:mb-0 hover:no-underline focus-visible:ring-2 focus-visible:ring-emerald-300/40 ${
                active
                  ? "border-emerald-300/70 bg-emerald-300 text-emerald-950"
                  : "border-transparent text-white/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"
              }`}
            >
              <span className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-shrink-0 border-0 border-t border-solid border-white/10 p-2">
        <div className="flex min-w-0 items-center gap-2.5 px-1.5 py-1.5">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[10px] font-extrabold text-white/80">
            {initials(agency?.legalName)}
          </span>
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="space-y-1.5">
                <span className="block h-3 w-28 animate-pulse rounded bg-white/10" />
                <span className="block h-2 w-16 animate-pulse rounded bg-white/[0.06]" />
              </div>
            ) : (
              <>
                <p className="m-0 truncate text-[11px] font-bold text-white/85">{agency?.tradingName || agency?.legalName || "Travel agent"}</p>
                <p className={`m-0 mt-1 flex items-center gap-1 text-[9px] font-semibold ${verified ? "text-emerald-300" : "text-amber-300"}`}>
                  {verified ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                  {verified ? "Verified agency" : "Verification pending"}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Leaving this portal should return the operator to their own
            workspace, not end the session. Signing out stays in the header. */}
        <Link
          href="/account/agent"
          className="mt-1 flex min-h-9 w-full items-center gap-2.5 rounded-lg border-0 px-2.5 text-[12px] font-semibold text-white/55 no-underline transition hover:bg-white/[0.07] hover:text-white hover:no-underline"
        >
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-white/[0.04]">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          </span>
          Back to workspace
        </Link>
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
        <header className="mx-3 mt-3 flex-shrink-0 overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)]">
          <div className="flex min-h-[4.5rem] items-center gap-3 px-3 sm:px-4">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-solid border-neutral-200 bg-white text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-800 lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-neutral-200 bg-neutral-50 text-[11px] font-extrabold tracking-wide text-neutral-600">{initials(agency?.legalName)}</span>
            <div className="min-w-0 flex-1">
              {loading ? (
                <span className="inline-block h-4 w-40 animate-pulse rounded bg-neutral-100" />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="m-0 max-w-[12rem] truncate text-[15px] font-bold leading-tight tracking-tight text-neutral-900 sm:max-w-[18rem]">{agency?.tradingName || agency?.legalName || "Travel agent"}</p>
                    {agency && (
                      <span className={`hidden items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold sm:inline-flex ${verified ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                        {verified ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />} {verified ? "Verified" : "Awaiting verification"}
                      </span>
                    )}
                  </div>
                  {agency?.reference && (
                    <p className="m-0 mt-1">
                      <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-500">{agency.reference}</code>
                    </p>
                  )}
                </>
              )}
            </div>

            <span className="mx-0.5 hidden h-8 w-px shrink-0 bg-neutral-200 sm:block" aria-hidden />

            <Link
              href="/account/agent"
              className="hidden min-h-10 shrink-0 items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-600 no-underline outline-none transition hover:border-emerald-200 hover:bg-emerald-50/40 hover:text-emerald-800 hover:no-underline focus-visible:ring-2 focus-visible:ring-emerald-600/25 md:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Workspace
            </Link>

            <button type="button" onClick={() => void signOut()} disabled={signingOut} className="hidden min-h-10 cursor-pointer appearance-none items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-600 outline-none transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500/20 disabled:opacity-50 sm:inline-flex">
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Sign out
            </button>
          </div>

          <nav className="overflow-x-auto rounded-b-3xl border-0 border-t border-solid border-neutral-100 px-3 pt-0.5 sm:px-5" aria-label="Agent portal sections">
            <div className="flex w-max min-w-full gap-1">
              {NAV.map(({ href, label, Icon }) => {
                const active = href === "/agent-portal" ? pathname === href : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 border-0 border-b-2 border-solid px-3 text-xs font-bold no-underline outline-none transition hover:no-underline ${
                      active
                        ? "border-emerald-700 text-emerald-800"
                        : "border-transparent text-neutral-500 hover:border-neutral-200 hover:text-neutral-800"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="w-full min-w-0 max-w-full">{children}</div>
        </main>

        <HealthFooter />
      </div>
    </div>
  );
}
