"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Facebook, Instagram, Mail, MessageCircle, Send, Share2 } from "lucide-react";

type Props = { propertyId: number | null; propertyTitle?: string | null; label?: string };

export default function ShareBookingButton({ propertyId, propertyTitle, label = "Share booking page" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const path = propertyId ? `/nrms/book/${propertyId}` : "";
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

  const copy = async (value = sourceUrl("direct")) => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } };
  const nativeShare = async () => { try { await navigator.share({ title: propertyTitle || "Direct booking", text: shareText, url: sourceUrl("direct") }); setOpen(false); } catch { /* user dismissed */ } };
  const openIntent = (href: string) => { window.open(href, "_blank", "noopener,noreferrer"); };

  const targets = [
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, className: "bg-[#25D366] text-white hover:opacity-90", href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${sourceUrl("whatsapp")}`)}` },
    { key: "facebook", label: "Facebook", icon: Facebook, className: "bg-[#1877F2] text-white hover:opacity-90", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(sourceUrl("facebook"))}` },
    { key: "telegram", label: "Telegram", icon: Send, className: "bg-[#0088cc] text-white hover:opacity-90", href: `https://t.me/share/url?url=${encodeURIComponent(sourceUrl("telegram"))}&text=${encodeURIComponent(shareText)}` },
    { key: "email", label: "Email", icon: Mail, className: "bg-neutral-800 text-white hover:opacity-90", href: `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n${sourceUrl("email")}`)}` },
  ];

  if (!propertyId) return null;

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
        <Share2 className="h-4 w-4" />{label}
      </button>
      {open && (
        <div role="dialog" aria-label="Share direct booking link" className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg">
          <p className="m-0 px-1 text-xs font-bold text-neutral-900">Share direct booking link</p>
          <p className="mb-0 mt-0.5 px-1 text-[11px] leading-4 text-neutral-500">Each channel link is tagged so NRMS can show where direct interest started.</p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1">
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-600">{url.replace(/^https?:\/\//, "")}</span>
            <button type="button" onClick={() => void copy()} className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold transition ${copied ? "bg-emerald-600 text-white" : "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"}`}>{copied ? <><Check className="h-3.5 w-3.5" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy</>}</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy(sourceUrl("instagram"))} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 bg-[linear-gradient(110deg,#7c3aed,#db2777,#f97316)] px-3 text-[11px] font-bold text-white transition hover:opacity-90"><Instagram className="h-4 w-4" />{copied ? "Link copied" : "Instagram"}</button>
            {targets.map((target) => { const Icon = target.icon; return <button key={target.key} type="button" onClick={() => openIntent(target.href)} className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border-0 px-3 text-[11px] font-bold transition ${target.className}`}><Icon className="h-4 w-4" />{target.label}</button>; })}
          </div>
          {canNativeShare && <button type="button" onClick={() => void nativeShare()} className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-bold text-neutral-700 transition hover:bg-neutral-50"><Share2 className="h-4 w-4" />More apps</button>}
          <a href={path} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100 hover:no-underline"><ExternalLink className="h-4 w-4" />Open booking page</a>
        </div>
      )}
    </div>
  );
}
