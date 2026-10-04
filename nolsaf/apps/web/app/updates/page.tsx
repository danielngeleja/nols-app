"use client";

import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ArrowLeft, Calendar, ExternalLink, Megaphone, Play, Share2, X } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";
import UpdateRadialFan, { type RadialItem } from "@/components/UpdateRadialFan";

interface Update {
  id: string;
  title: string;
  content: string;
  images?: string[];
  videos?: string[];
  createdAt: string;
  updatedAt: string;
}

function isSafeMediaUrl(url: string): boolean {
  const t = url.trim();
  if (!t) return false;
  if (t.startsWith("/")) return true;
  if (t.startsWith("data:image/")) return true;
  try {
    const p = new URL(t);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch { return false; }
}

function getYouTubeId(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  try {
    const p = new URL(t);
    const h = p.hostname.replace(/^www\./, "");
    if (h === "youtu.be") return p.pathname.split("/").filter(Boolean)[0] || null;
    if (h === "youtube.com" || h === "m.youtube.com") {
      const parts = p.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" && parts[1]) return parts[1];
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      return p.searchParams.get("v");
    }
    return null;
  } catch { return null; }
}

function parseUpdate(u: Update) {
  const safeImages = (u.images || []).filter((img) => typeof img === "string" && isSafeMediaUrl(img));
  const ytUrl = (u.videos || []).find((v) => typeof v === "string" && getYouTubeId(v) !== null);
  const ytId = ytUrl ? getYouTubeId(ytUrl) : null;
  const hasVideo = !!ytId || (u.videos || []).length > 0;
  const mediaSrc = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : safeImages[0] ?? null;
  return { safeImages, ytId, hasVideo, mediaSrc };
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({ item, onClose }: { item: Update; onClose: () => void }) {
  const { safeImages, ytId, mediaSrc } = parseUpdate(item);
  const embedUrl = ytId ? `https://www.youtube-nocookie.com/embed/${ytId}` : null;
  const watchUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : null;
  // The hero image is only shown when it is not already the video; the rest go in the strip
  const heroImage = embedUrl ? null : safeImages[0] ?? null;
  const galleryImages = embedUrl ? safeImages : safeImages.slice(1);
  const [copied, setCopied] = useState(false);
  const words = item.content.trim().split(/\s+/).filter(Boolean).length;
  const readMinutes = Math.max(1, Math.round(words / 200));
  const isRecent = Date.now() - new Date(item.createdAt).getTime() < 14 * 24 * 60 * 60 * 1000;

  // Esc closes; the page behind stops scrolling while the dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function share() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/updates` : "/updates";
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.content.slice(0, 140), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the visitor cancelled the share sheet */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[3px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      onClick={onClose}
    >
      <div
        className="relative box-border flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] sm:max-w-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band: brand, kind and date, with the close button; no empty placeholder art */}
        <div
          className="relative flex flex-none items-center justify-between gap-3 px-5 py-3.5 text-white sm:px-6"
          style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 55%, #02665e 140%)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
              <Megaphone className="h-4 w-4 text-emerald-300" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[13px] font-semibold leading-tight">
                NoLSAF Update
                {isRecent && (
                  <span className="rounded-[4px] bg-emerald-300 px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-[#012e29]">New</span>
                )}
              </p>
              <p className="m-0 mt-1 flex items-center gap-1.5 text-[11.5px] leading-none text-white/60">
                <Calendar className="h-3 w-3" aria-hidden />
                {formatDate(item.createdAt)}
                <span aria-hidden className="text-white/30">·</span>
                {readMinutes} min read
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {embedUrl ? (
            <div className="aspect-video w-full bg-black">
              <iframe
                src={embedUrl}
                className="h-full w-full"
                frameBorder="0"
                loading="lazy"
                referrerPolicy="no-referrer"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={item.title}
              />
            </div>
          ) : heroImage ? (
            <div className="aspect-[16/8] w-full overflow-hidden bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt={item.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            </div>
          ) : null}

          <article className="px-5 pb-6 pt-5 sm:px-7 sm:pt-6">
            <h2 id="update-dialog-title" className="m-0 text-[22px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[24px]">
              {item.title}
            </h2>
            <span aria-hidden className="mt-3 block h-[3px] w-10 rounded-full bg-[#02665e]" />
            <p className="m-0 mt-4 whitespace-pre-line text-[15px] leading-[1.75] text-slate-700">
              {item.content}
            </p>

            {galleryImages.length > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {galleryImages.map((img, i) => (
                  <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt={`${item.title} image ${i + 2}`}
                      className="aspect-video w-full object-cover transition-transform duration-300 hover:scale-[1.04]"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </a>
                ))}
              </div>
            )}
          </article>
        </div>

        {/* Footer actions stay visible while the body scrolls */}
        <div className="flex flex-none items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-7">
          <button
            type="button"
            onClick={() => void share()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
            {copied ? "Link copied" : "Share"}
          </button>
          <div className="flex items-center gap-2">
            {watchUrl && (
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#FF0000] px-3 text-[13px] font-semibold text-white no-underline transition-opacity hover:opacity-90"
              >
                <Play className="h-3.5 w-3.5 fill-white" aria-hidden />
                YouTube
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#014e47]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact grid card (for items beyond the fan) ──────────────────────────────
function GridCard({ item, onClick }: { item: Update; onClick: () => void }) {
  const { ytId, hasVideo, mediaSrc } = parseUpdate(item);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-1"
      style={{ borderRadius: 18 }}
    >
      <div
        className="overflow-hidden bg-white border border-slate-100 transition-all duration-200 group-hover:-translate-y-0.5"
        style={{ borderRadius: 18, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.10)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.05)"; }}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-slate-100" style={{ borderRadius: "18px 18px 0 0" }}>
          {mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt={item.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(135deg, #d6eeec 0%, #f5fffe 100%)" }}>
              <Megaphone className="h-7 w-7 text-[#02665e]/20" />
            </div>
          )}
          {(ytId || hasVideo) && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.10)" }}>
              <div
                className="flex items-center justify-center rounded-full ring-2 ring-white/80 shadow-lg transition-transform duration-200 group-hover:scale-110"
                style={{ width: 34, height: 34, background: ytId ? "#FF0000" : "rgba(255,255,255,0.92)" }}
              >
                <Play className="h-3.5 w-3.5 ml-0.5" style={{ fill: ytId ? "#fff" : "#02665e", color: ytId ? "#fff" : "#02665e" }} />
              </div>
            </div>
          )}
        </div>
        <div className="px-3 pt-2.5 pb-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{formatDateShort(item.createdAt)}</p>
          <h3 className="text-[13px] font-bold leading-snug text-slate-900 line-clamp-2">{item.title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 line-clamp-1">{item.content}</p>
        </div>
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function UpdatesIndexPage() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Update | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const api = axios.create({ baseURL: "" });
        const res = await api.get<{ items: Update[] }>("/api/public/updates");
        setUpdates(res.data?.items || []);
      } catch (err) {
        console.error("Failed to load updates:", err);
        setUpdates([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Map Update → RadialItem for the fan component
  const radialItems: RadialItem[] = updates.slice(0, 5).map((u) => ({
    id: u.id,
    title: u.title,
    content: u.content,
    createdAt: u.createdAt,
  }));

  // When user selects from the radial fan, find the full Update to open the modal
  function handleFanSelect(ri: RadialItem) {
    const full = updates.find((u) => u.id === ri.id);
    if (full) setSelected(full);
  }

  const gridItems = updates.slice(5);
  // Stable so the dialog's Esc listener is not re-attached on every render
  const closeDetail = useCallback(() => setSelected(null), []);

  return (
    <main style={{ minHeight: "100dvh", background: "#f7f8fa" }}>
      <div className="public-container py-8">

        {/* Page header */}
        <div className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl shadow-sm"
              style={{ background: "#02665e" }}
            >
              <Megaphone className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-none text-slate-900">Updates</h1>
              <p className="mt-0.5 text-[11px] text-slate-400">News &amp; announcements from NoLSAF</p>
            </div>
          </div>
          <Link
            href="/public"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 no-underline shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <LogoSpinner size="sm" ariaLabel="Loading updates" />
          </div>
        )}

        {/* Empty */}
        {!loading && updates.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
            <Megaphone className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">No updates yet</p>
            <p className="mt-1 text-xs text-slate-400">Check back soon, we will post announcements here.</p>
          </div>
        )}

        {/* Content */}
        {!loading && updates.length > 0 && (
          <>
            {/* ── Radial fan section (top 5) ── */}
            <div
              className="mb-8 overflow-hidden"
              style={{
                background: "white",
                borderRadius: 24,
                boxShadow: "0 4px 24px rgba(0,0,0,0.07)",
                border: "1px solid #f0f0f1",
              }}
            >
              {/* Section label */}
              <div
                className="flex items-center gap-2 px-5 pt-5 pb-2"
                style={{ borderBottom: "1px solid #f4f4f5" }}
              >
                <span
                  className="inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white"
                  style={{ background: "#02665e" }}
                >
                  Featured
                </span>
                <p className="text-[12px] text-slate-400">
                  Latest {Math.min(updates.length, 5)} update{updates.length !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Radial fan — scrollable on narrow viewports */}
              <div style={{ overflowX: "auto", padding: "6px 8px 10px 0" }}>
                <UpdateRadialFan
                  items={radialItems}
                  onSelect={handleFanSelect}
                />
              </div>
            </div>

            {/* ── Grid for items beyond the top 5 ── */}
            {gridItems.length > 0 && (
              <>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  More Updates
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {gridItems.map((u) => (
                    <GridCard key={u.id} item={u} onClick={() => setSelected(u)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

      </div>

      {/* Detail modal */}
      {selected && <DetailModal item={selected} onClose={closeDetail} />}
    </main>
  );
}
