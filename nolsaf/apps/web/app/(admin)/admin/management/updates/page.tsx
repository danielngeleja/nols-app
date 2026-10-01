"use client";

import Image from "next/image";
import {
  CheckCircle2,
  Edit,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import TablePagination from "@/components/TablePagination";

const api = axios.create({ baseURL: "" });

interface Update {
  id: string;
  title: string;
  content: string;
  images?: string[];
  videos?: string[];
  createdAt: string;
  updatedAt: string;
}

const PAGE_SIZE = 8;
const VIEW_KEY = "admin.updates.view";

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const fieldClass =
  "box-border w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

const passthroughLoader = ({ src }: { src: string }) => src;

function extractYouTubeId(url: string): string | null {
  const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
  return match && match[2].length === 11 ? match[2] : null;
}

function youTubeThumb(url: string): string | null {
  const id = extractYouTubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function ago(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes < 1 ? "Just now" : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return days === 1 ? "Yesterday" : `${days} days ago`;
  const months = Math.floor(days / 30.4);
  return months < 12 ? `${months} mo ago` : `${Math.floor(days / 365)} y ago`;
}

function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

/** First image, or failing that the first video's thumbnail. */
function coverOf(update: Update): string | null {
  if (update.images?.length) return update.images[0];
  const firstVideo = update.videos?.[0];
  return firstVideo ? youTubeThumb(firstVideo) : null;
}

function VideoThumb({ url, onOpen, onRemove }: { url: string; onOpen: () => void; onRemove?: () => void }) {
  const thumb = youTubeThumb(url);
  return (
    <div className="group relative min-w-0">
      <button type="button" onClick={onOpen} aria-label="Preview video" className="relative block aspect-video w-full overflow-hidden rounded-lg border-0 bg-neutral-100 p-0 text-left">
        {thumb ? (
          <Image loader={passthroughLoader} unoptimized src={thumb} alt="Video thumbnail" width={640} height={360} sizes="240px" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-neutral-400"><Video className="h-5 w-5" /></span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/10">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm"><Play className="h-4 w-4 text-[#0b2420]" /></span>
        </span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove video" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function PhotoThumb({ src, alt, onRemove }: { src: string; alt: string; onRemove: () => void }) {
  return (
    <div className="group relative min-w-0">
      <Image loader={passthroughLoader} unoptimized src={src} alt={alt} width={320} height={240} sizes="160px" className="block aspect-[4/3] h-auto w-full rounded-lg object-cover ring-1 ring-inset ring-neutral-200" />
      <button type="button" onClick={onRemove} aria-label="Remove photo" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function UpdatesPage() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    images: [] as File[],
    videoUrls: [] as string[],
    existingImages: [] as string[],
    existingVideos: [] as string[],
  });
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"cards" | "list">("list");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadUpdates();
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "cards" || saved === "list") setView(saved);
    } catch {
      // storage unavailable: keep the default view
    }
  }, []);

  useEffect(() => {
    if (!showForm && !activeVideoUrl && !deleteConfirmId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeVideoUrl) setActiveVideoUrl(null);
      else if (deleteConfirmId) setDeleteConfirmId(null);
      else if (!uploading) closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closeForm only resets local state; re-binding on its identity is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, activeVideoUrl, deleteConfirmId, uploading]);

  const loadUpdates = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/admin/updates", { withCredentials: true });
      setUpdates(res.data?.items || []);
    } catch (err: any) {
      console.error("Failed to load updates:", err);
      setError(err?.response?.data?.message || "Failed to load updates");
    } finally {
      setLoading(false);
    }
  };

  const changeView = (next: "cards" | "list") => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // storage unavailable: the choice just won't persist
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const imageFiles = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    setFormData((prev) => ({ ...prev, images: [...prev.images, ...imageFiles] }));
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(file);
    });
    // Allow picking the same file again after removing it.
    e.target.value = "";
  };

  const addVideoUrl = () => {
    if (!newVideoUrl.trim()) return;
    const videoId = extractYouTubeId(newVideoUrl.trim());
    if (!videoId) {
      setFormError("That does not look like a YouTube link. Paste the full video URL.");
      return;
    }
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
    setFormData((prev) => ({ ...prev, videoUrls: [...prev.videoUrls, embedUrl] }));
    setNewVideoUrl("");
    setFormError(null);
  };

  const removeImage = (index: number) => {
    setFormData((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };
  const removeExistingImage = (url: string) => setFormData((prev) => ({ ...prev, existingImages: prev.existingImages.filter((img) => img !== url) }));
  const removeVideoUrl = (index: number) => setFormData((prev) => ({ ...prev, videoUrls: prev.videoUrls.filter((_, i) => i !== index) }));
  const removeExistingVideo = (url: string) => setFormData((prev) => ({ ...prev, existingVideos: prev.existingVideos.filter((vid) => vid !== url) }));

  // Closing the composer must not wipe the page banners: the success message
  // used to be set and then cleared by this same reset, so it never showed.
  const closeForm = () => {
    setFormData({ title: "", content: "", images: [], videoUrls: [], existingImages: [], existingVideos: [] });
    setImagePreviews([]);
    setNewVideoUrl("");
    setEditingId(null);
    setShowForm(false);
    setFormError(null);
  };

  const openNew = () => {
    closeForm();
    setSuccess(null);
    setShowForm(true);
  };

  const handleEdit = (update: Update) => {
    setFormData({
      title: update.title,
      content: update.content,
      images: [],
      videoUrls: [],
      existingImages: update.images || [],
      existingVideos: update.videos || [],
    });
    setImagePreviews([]);
    setNewVideoUrl("");
    setEditingId(update.id);
    setFormError(null);
    setSuccess(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setFormError(null);
    setSuccess(null);

    try {
      const fd = new FormData();
      fd.append("title", formData.title);
      fd.append("content", formData.content);
      formData.images.forEach((img) => fd.append("images", img));
      // New video links and the ones already on the update go up together.
      [...formData.videoUrls, ...formData.existingVideos].forEach((vid) => fd.append("existingVideos", vid));
      formData.existingImages.forEach((img) => fd.append("existingImages", img));

      const wasEditing = Boolean(editingId);
      if (editingId) {
        await api.put(`/api/admin/updates/${editingId}`, fd, { headers: { "Content-Type": "multipart/form-data" }, withCredentials: true });
      } else {
        await api.post("/api/admin/updates", fd, { headers: { "Content-Type": "multipart/form-data" }, withCredentials: true });
      }
      closeForm();
      setSuccess(wasEditing ? "Update saved." : "Update published.");
      void loadUpdates();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || "Failed to save update");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    try {
      await api.delete(`/api/admin/updates/${id}`, { withCredentials: true });
      setSuccess("Update deleted.");
      void loadUpdates();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to delete update");
    }
  };

  const sorted = useMemo(() => [...updates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [updates]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((u) => `${u.title} ${u.content}`.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = updates.filter((u) => new Date(u.createdAt) >= monthStart).length;
  const withMedia = updates.filter((u) => (u.images?.length || 0) + (u.videos?.length || 0) > 0).length;
  const photoCount = updates.reduce((sum, u) => sum + (u.images?.length || 0), 0);
  const videoCount = updates.reduce((sum, u) => sum + (u.videos?.length || 0), 0);
  const latest = sorted[0];

  const facts = [
    { label: "Published", value: loading ? "..." : String(updates.length), detail: updates.length === 1 ? "update live for users" : "updates live for users", tone: "text-white" },
    { label: "This month", value: loading ? "..." : String(thisMonth), detail: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), tone: thisMonth ? "text-emerald-300" : "text-white" },
    { label: "With media", value: loading ? "..." : String(withMedia), detail: `${photoCount} ${photoCount === 1 ? "photo" : "photos"} · ${videoCount} ${videoCount === 1 ? "video" : "videos"}`, tone: "text-white" },
    { label: "Last posted", value: loading ? "..." : latest ? ago(latest.createdAt) : "Never", detail: latest ? eat(latest.createdAt) : "Nothing posted yet", tone: "text-white" },
  ];

  const mediaChips = (update: Update) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {(update.images?.length || 0) > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200"><ImageIcon className="h-3 w-3" /> {update.images!.length}</span>
      )}
      {(update.videos?.length || 0) > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200"><Video className="h-3 w-3" /> {update.videos!.length}</span>
      )}
    </span>
  );

  const actions = (update: Update) => (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => handleEdit(update)} title="Edit" aria-label={`Edit ${update.title}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
        <Edit className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => setDeleteConfirmId(update.id)} title="Delete" aria-label={`Delete ${update.title}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="h-4 w-4" />
      </button>
    </span>
  );

  const deleting = updates.find((u) => u.id === deleteConfirmId);
  const mediaTotal = formData.existingImages.length + imagePreviews.length + formData.existingVideos.length + formData.videoUrls.length;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header: dark band with what has been published */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Communications</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Updates</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">News and events shared with your users, with photos and YouTube videos.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={openNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-semibold text-[#0b2420] transition-colors hover:bg-emerald-300">
                <Plus className="h-3.5 w-3.5" /> New update
              </button>
              <button type="button" onClick={() => void loadUpdates()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh updates" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">All updates</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${filtered.length} ${filtered.length === 1 ? "update" : "updates"}${query ? " found" : ""}`}</p>
          </div>
          <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                className={`${fieldClass} h-9 pl-9 pr-9`}
                placeholder="Search title or text"
                aria-label="Search updates"
              />
              {query && (
                <button type="button" onClick={() => { setQuery(""); setPage(1); }} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="hidden rounded-lg bg-neutral-100 p-0.5 md:inline-flex" role="group" aria-label="Layout">
              {([["cards", LayoutGrid, "Cards"], ["list", List, "List"]] as const).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeView(key)}
                  aria-pressed={view === key}
                  title={label}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md border-0 transition-colors ${view === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-400 hover:text-neutral-700"}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && updates.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading updates
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Megaphone className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-neutral-900">{query ? "No updates match that search" : "Nothing published yet"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{query ? "Try another word from the title or text." : "Share the first piece of news with your users."}</p>
            </div>
            {!query && (
              <button type="button" onClick={openNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f]">
                <Plus className="h-3.5 w-3.5" /> New update
              </button>
            )}
          </div>
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-4">
            {pageItems.map((update) => {
              const cover = coverOf(update);
              return (
                <article key={update.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-neutral-200">
                  {cover ? (
                    <button type="button" disabled={Boolean(update.images?.length)} onClick={() => setActiveVideoUrl(update.videos![0])} aria-label={update.images?.length ? undefined : "Play video"} className="relative block aspect-video w-full overflow-hidden border-0 bg-neutral-100 p-0 disabled:cursor-default">
                      <Image loader={passthroughLoader} unoptimized src={cover} alt={update.title} width={640} height={360} sizes="(max-width: 768px) 100vw, 320px" className="h-full w-full object-cover" />
                      {!update.images?.length && <span className="absolute inset-0 grid place-items-center"><span className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm"><Play className="h-4 w-4 text-[#0b2420]" /></span></span>}
                    </button>
                  ) : (
                    <div className="grid aspect-video w-full place-items-center bg-[#0b2420] text-emerald-300"><Megaphone className="h-6 w-6" /></div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col p-3.5">
                    <p className="m-0 line-clamp-2 text-sm font-semibold text-neutral-900">{update.title}</p>
                    <p className="m-0 mt-1 line-clamp-3 text-xs leading-5 text-neutral-500">{update.content}</p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-neutral-700">{ago(update.createdAt)}</span>
                        <span className="mt-1 block">{mediaChips(update)}</span>
                      </span>
                      {actions(update)}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div>
            {pageItems.map((update, idx) => {
              const cover = coverOf(update);
              const open = Boolean(expanded[update.id]);
              const long = update.content.length > 220;
              const media = [...(update.images || []).map((src) => ({ kind: "image" as const, src })), ...(update.videos || []).map((src) => ({ kind: "video" as const, src }))];
              return (
                <article key={update.id} className={`flex min-w-0 gap-4 px-4 py-4 sm:px-5 ${idx ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                  <div className="hidden w-32 shrink-0 sm:block">
                    {cover ? (
                      <Image loader={passthroughLoader} unoptimized src={cover} alt={update.title} width={320} height={180} sizes="128px" className="block aspect-video h-auto w-full rounded-lg object-cover ring-1 ring-inset ring-neutral-200" />
                    ) : (
                      <div className="grid aspect-video w-full place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><Megaphone className="h-5 w-5" /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-semibold text-neutral-900">{update.title}</p>
                        <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                          <span className="font-semibold text-neutral-600">{ago(update.createdAt)}</span>
                          <span>{eat(update.createdAt)}</span>
                          {update.updatedAt && update.updatedAt !== update.createdAt && <span>· edited {ago(update.updatedAt).toLowerCase()}</span>}
                          {mediaChips(update)}
                        </p>
                      </div>
                      {actions(update)}
                    </div>
                    <p className={`m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600 ${open ? "" : "line-clamp-3"}`}>{update.content}</p>
                    {long && (
                      <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [update.id]: !open }))} className="mt-1 border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">
                        {open ? "Show less" : "Read all"}
                      </button>
                    )}
                    {media.length > 1 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-8">
                        {media.slice(0, 8).map((m, i) => (
                          m.kind === "video" ? (
                            <VideoThumb key={`${m.src}-${i}`} url={m.src} onOpen={() => setActiveVideoUrl(m.src)} />
                          ) : (
                            <Image key={`${m.src}-${i}`} loader={passthroughLoader} unoptimized src={m.src} alt={`${update.title} photo ${i + 1}`} width={240} height={135} sizes="120px" className="block aspect-video h-auto w-full rounded-lg object-cover ring-1 ring-inset ring-neutral-200" />
                          )
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="border-0 border-t border-solid border-neutral-200">
            <TablePagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
          </div>
        )}
      </section>

      {/* Composer: quiet white dialog with a sticky header and footer */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editingId ? "Edit update" : "New update"} onClick={() => !uploading && closeForm()}>
          <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><Megaphone className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{editingId ? "Edit update" : "New update"}</h2>
                <p className="m-0 text-xs text-neutral-400">{editingId ? "Changes show to users as soon as you save." : "Published to users as soon as you save."}</p>
              </div>
              <button type="button" onClick={closeForm} disabled={uploading} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {formError && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="flex-1">{formError}</span>
                </div>
              )}

              <div className="space-y-4 px-5 py-4">
                <label className="block">
                  <span className="flex items-center justify-between">
                    <span className={sectionLabel}>Title</span>
                    <span className="text-[11px] tabular-nums text-neutral-400">{formData.title.length}/120</span>
                  </span>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                    maxLength={120}
                    required
                    placeholder="For example: New lodges added in Zanzibar"
                    className={`${fieldClass} mt-1.5 h-10 text-[15px] font-semibold`}
                  />
                </label>

                <label className="block">
                  <span className="flex items-center justify-between">
                    <span className={sectionLabel}>Message</span>
                    <span className="text-[11px] tabular-nums text-neutral-400">{formData.content.trim() ? formData.content.trim().split(/\s+/).length : 0} words</span>
                  </span>
                  <textarea
                    value={formData.content}
                    onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
                    required
                    rows={7}
                    placeholder="What do you want users to know?"
                    className={`${fieldClass} mt-1.5 block resize-y py-2.5 leading-6`}
                  />
                </label>
              </div>

              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <div className="flex items-center justify-between">
                  <p className={sectionLabel}>Photos</p>
                  <span className="text-[11px] tabular-nums text-neutral-400">{formData.existingImages.length + imagePreviews.length} added</span>
                </div>
                <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {formData.existingImages.map((img, idx) => (
                    <PhotoThumb key={`existing-${img}`} src={img} alt={`Photo ${idx + 1}`} onRemove={() => removeExistingImage(img)} />
                  ))}
                  {imagePreviews.map((preview, idx) => (
                    <PhotoThumb key={`new-${idx}`} src={preview} alt={`New photo ${idx + 1}`} onRemove={() => removeImage(idx)} />
                  ))}
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-neutral-500 transition-colors hover:border-emerald-500 hover:bg-emerald-50/50 hover:text-emerald-700"
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-[11px] font-semibold">Add photos</span>
                  </button>
                </div>
              </div>

              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <div className="flex items-center justify-between">
                  <p className={sectionLabel}>YouTube videos</p>
                  <span className="text-[11px] tabular-nums text-neutral-400">{formData.existingVideos.length + formData.videoUrls.length} added</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="url"
                    value={newVideoUrl}
                    onChange={(e) => { setNewVideoUrl(e.target.value); setFormError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVideoUrl(); } }}
                    placeholder="Paste a YouTube link"
                    className={`${fieldClass} h-9`}
                  />
                  <button type="button" onClick={addVideoUrl} disabled={!newVideoUrl.trim()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50">
                    <Video className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
                {formData.existingVideos.length + formData.videoUrls.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {formData.existingVideos.map((vid) => (
                      <VideoThumb key={`existing-${vid}`} url={vid} onOpen={() => setActiveVideoUrl(vid)} onRemove={() => removeExistingVideo(vid)} />
                    ))}
                    {formData.videoUrls.map((embedUrl, idx) => (
                      <VideoThumb key={`new-${embedUrl}-${idx}`} url={embedUrl} onOpen={() => setActiveVideoUrl(embedUrl)} onRemove={() => removeVideoUrl(idx)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                {mediaTotal ? `${mediaTotal} media ${mediaTotal === 1 ? "item" : "items"} attached` : "Text only"}
              </span>
              <button type="button" onClick={closeForm} disabled={uploading} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                Cancel
              </button>
              <button type="submit" disabled={uploading || !formData.title.trim() || !formData.content.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-50">
                {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving</> : editingId ? "Save changes" : "Publish update"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete" onClick={() => setDeleteConfirmId(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><Trash2 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Delete this update?</h2>
                <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">
                  {deleting ? <>&ldquo;{deleting.title}&rdquo; will disappear for every user. </> : null}This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
              <button type="button" onClick={handleDeleteConfirmed} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Video preview */}
      {activeVideoUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Video preview" onClick={() => setActiveVideoUrl(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-[#0b2420] px-4 py-2.5">
              <span className="text-xs font-semibold text-white/80">Video preview</span>
              <button type="button" onClick={() => setActiveVideoUrl(null)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-white/70 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="aspect-video w-full">
              <iframe src={activeVideoUrl} title="Video preview" className="h-full w-full border-0" loading="lazy" referrerPolicy="no-referrer" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
