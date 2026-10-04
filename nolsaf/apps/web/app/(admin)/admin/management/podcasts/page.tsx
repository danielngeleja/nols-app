"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Monitor,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
  Youtube,
} from "lucide-react";

const api = axios.create({ baseURL: "" });

interface Episode {
  id: string;
  title: string;
  description: string;
  youtubeUrl: string;
  thumbnailUrl: string | null;
  guestName: string | null;
  guestRole: string | null;
  tags: string[];
  duration: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  youtubeUrl: "",
  guestName: "",
  guestRole: "",
  duration: "",
  tags: "",
  published: false,
};

type StatusFilter = "published" | "draft";

const STAGES: Array<{ key: StatusFilter; label: string; hint: string; icon: typeof Eye; text: string; bar: string; soft: string }> = [
  { key: "published", label: "Published", hint: "Live on the public homepage", icon: Eye, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50/70" },
  { key: "draft", label: "Drafts", hint: "Saved but hidden from users", icon: FileText, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70" },
];

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const fieldClass =
  "box-border w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

function extractYouTubeId(url: string): string | null {
  const m = String(url || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function thumbOf(ep: Pick<Episode, "thumbnailUrl" | "youtubeUrl">, size: "mq" | "hq" = "mq") {
  if (ep.thumbnailUrl) return ep.thumbnailUrl;
  const id = extractYouTubeId(ep.youtubeUrl);
  return id ? `https://img.youtube.com/vi/${id}/${size}default.jpg` : null;
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

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-0 p-0.5 transition-colors ${checked ? "bg-[#02665e]" : "bg-neutral-300"}`}
      >
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
      <span className="text-xs font-semibold text-neutral-700">{label}</span>
    </label>
  );
}

export default function AdminPodcastsPage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<StatusFilter | null>(null);
  const [search, setSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    void loadEpisodes();
  }, []);

  useEffect(() => {
    if (!showForm && !deleteConfirmId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteConfirmId) setDeleteConfirmId(null);
      else if (!saving) closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closeForm only resets local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, deleteConfirmId, saving]);

  const loadEpisodes = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/admin/podcasts", { withCredentials: true });
      setEpisodes(res.data?.items || []);
    } catch {
      setError("Failed to load episodes");
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const published = episodes.filter((e) => e.published);
    const latest = [...published].sort((a, b) => ((a.publishedAt || a.createdAt) < (b.publishedAt || b.createdAt) ? 1 : -1))[0];
    const guests = new Set(episodes.map((e) => (e.guestName || "").trim().toLowerCase()).filter(Boolean));
    return { total: episodes.length, published: published.length, drafts: episodes.length - published.length, latest, guests: guests.size };
  }, [episodes]);

  const filtered = useMemo(() => {
    let list = [...episodes].sort((a, b) => ((a.publishedAt || a.createdAt) < (b.publishedAt || b.createdAt) ? 1 : -1));
    if (status === "published") list = list.filter((e) => e.published);
    if (status === "draft") list = list.filter((e) => !e.published);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.guestName?.toLowerCase().includes(q) ||
          (e.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [episodes, status, search]);

  const flash = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess((current) => (current === message ? null : current)), 4000);
  };

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowPreview(false);
    setFormError(null);
  };

  const openNew = () => {
    closeForm();
    setShowForm(true);
  };

  const openEdit = (ep: Episode) => {
    setForm({
      title: ep.title,
      description: ep.description,
      youtubeUrl: ep.youtubeUrl,
      guestName: ep.guestName || "",
      guestRole: ep.guestRole || "",
      duration: ep.duration || "",
      tags: (ep.tags || []).join(", "),
      published: ep.published,
    });
    setEditingId(ep.id);
    setShowPreview(false);
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) return setFormError("Give the episode a title.");
    if (!form.youtubeUrl.trim()) return setFormError("Paste the episode's YouTube link.");
    if (!extractYouTubeId(form.youtubeUrl)) return setFormError("That does not look like a YouTube video link.");

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        youtubeUrl: form.youtubeUrl.trim(),
        guestName: form.guestName.trim() || null,
        guestRole: form.guestRole.trim() || null,
        duration: form.duration.trim() || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        published: form.published,
      };
      const wasEditing = Boolean(editingId);
      if (editingId) await api.put(`/api/admin/podcasts/${editingId}`, payload, { withCredentials: true });
      else await api.post("/api/admin/podcasts", payload, { withCredentials: true });
      closeForm();
      flash(wasEditing ? "Episode saved." : form.published ? "Episode published." : "Episode saved as a draft.");
      void loadEpisodes();
    } catch (err: any) {
      setFormError(err.response?.data?.error || "Failed to save episode");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (ep: Episode) => {
    setBusyId(ep.id);
    try {
      await api.put(`/api/admin/podcasts/${ep.id}`, { published: !ep.published }, { withCredentials: true });
      flash(ep.published ? "Episode moved to drafts." : "Episode is now live.");
      await loadEpisodes();
    } catch {
      setError("Failed to update publish status");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/api/admin/podcasts/${id}`, { withCredentials: true });
      setDeleteConfirmId(null);
      flash("Episode deleted.");
      void loadEpisodes();
    } catch {
      setDeleteConfirmId(null);
      setError("Failed to delete episode");
    }
  };

  const previewThumb = thumbOf({ thumbnailUrl: null, youtubeUrl: form.youtubeUrl }, "hq");
  const deleteTarget = deleteConfirmId ? episodes.find((e) => e.id === deleteConfirmId) : null;
  const linkLooksWrong = form.youtubeUrl.trim().length > 0 && !extractYouTubeId(form.youtubeUrl);

  const facts = [
    { label: "Episodes", value: loading ? "..." : String(stats.total), detail: `${stats.guests} ${stats.guests === 1 ? "guest" : "guests"} featured`, tone: "text-white" },
    { label: "Live on homepage", value: loading ? "..." : String(stats.published), detail: stats.total ? `${Math.round((stats.published / stats.total) * 100)}% of all episodes` : "nothing live yet", tone: stats.published ? "text-emerald-300" : "text-white" },
    { label: "Drafts", value: loading ? "..." : String(stats.drafts), detail: stats.drafts ? "waiting to be published" : "no drafts", tone: stats.drafts ? "text-amber-300" : "text-white" },
    { label: "Latest episode", value: loading ? "..." : stats.latest ? ago(stats.latest.publishedAt || stats.latest.createdAt) : "None", detail: stats.latest ? stats.latest.title : "publish the first one", tone: "text-white" },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Homepage media</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Podcast and media</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">YouTube episodes shown on the public homepage. Drafts stay hidden until you publish them.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={openNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-semibold text-[#0b2420] transition-colors hover:bg-emerald-300">
                <Plus className="h-3.5 w-3.5" /> New episode
              </button>
              <button type="button" onClick={() => void loadEpisodes()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
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

      {/* Status track, doubling as a filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const n = stage.key === "published" ? stats.published : stats.drafts;
            const share = stats.total ? Math.round((n / stats.total) * 100) : 0;
            const selected = status === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => setStatus(selected ? null : stage.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}><Icon className="h-3.5 w-3.5" /> {stage.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{loading ? "..." : n}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{status === "published" ? "Published episodes" : status === "draft" ? "Drafts" : "All episodes"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${filtered.length} ${filtered.length === 1 ? "episode" : "episodes"}, newest first`}</p>
          </div>
          {status && (
            <button type="button" onClick={() => setStatus(null)} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Show all
            </button>
          )}
          <div className="relative ml-auto w-full min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, guest or tag" aria-label="Search episodes" className={`${fieldClass} h-9 pl-9 pr-9`} />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading && episodes.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading episodes
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Radio className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-neutral-900">{episodes.length ? "No episodes match" : "No episodes yet"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{episodes.length ? "Try another word or clear the filter." : "Add a YouTube episode and it can go live on the homepage straight away."}</p>
            </div>
            {!episodes.length && (
              <button type="button" onClick={openNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f]">
                <Plus className="h-3.5 w-3.5" /> New episode
              </button>
            )}
          </div>
        ) : (
          <div>
            {filtered.map((ep, idx) => {
              const thumb = thumbOf(ep);
              const when = ep.publishedAt || ep.createdAt;
              return (
                <article key={ep.id} className={`flex min-w-0 items-center gap-4 px-4 py-3.5 sm:px-5 ${idx ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                  <a href={ep.youtubeUrl} target="_blank" rel="noopener noreferrer" className="group relative block h-[63px] w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-inset ring-neutral-200" aria-label={`Watch ${ep.title} on YouTube`}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-neutral-300"><Play className="h-4 w-4" /></span>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/20">
                      <Play className="h-5 w-5 fill-white text-white opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    {ep.duration && <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-semibold tabular-nums text-white">{ep.duration}</span>}
                  </a>

                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-semibold text-neutral-900">{ep.title}</p>
                    <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                      {(ep.guestName || ep.guestRole) && (
                        <span className="inline-flex items-center gap-1 text-neutral-600"><User className="h-3 w-3" /> {ep.guestName}{ep.guestRole ? `, ${ep.guestRole}` : ""}</span>
                      )}
                      <span>{ep.published ? "Published" : "Created"} {ago(when).toLowerCase()} · {eat(when)}</span>
                    </p>
                    {(ep.tags || []).length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {ep.tags.slice(0, 4).map((t) => (
                          <span key={t} className="rounded-md bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200">{t}</span>
                        ))}
                        {ep.tags.length > 4 && <span className="text-[11px] text-neutral-400">+{ep.tags.length - 4}</span>}
                      </span>
                    )}
                  </div>

                  <span className={`hidden shrink-0 items-center gap-1.5 text-xs font-semibold sm:inline-flex ${ep.published ? "text-emerald-700" : "text-amber-700"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${ep.published ? "bg-emerald-500" : "bg-amber-400"}`} />
                    {ep.published ? "Live" : "Draft"}
                  </span>

                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void togglePublish(ep)}
                      disabled={busyId === ep.id}
                      className={`hidden h-8 items-center gap-1.5 rounded-lg border border-solid px-2.5 text-xs font-semibold transition-colors disabled:opacity-50 md:inline-flex ${ep.published ? "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50" : "border-transparent bg-[#0b2420] text-white hover:bg-[#12342f]"}`}
                    >
                      {busyId === ep.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : ep.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {ep.published ? "Unpublish" : "Publish"}
                    </button>
                    <a href={ep.youtubeUrl} target="_blank" rel="noopener noreferrer" title="Open on YouTube" aria-label={`Open ${ep.title} on YouTube`} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <button type="button" onClick={() => openEdit(ep)} title="Edit" aria-label={`Edit ${ep.title}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setDeleteConfirmId(ep.id)} title="Delete" aria-label={`Delete ${ep.title}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Create / edit dialog */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editingId ? "Edit episode" : "New episode"} onClick={() => !saving && closeForm()}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><Radio className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{editingId ? "Edit episode" : "New episode"}</h2>
                <p className="m-0 text-xs text-neutral-400">{form.published ? "Goes live on the homepage when you save." : "Saved as a draft, hidden from users."}</p>
              </div>
              <div className="hidden rounded-lg bg-neutral-100 p-0.5 sm:inline-flex" role="tablist" aria-label="Editor view">
                {([[false, "Details"], [true, "Preview"]] as const).map(([preview, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={showPreview === preview}
                    onClick={() => setShowPreview(preview)}
                    className={`inline-flex h-7 items-center gap-1 rounded-md border-0 px-2.5 text-xs font-semibold ${showPreview === preview ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}
                  >
                    {preview && <Monitor className="h-3 w-3" />} {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={closeForm} disabled={saving} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {formError && (
                <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="flex-1">{formError}</span>
                </div>
              )}

              {showPreview ? (
                <div className="px-5 py-5">
                  <p className={sectionLabel}>How it appears on the homepage</p>
                  <div className="mt-3 flex justify-center">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
                      <div className="relative aspect-video overflow-hidden bg-neutral-100">
                        {previewThumb ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={previewThumb} alt="" className="h-full w-full object-cover" />
                            <span className="absolute inset-0 grid place-items-center">
                              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 shadow-lg"><Play className="ml-0.5 h-5 w-5 fill-neutral-900 text-neutral-900" /></span>
                            </span>
                            {form.duration && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">{form.duration}</span>}
                          </>
                        ) : (
                          <span className="grid h-full w-full place-items-center text-neutral-300"><Play className="h-10 w-10" /></span>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="m-0 line-clamp-2 text-[15px] font-bold leading-snug text-neutral-900">{form.title || <span className="font-normal italic text-neutral-300">Episode title</span>}</h3>
                        {(form.guestName || form.guestRole) && (
                          <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-neutral-500"><User className="h-3 w-3" /> {form.guestName}{form.guestRole && <span className="text-neutral-400">, {form.guestRole}</span>}</p>
                        )}
                        {form.description && <p className="m-0 mt-2 line-clamp-2 text-[13px] leading-relaxed text-neutral-500">{form.description}</p>}
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-[11px] text-neutral-400">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e]">Watch <Play className="h-3 w-3 fill-current" /></span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_200px]">
                    <div className="min-w-0 space-y-4">
                      <label className="block">
                        <span className="flex items-center justify-between"><span className={sectionLabel}>Title</span><span className="text-[11px] tabular-nums text-neutral-400">{form.title.length}/300</span></span>
                        <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} placeholder="For example: Interview with the Tanzania Tourism Board" className={`${fieldClass} mt-1.5 h-10 text-[15px] font-semibold`} />
                      </label>
                      <label className="block">
                        <span className={sectionLabel}>YouTube link</span>
                        <span className="relative mt-1.5 block">
                          <Youtube className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rose-500" />
                          <input type="url" value={form.youtubeUrl} onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=..." className={`${fieldClass} h-10 pl-9 ${linkLooksWrong ? "border-rose-300" : ""}`} />
                        </span>
                        {linkLooksWrong && <span className="mt-1 block text-[11px] font-medium text-rose-600">Paste a youtube.com/watch, youtu.be or embed link.</span>}
                      </label>
                    </div>
                    <div className="min-w-0">
                      <p className={sectionLabel}>Thumbnail</p>
                      <div className="mt-1.5 aspect-video overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-inset ring-neutral-200">
                        {previewThumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previewThumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="grid h-full w-full place-items-center px-3 text-center text-[11px] text-neutral-400">Appears once the link is valid</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                    <label className="block">
                      <span className="flex items-center justify-between"><span className={sectionLabel}>Description</span><span className="text-[11px] tabular-nums text-neutral-400">{form.description.trim() ? form.description.trim().split(/\s+/).length : 0} words</span></span>
                      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="A short summary shown under the title." className={`${fieldClass} mt-1.5 block resize-none py-2.5 leading-6`} />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-2">
                    <label className="block min-w-0 px-5 py-4">
                      <span className={sectionLabel}>Guest name</span>
                      <input type="text" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} placeholder="Optional" className={`${fieldClass} mt-1.5 h-9`} />
                    </label>
                    <label className="block min-w-0 border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:border-l sm:border-t-0">
                      <span className={sectionLabel}>Guest role</span>
                      <input type="text" value={form.guestRole} onChange={(e) => setForm({ ...form, guestRole: e.target.value })} placeholder="For example: Director of Tourism" className={`${fieldClass} mt-1.5 h-9`} />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-[200px_minmax(0,1fr)]">
                    <label className="block min-w-0 px-5 py-4">
                      <span className={sectionLabel}>Duration</span>
                      <input type="text" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="12:34" className={`${fieldClass} mt-1.5 h-9 tabular-nums`} />
                    </label>
                    <label className="block min-w-0 border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:border-l sm:border-t-0">
                      <span className={sectionLabel}>Tags, separated by commas</span>
                      <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="interview, tourism, update" className={`${fieldClass} mt-1.5 h-9`} />
                      {form.tags.trim() && (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {form.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
                            <span key={`${t}-${i}`} className="rounded-md bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200">{t}</span>
                          ))}
                        </span>
                      )}
                    </label>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <Switch checked={form.published} onChange={(v) => setForm({ ...form, published: v })} label="Publish on the homepage" />
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={closeForm} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-50">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? "Save changes" : form.published ? "Publish episode" : "Save draft"}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete" onClick={() => setDeleteConfirmId(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><Trash2 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Delete this episode?</h2>
                <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">
                  {deleteTarget ? <>&ldquo;{deleteTarget.title}&rdquo; {deleteTarget.published ? "comes off the homepage straight away. " : ""}</> : null}This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
              <button type="button" onClick={() => void handleDelete(deleteConfirmId)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
