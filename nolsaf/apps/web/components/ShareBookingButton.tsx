"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Facebook, Instagram, Mail, MessageCircle, Send, Share2 } from "lucide-react";

type Props = { bookingKey?: string | null; propertyTitle?: string | null; label?: string };

export default function ShareBookingButton({ bookingKey, propertyTitle, label = "Share booking page" }: Props) {
  const [open, setOpen] = useState(false);
  const [copiedChannel, setCopiedChannel] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const path = bookingKey ? `/nrms/book/${encodeURIComponent(bookingKey)}` : "";
  const url = useMemo(() => (path && typeof window !== "undefined" ? `${window.location.origin}${path}` : path), [path]);
  const shareText = `Book directly at ${propertyTitle || "our property"}`;
  const sourceUrl = (source: string) => `${url}${url.includes("?") ? "&" : "?"}source=${source}`;

  useEffect(() => { setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const copy = async (value = sourceUrl("direct"), channel = "direct") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedChannel(channel);
      setTimeout(() => setCopiedChannel((current) => current === channel ? null : current), 1800);
    } catch { /* clipboard blocked */ }
  };
  const nativeShare = async () => { try { await navigator.share({ title: propertyTitle || "Direct booking", text: shareText, url: sourceUrl("direct") }); setOpen(false); } catch { /* user dismissed */ } };
  const openIntent = (href: string) => { window.open(href, "_blank", "noopener,noreferrer"); };

  const targets = [
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, className: "bg-[#25D366] text-white hover:opacity-90", href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${sourceUrl("whatsapp")}`)}` },
    { key: "facebook", label: "Facebook", icon: Facebook, className: "bg-[#1877F2] text-white hover:opacity-90", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(sourceUrl("facebook"))}` },
    { key: "telegram", label: "Telegram", icon: Send, className: "bg-[#0088cc] text-white hover:opacity-90", href: `https://t.me/share/url?url=${encodeURIComponent(sourceUrl("telegram"))}&text=${encodeURIComponent(shareText)}` },
    { key: "email", label: "Email", icon: Mail, className: "bg-neutral-800 text-white hover:opacity-90", href: `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n${sourceUrl("email")}`)}` },
  ];

  if (!bookingKey) return null;

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
        <Share2 className="h-4 w-4" />{label}
      </button>
      {open && (
        <div role="dialog" aria-label="Share direct booking link" className="absolute right-0 z-30 mt-3 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-100 px-5 pb-4 pt-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                <Share2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-sm font-extrabold tracking-tight text-slate-950">Share direct booking link</p>
                <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">Every channel is tracked separately so you can see where booking interest comes from.</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <p className="mb-2 mt-0 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Booking link</p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 pl-3 shadow-inner shadow-slate-950/[0.02]">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600" title={url}>{url.replace(/^https?:\/\//, "")}</span>
              <button type="button" onClick={() => void copy()} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 ${copiedChannel === "direct" ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-[#02665e]/30 hover:text-[#02665e]"}`}>
                {copiedChannel === "direct" ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy</>}
              </button>
            </div>

            <p className="mb-2 mt-5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Share with guests</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => void copy(sourceUrl("instagram"), "instagram")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-0 bg-[linear-gradient(110deg,#7c3aed,#db2777,#f97316)] px-3 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/40"><Instagram className="h-4 w-4" />{copiedChannel === "instagram" ? "Link copied" : "Instagram"}</button>
              {targets.map((target) => { const Icon = target.icon; return <button key={target.key} type="button" onClick={() => openIntent(target.href)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-0 px-3 text-xs font-bold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 ${target.className}`}><Icon className="h-4 w-4" />{target.label}</button>; })}
            </div>

            <div className="mt-3 space-y-2.5">
              {canNativeShare && <button type="button" onClick={() => void nativeShare()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-[#02665e]/25 hover:bg-slate-50 hover:text-[#02665e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30"><Share2 className="h-4 w-4" />More sharing options</button>}
              <a href={path} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-extrabold text-emerald-800 no-underline transition hover:border-emerald-300 hover:bg-emerald-100 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"><ExternalLink className="h-4 w-4" />Open booking page</a>
            </div>

            <span className="sr-only" aria-live="polite">{copiedChannel ? "Booking link copied" : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
