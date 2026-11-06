"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar, ChevronRight, ExternalLink, Megaphone, Play, Search, Share2, X } from "lucide-react";

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

/** "16 March 2026", by the calendar day in Dar es Salaam. */
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Dar_es_Salaam" });
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

// ── Shared bits ───────────────────────────────────────────────────────────────
const EAT = "Africa/Dar_es_Salaam";
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

function readMinutes(content: string) {
  return Math.max(1, Math.round(content.trim().split(/\s+/).filter(Boolean).length / 200));
}
function isRecent(iso: string) {
  return Date.now() - new Date(iso).getTime() < RECENT_MS;
}
function monthKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: EAT });
}

/** The update's picture, or a calm brand tile when it has none. */
function Media({ item, className = "", iconSize = "h-6 w-6" }: { item: Update; className?: string; iconSize?: string }) {
  const { ytId, hasVideo, mediaSrc } = parseUpdate(item);
  return (
    <div className={`relative overflow-hidden bg-[#e9f5f4] ${className}`}>
      {mediaSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaSrc} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle,rgba(2,102,94,0.10)_1px,transparent_1px)] [background-size:14px_14px]">
          <Megaphone className={`${iconSize} text-[#02665e]/35`} aria-hidden />
        </div>
      )}
      {hasVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full shadow-md ${ytId ? "bg-[#FF0000] text-white" : "bg-white/95 text-[#02665e]"}`}>
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden />
          </span>
        </span>
      )}
    </div>
  );
}

function Meta({ item }: { item: Update }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <span>{formatDate(item.createdAt)}</span>
      <span aria-hidden className="text-slate-300">·</span>
      <span>{readMinutes(item.content)} min read</span>
      {isRecent(item.createdAt) && <span className="rounded bg-[#02665e]/10 px-1.5 py-px text-[10px] font-bold text-[#02665e]">New</span>}
    </p>
  );
}

// ── Featured: the latest update, given room ───────────────────────────────────
function FeaturedCard({ item, onOpen }: { item: Update; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full cursor-pointer overflow-hidden rounded-xl border border-solid border-slate-200 bg-white p-0 text-left [font-family:inherit] transition hover:border-[#02665e]/35 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <Media item={item} className="aspect-[16/9] md:aspect-auto md:min-h-[260px]" iconSize="h-10 w-10" />
      <div className="flex min-w-0 flex-col p-5 sm:p-7">
        <p className="m-0 text-[11px] font-semibold text-[#02665e]">Latest update</p>
        <h2 className="m-0 mt-2 text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">{item.title}</h2>
        <div className="mt-2"><Meta item={item} /></div>
        <p className="m-0 mt-3 line-clamp-4 text-sm leading-6 text-slate-600">{item.content}</p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-[#02665e]">
          Read update <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </button>
  );
}

// ── List row: everything after the featured one ───────────────────────────────
function UpdateRow({ item, onOpen }: { item: Update; onOpen: () => void }) {
  const d = new Date(item.createdAt);
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", timeZone: EAT });
  const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: EAT });
  return (
    <li className="border-0 border-t border-solid border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-4 py-4 text-left [font-family:inherit] transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#02665e] sm:px-5"
      >
        <span className="hidden w-11 shrink-0 text-center sm:block" aria-hidden>
          <span className="block text-lg font-bold leading-none tabular-nums text-slate-900">{day}</span>
          <span className="mt-1 block text-[11px] font-medium text-slate-500">{mon}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-900 transition-colors group-hover:text-[#02665e]">{item.title}</span>
          <span className="mt-1 block line-clamp-2 text-[13px] leading-5 text-slate-500">{item.content}</span>
          <span className="mt-1.5 block sm:hidden"><Meta item={item} /></span>
          <span className="mt-1.5 hidden text-xs text-slate-400 sm:block">{readMinutes(item.content)} min read{isRecent(item.createdAt) ? " · New" : ""}</span>
        </span>
        <Media item={item} className="hidden h-[72px] w-[112px] shrink-0 rounded-lg sm:block" iconSize="h-5 w-5" />
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#02665e]" aria-hidden />
      </button>
    </li>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function UpdatesIndexPage() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Update | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const api = axios.create({ baseURL: "" });
        const res = await api.get<{ items: Update[] }>("/api/public/updates");
        const items = res.data?.items || [];
        setUpdates([...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      } catch (err) {
        console.error("Failed to load updates:", err);
        setFailed(true);
        setUpdates([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Stable so the dialog's Esc listener is not re-attached on every render
  const closeDetail = useCallback(() => setSelected(null), []);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matches = searching ? updates.filter((u) => `${u.title} ${u.content}`.toLowerCase().includes(q)) : updates;
  const featured = searching ? null : matches[0] ?? null;
  const rest = searching ? matches : matches.slice(1);

  // Group the list by month (EAT) so a long history stays scannable
  const groups = useMemo(() => {
    if (searching) return rest.length ? [{ key: "Results", items: rest }] : [];
    const out: Array<{ key: string; items: Update[] }> = [];
    for (const u of rest) {
      const key = monthKey(u.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(u);
      else out.push({ key, items: [u] });
    }
    return out;
  }, [rest, searching]);

  return (
    <main id="updates-page" className="pb-16 pt-6 text-slate-900 sm:pt-8">
      <style>{"#updates-page, #updates-page * { box-sizing: border-box; }"}</style>
      <div className="public-container">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <Link href="/public" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 no-underline hover:text-[#02665e]">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Home
            </Link>
            <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Updates</h1>
            <p className="m-0 mt-1 text-sm text-slate-500">
              News and announcements from NoLSAF
              {!loading && updates.length > 0 && <> · {updates.length} {updates.length === 1 ? "update" : "updates"}</>}
            </p>
          </div>
          {updates.length > 3 && (
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search updates</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search updates"
                className="h-10 w-full rounded-lg border border-solid border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none [font-family:inherit] focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10"
              />
            </label>
          )}
        </header>

        <div className="mt-6 sm:mt-8">
          {loading ? (
            <div className="space-y-4" aria-label="Loading updates">
              <div className="h-[260px] animate-pulse rounded-xl bg-slate-200/60" />
              <div className="h-24 animate-pulse rounded-xl bg-slate-200/60" />
            </div>
          ) : failed || updates.length === 0 ? (
            <div className="rounded-xl border border-solid border-slate-200 bg-white px-6 py-14 text-center">
              <Megaphone className="mx-auto h-7 w-7 text-slate-300" aria-hidden />
              <p className="m-0 mt-3 text-sm font-semibold text-slate-800">{failed ? "Updates could not load" : "No updates yet"}</p>
              <p className="m-0 mt-1 text-xs text-slate-500">{failed ? "Please refresh the page in a moment." : "Check back soon, we will post announcements here."}</p>
            </div>
          ) : (
            <div className="space-y-8">
              {featured && <FeaturedCard item={featured} onOpen={() => setSelected(featured)} />}

              {searching && matches.length === 0 && (
                <p className="m-0 rounded-xl border border-solid border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
                  No updates match &ldquo;{query.trim()}&rdquo;.
                </p>
              )}

              {groups.map((g) => (
                <section key={g.key} aria-label={g.key}>
                  <h2 className="m-0 mb-2 text-xs font-semibold text-slate-500">{g.key}</h2>
                  <ul className="m-0 list-none overflow-hidden rounded-xl border border-solid border-slate-200 bg-white p-0">
                    {g.items.map((u) => (
                      <UpdateRow key={u.id} item={u} onOpen={() => setSelected(u)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && <DetailModal item={selected} onClose={closeDetail} />}
    </main>
  );
}
