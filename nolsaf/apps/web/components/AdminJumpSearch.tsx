"use client";

// Header jump search: one box for admin pages (matched locally from the sidebar's
// page index) and records (owners, drivers, users, listings, bookings from
// /api/admin/search, which already returns opaque-reference links).
// "/" or Ctrl/Cmd+K focuses it from anywhere; arrows move, Enter opens, Esc closes.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import { ADMIN_NAV_PAGES } from "@/components/AdminSidebar";

type Suggestion = { label?: string; href?: string; type?: string };
type Result = { key: string; href: string; label: string; meta: string; kind: "page" | "record" };

export default function AdminJumpSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Focus from anywhere, unless the person is typing in a field already.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Records: debounced, two characters or more.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { credentials: "include", signal: ac.signal });
        const data = res.ok ? await res.json() : [];
        setRecords(Array.isArray(data) ? data : []);
      } catch {
        // aborted or offline: keep pages only
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const pages = ADMIN_NAV_PAGES.filter((p) => `${p.label} ${p.section}`.toLowerCase().includes(term))
      .slice(0, 5)
      .map((p) => ({ key: `p:${p.href}`, href: p.href, label: p.label, meta: p.section === "Pages" ? "Page" : p.section, kind: "page" as const }));
    const recs = records
      .filter((r) => r.href && r.label)
      .slice(0, 8)
      .map((r, i) => ({ key: `r:${i}:${r.href}`, href: r.href!, label: String(r.label).replace(/\s+—\s+/g, " · "), meta: r.type || "Record", kind: "record" as const }));
    return [...pages, ...recs];
  }, [q, records]);

  useEffect(() => setSel(0), [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(0, results.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { const r = results[sel]; if (r) { e.preventDefault(); go(r.href); } }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const pages = results.filter((r) => r.kind === "page");
  const recs = results.filter((r) => r.kind === "record");
  const row = (r: Result) => {
    const i = results.indexOf(r);
    const on = i === sel;
    return (
      <li key={r.key}>
        <button
          type="button"
          onMouseEnter={() => setSel(i)}
          onClick={() => go(r.href)}
          className={`flex w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border-0 px-2.5 py-2 text-left transition ${on ? "bg-white/[0.08]" : "bg-transparent"}`}
        >
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${r.kind === "page" ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.06] text-emerald-50/70"}`}>
            {r.kind === "page" ? <FileText className="h-3.5 w-3.5" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{r.label}</span>
            <span className="block truncate text-[11px] text-emerald-100/50">{r.meta}</span>
          </span>
          {on ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-100/50" aria-hidden /> : null}
        </button>
      </li>
    );
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-[420px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-100/45" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search people, listings, bookings or pages"
        aria-label="Search the admin console"
        className="h-10 w-full rounded-xl border border-solid border-white/10 bg-white/[0.06] pl-9 pr-12 text-[13px] text-white outline-none transition placeholder:text-emerald-100/40 hover:border-white/15 focus:border-emerald-300/40 focus:bg-white/[0.1]"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-solid border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-emerald-100/55">/</kbd>

      {open && q.trim() ? (
        <div className="admin-fade-in-up absolute left-0 right-0 top-full z-[96] mt-2 overflow-hidden rounded-2xl border border-solid border-white/10 bg-[#0b2420] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
          {pages.length ? (
            <>
              <p className="m-0 px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/40">Pages</p>
              <ul className="m-0 list-none p-0">{pages.map(row)}</ul>
            </>
          ) : null}
          {recs.length ? (
            <>
              <p className="m-0 px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/40">Records</p>
              <ul className="m-0 list-none p-0">{recs.map(row)}</ul>
            </>
          ) : null}
          {!results.length ? (
            <p className="m-0 px-2.5 py-3 text-[13px] text-emerald-100/55">{loading ? "Searching…" : "No pages or records match."}</p>
          ) : loading ? (
            <p className="m-0 px-2.5 pb-1.5 pt-1 text-[11px] text-emerald-100/40">Searching records…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
