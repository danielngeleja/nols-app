"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";

/**
 * Feedback while moving between the admin panel and a self-contained
 * workspace (Expenses, Disbursements). Those routes swap the whole shell, so
 * without this the click looks like nothing happened until the new layout
 * arrives. A click on any link that changes workspace shows a covering
 * loader; it clears as soon as the pathname changes (or after 15 seconds).
 */

const WORKSPACES = [
  { prefix: "/admin/expenses", label: "Expenses", hint: "Running costs, payroll and statutory payments" },
  { prefix: "/admin/disbursements", label: "Disbursements", hint: "Batches, authorisation and payouts" },
];

const workspaceOf = (path: string) => WORKSPACES.find((w) => path === w.prefix || path.startsWith(`${w.prefix}/`)) ?? null;

export default function WorkspaceTransition() {
  const pathname = usePathname() || "";
  const [opening, setOpening] = useState<{ label: string; hint: string } | null>(null);

  // The new route has rendered.
  useEffect(() => { setOpening(null); }, [pathname]);

  useEffect(() => {
    if (!opening) return;
    const t = window.setTimeout(() => setOpening(null), 15_000);
    return () => window.clearTimeout(t);
  }, [opening]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/admin")) return;
      const from = workspaceOf(window.location.pathname);
      const to = workspaceOf(url.pathname);
      if (from?.prefix === to?.prefix) return;
      setOpening(to ? { label: `Opening ${to.label}`, hint: to.hint } : { label: "Back to the admin panel", hint: "Loading your dashboard" });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!opening) return null;
  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[#f4f6f5]/85 backdrop-blur-[3px]" role="status" aria-live="polite">
      <div className="flex w-[19rem] flex-col items-center rounded-xl border border-solid border-neutral-200 bg-white px-6 py-7 text-center shadow-[0_24px_60px_-28px_rgba(11,36,32,0.45)]">
        <span className="relative grid h-14 w-14 place-items-center">
          <svg viewBox="0 0 56 56" className="absolute inset-0 h-full w-full animate-spin [animation-duration:1.1s]" aria-hidden>
            <circle cx="28" cy="28" r="25" fill="none" stroke="#e8eeec" strokeWidth="3" />
            <circle cx="28" cy="28" r="25" fill="none" stroke="#02665e" strokeWidth="3" strokeLinecap="round" strokeDasharray="40 157" />
          </svg>
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-white">
            <Image src="/assets/NoLS2025-04.png" alt="" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" />
          </span>
        </span>
        <p className="m-0 mt-4 text-sm font-bold text-neutral-900">{opening.label}</p>
        <p className="m-0 mt-1 text-xs text-neutral-500">{opening.hint}</p>
        <span className="mt-4 block h-1 w-full overflow-hidden rounded-full bg-neutral-100">
          <span className="block h-full w-1/3 animate-[wsbar_1.2s_ease-in-out_infinite] rounded-full bg-[#02665e]" />
        </span>
        <style>{"@keyframes wsbar { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }"}</style>
      </div>
    </div>
  );
}
