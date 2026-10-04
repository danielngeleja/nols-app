"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  Layers3,
  Link2,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Scale,
  Search,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Material = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  fileUrl: string | null;
  externalUrl: string | null;
  isPublished: boolean;
  sortOrder: number;
  updatedAt: string;
};

// Category look, spelled out for Tailwind.
const CATEGORIES = [
  { key: "PRODUCT_GUIDE", label: "Product guide", icon: BookOpen, tone: "bg-emerald-50 text-emerald-700" },
  { key: "SALES_SCRIPT", label: "Sales script", icon: MessageSquareText, tone: "bg-sky-50 text-sky-700" },
  { key: "PRESENTATION", label: "Presentation", icon: Presentation, tone: "bg-violet-50 text-violet-700" },
  { key: "CASE_STUDY", label: "Case study", icon: Trophy, tone: "bg-amber-50 text-amber-700" },
  { key: "POLICY", label: "Policy", icon: Scale, tone: "bg-rose-50 text-rose-700" },
  { key: "TRAINING", label: "Training", icon: GraduationCap, tone: "bg-teal-50 text-teal-700" },
  { key: "FAQ", label: "FAQ", icon: FileQuestion, tone: "bg-neutral-100 text-neutral-700" },
] as const;
const categoryOf = (key: string) => CATEGORIES.find((c) => c.key === key) || { key, label: key.replaceAll("_", " "), icon: Layers3, tone: "bg-neutral-100 text-neutral-700" };

const empty = { title: "", description: "", category: "PRODUCT_GUIDE", url: "", isPublished: false, sortOrder: 0 };
const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:border-emerald-800 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-45";
const heroButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

function hostOf(url: string | null | undefined) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function day(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminSalesMaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [visibility, setVisibility] = useState<"all" | "published" | "drafts">("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  const stats = useMemo(() => ({
    total: materials.length,
    published: materials.filter((item) => item.isPublished).length,
    drafts: materials.filter((item) => !item.isPublished).length,
  }), [materials]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/api/admin/sales/materials", { params: { pageSize: 100 } });
      setMaterials(response.data?.materials || []);
      setError("");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load sales materials.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Close the editor with Escape and lock the page behind it.
  useEffect(() => {
    if (!editorOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditorOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [editorOpen]);

  const openNew = () => {
    setForm({ ...empty, sortOrder: materials.length ? Math.max(...materials.map((m) => m.sortOrder)) + 1 : 0 });
    setEditingId(null);
    setEditorOpen(true);
  };

  const edit = (item: Material) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description || "",
      category: item.category,
      url: item.fileUrl || item.externalUrl || "",
      isPublished: item.isPublished,
      sortOrder: item.sortOrder,
    });
    setEditorOpen(true);
  };

  const payloadFrom = (f: typeof empty) => ({
    title: f.title.trim(),
    description: f.description.trim() || null,
    category: f.category,
    externalUrl: f.url.trim(),
    fileUrl: null,
    isPublished: f.isPublished,
    sortOrder: Number(f.sortOrder),
  });

  const saveWith = async (publish: boolean) => {
    const next = { ...form, isPublished: publish };
    if (next.title.trim().length < 2 || !next.url.startsWith("https://")) {
      setError("Enter a title and an HTTPS resource URL.");
      return;
    }
    setBusy("save");
    setError("");
    setNotice("");
    try {
      if (editingId) await apiClient.patch(`/api/admin/sales/materials/${editingId}`, payloadFrom(next));
      else await apiClient.post("/api/admin/sales/materials", payloadFrom(next));
      setNotice(publish ? `"${next.title.trim()}" is live for partners.` : `"${next.title.trim()}" saved as a draft.`);
      setEditorOpen(false);
      setEditingId(null);
      setForm(empty);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save this material.");
    } finally {
      setBusy("");
    }
  };

  // Quick publish/unpublish from the library, sending the same full payload as the editor.
  const togglePublish = async (item: Material) => {
    const url = item.fileUrl || item.externalUrl || "";
    if (!url.startsWith("https://")) {
      edit(item);
      setError("This material needs an HTTPS resource URL before it can be published.");
      return;
    }
    setBusy(`toggle-${item.id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.patch(`/api/admin/sales/materials/${item.id}`, payloadFrom({
        title: item.title,
        description: item.description || "",
        category: item.category,
        url,
        isPublished: !item.isPublished,
        sortOrder: item.sortOrder,
      }));
      setNotice(item.isPublished ? `"${item.title}" is hidden from partners.` : `"${item.title}" is now visible to partners.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not change visibility.");
    } finally {
      setBusy("");
    }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...materials]
      .filter((m) => (visibility === "published" ? m.isPublished : visibility === "drafts" ? !m.isPublished : true))
      .filter((m) => (category ? m.category === category : true))
      .filter((m) => !needle || [m.title, m.description, categoryOf(m.category).label].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }, [materials, visibility, category, query]);

  const categoryCounts = useMemo(() => {
    const out: Record<string, number> = {};
    materials
      .filter((m) => (visibility === "published" ? m.isPublished : visibility === "drafts" ? !m.isPublished : true))
      .forEach((m) => { out[m.category] = (out[m.category] || 0) + 1; });
    return out;
  }, [materials, visibility]);

  const formCat = categoryOf(form.category);
  const FormIcon = formCat.icon;
  const urlOk = form.url.startsWith("https://");

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Sales header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                Sales <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70">Partner enablement</span>
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Learning materials</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Draft, order and publish resources. Only published materials reach the partner workspace.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/sales" className={heroButton}><LayoutDashboard className="h-3.5 w-3.5" /> Sales review</Link>
              <Link href="/admin/sales/partners" className={heroButton}><Users className="h-3.5 w-3.5" /> Partners</Link>
              <Link href="/admin/sales/finance" className={heroButton}><Wallet className="h-3.5 w-3.5" /> Finance</Link>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh sales learning materials" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{stats.published}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Visible to partners</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{stats.drafts}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{stats.drafts === 1 ? "Draft" : "Drafts"} still hidden</p>
            </div>
            <div className="min-w-[10rem] flex-1 sm:max-w-xs">
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-emerald-400" style={{ width: `${stats.total ? (stats.published / stats.total) * 100 : 0}%` }} />
              </div>
              <p className="m-0 mt-1 text-xs text-white/55">{stats.total ? Math.round((stats.published / stats.total) * 100) : 0}% of {stats.total} published</p>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Material visibility">
            {([["all", "Library", Layers3, stats.total], ["published", "Published", Eye, stats.published], ["drafts", "Drafts", EyeOff, stats.drafts]] as const).map(([key, label, Icon, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={visibility === key}
                onClick={() => { setVisibility(key); setCategory(""); }}
                className={`relative inline-flex h-11 items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${visibility === key ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                <Icon className="h-4 w-4" /> {label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${visibility === key ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}>{count}</span>
                {visibility === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && !editorOpen && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Library */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{category ? categoryOf(category).label : visibility === "published" ? "Published materials" : visibility === "drafts" ? "Drafts" : "Resource library"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading…" : `${visible.length} ${visible.length === 1 ? "material" : "materials"} · in partner display order`}</p>
          </div>
          <div className="ml-auto flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                placeholder="Search title or description"
                aria-label="Search materials"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button type="button" onClick={openNew} className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#12342f]">
              <Plus className="h-3.5 w-3.5" /> New material
            </button>
          </div>
        </div>

        {/* Category rail */}
        <div className="flex gap-1.5 overflow-x-auto border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setCategory("")}
            aria-pressed={!category}
            className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${!category ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
          >
            All topics
          </button>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const n = categoryCounts[c.key] || 0;
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(active ? "" : c.key)}
                aria-pressed={active}
                className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${active ? "border-neutral-900 bg-neutral-900 text-white" : n ? "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300" : "border-dashed border-neutral-200 bg-white text-neutral-400 hover:text-neutral-600"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {c.label}
                <span className={`tabular-nums ${active ? "text-white/70" : "text-neutral-400"}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {loading && materials.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading library
          </div>
        ) : visible.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              <BookOpen className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{materials.length === 0 ? "No learning materials yet" : "Nothing matches"}</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {materials.length === 0 ? "Add the first guide, script or presentation for your partners." : "Try another topic, tab or search."}
            </p>
            {materials.length === 0 && (
              <button type="button" onClick={openNew} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">
                <Plus className="h-4 w-4" /> New material
              </button>
            )}
          </div>
        ) : (
          <div className={`grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
            {visible.map((item) => {
              const cat = categoryOf(item.category);
              const Icon = cat.icon;
              const url = item.fileUrl || item.externalUrl;
              const host = hostOf(url);
              return (
                <article key={item.id} className={`group flex min-w-0 flex-col rounded-xl border border-solid bg-white transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_rgba(11,36,32,0.45)] ${item.isPublished ? "border-neutral-200 hover:border-neutral-300" : "border-dashed border-neutral-300"}`}>
                  <div className="flex items-start gap-3 p-4">
                    <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${cat.tone}`}><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 flex items-center gap-2 text-[11px] text-neutral-400">
                        <span>{cat.label}</span>
                        <span className="font-mono">#{item.sortOrder}</span>
                      </p>
                      <h3 className="m-0 mt-0.5 line-clamp-2 text-sm font-semibold text-neutral-900">{item.title}</h3>
                    </div>
                    <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${item.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
                      {item.isPublished ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {item.isPublished ? "Live" : "Draft"}
                    </span>
                  </div>
                  <p className={`m-0 line-clamp-2 px-4 text-xs ${item.description ? "text-neutral-600" : "italic text-neutral-400"}`}>{item.description || "No description yet"}</p>
                  <div className="mt-auto flex items-center gap-2 px-4 pb-3 pt-3 text-[11px] text-neutral-400">
                    <Link2 className="h-3 w-3 flex-shrink-0" />
                    <span className="min-w-0 truncate">{host || "No link"}</span>
                    <span className="ml-auto flex-shrink-0">Updated {day(item.updatedAt)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100">
                    <button type="button" onClick={() => edit(item)} className="inline-flex h-10 items-center justify-center gap-1.5 border-0 bg-white text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void togglePublish(item)}
                      disabled={busy === `toggle-${item.id}`}
                      className={`inline-flex h-10 items-center justify-center gap-1.5 border-0 bg-white text-xs font-semibold transition-colors disabled:opacity-60 ${item.isPublished ? "text-neutral-600 hover:bg-neutral-50" : "text-emerald-700 hover:bg-emerald-50"}`}
                    >
                      {busy === `toggle-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : item.isPublished ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {item.isPublished ? "Unpublish" : "Publish"}
                    </button>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-1.5 bg-white text-xs font-semibold text-neutral-700 no-underline transition-colors hover:bg-neutral-50 hover:no-underline">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </a>
                    ) : (
                      <span className="inline-flex h-10 items-center justify-center bg-white text-xs text-neutral-300">No link</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Editor: centred workspace, form on the left, live partner view on the right */}
      {editorOpen && (() => {
        const ordered = [...materials].filter((m) => m.id !== editingId).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
        const before = [...ordered].reverse().find((m) => m.sortOrder <= Number(form.sortOrder)) || null;
        const after = ordered.find((m) => m.sortOrder > Number(form.sortOrder)) || null;
        const titleOk = form.title.trim().length >= 2;
        const checks = [
          { ok: titleOk, label: "Title" },
          { ok: urlOk, label: "Secure link" },
          { ok: form.description.trim().length > 0, label: "Description", optional: true },
        ];
        const ready = titleOk && urlOk;
        const suggestTitle = () => {
          try {
            const u = new URL(form.url);
            const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim();
            if (last && !/^[a-z0-9]{20,}$/i.test(last)) setForm((f) => ({ ...f, title: last.charAt(0).toUpperCase() + last.slice(1) }));
          } catch {}
        };
        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-neutral-950/50 p-3 backdrop-blur-sm sm:p-6" onMouseDown={() => { if (busy !== "save") setEditorOpen(false); }}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="material-editor-title"
              className="my-auto flex max-h-[calc(100dvh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_90px_-20px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-48px)]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-3.5">
                <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${formCat.tone}`}><FormIcon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <h2 id="material-editor-title" className="m-0 truncate text-base font-bold text-neutral-900">
                    {editingId ? form.title.trim() || "Edit material" : "New learning material"}
                  </h2>
                  <p className="m-0 text-xs text-neutral-500">{editingId ? `Material #${editingId}` : "Add a resource for sales partners"}</p>
                </div>
                <ul className="m-0 hidden list-none items-center gap-3 p-0 md:flex" aria-label="Checklist">
                  {checks.map((c) => (
                    <li key={c.label} className={`inline-flex items-center gap-1 text-xs ${c.ok ? "text-emerald-700" : "text-neutral-400"}`}>
                      {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-solid border-neutral-300" />}
                      {c.label}{c.optional && !c.ok ? " (optional)" : ""}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setEditorOpen(false)} className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Close editor">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:overflow-hidden">
                {/* Form */}
                <div className="min-w-0 space-y-5 px-5 py-5 md:overflow-y-auto">
                  {error && (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50/60 px-3 py-2 text-xs text-rose-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" /> {error}
                    </div>
                  )}

                  {/* 1. Link first: it is the thing partners open */}
                  <div>
                    <label htmlFor="material-url" className="flex items-baseline justify-between text-xs font-semibold text-neutral-800">
                      <span>Resource link</span>
                      <span className={`text-[11px] font-normal ${!form.url ? "text-neutral-400" : urlOk ? "text-emerald-700" : "text-rose-600"}`}>
                        {!form.url ? "https:// only" : urlOk ? hostOf(form.url) || "Secure link" : "Must start with https://"}
                      </span>
                    </label>
                    <div className="relative mt-1.5">
                      <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                      <input
                        id="material-url"
                        value={form.url}
                        onChange={(e) => setForm({ ...form, url: e.target.value.trim() })}
                        onBlur={() => { if (urlOk && !form.title.trim()) suggestTitle(); }}
                        className={`${fieldClass} pl-9 pr-16 ${form.url && !urlOk ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""}`}
                        placeholder="Paste the https:// link"
                        inputMode="url"
                        autoFocus={!editingId}
                      />
                      {urlOk && (
                        <a href={form.url} target="_blank" rel="noopener noreferrer" className="absolute right-2 top-1/2 inline-flex h-7 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-neutral-600 no-underline hover:bg-neutral-100 hover:no-underline">
                          Test <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* 2. Title */}
                  <div>
                    <label htmlFor="material-title" className="flex items-baseline justify-between text-xs font-semibold text-neutral-800">
                      <span>Title</span>
                      
                    </label>
                    <input
                      id="material-title"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      className={`${fieldClass} mt-1.5`}
                      placeholder="For example: NRMS product guide"
                      autoFocus={Boolean(editingId)}
                    />
                  </div>

                  {/* 3. Topic */}
                  <div>
                    <p className="m-0 text-xs font-semibold text-neutral-800">Topic</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {CATEGORIES.map((c) => {
                        const Icon = c.icon;
                        const on = form.category === c.key;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setForm({ ...form, category: c.key })}
                            aria-pressed={on}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"}`}
                          >
                            <Icon className="h-3.5 w-3.5" /> {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 4. Description */}
                  <div>
                    <label htmlFor="material-description" className="flex items-baseline justify-between text-xs font-semibold text-neutral-800">
                      <span>Description <span className="font-normal text-neutral-400">(optional)</span></span>
                      
                    </label>
                    <textarea
                      id="material-description"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className={`${fieldClass} mt-1.5 min-h-[5.5rem] resize-none py-2 font-[inherit]`}
                      placeholder="One or two lines on what this helps a partner do"
                    />
                  </div>

                  {/* 5. Position in the partner list */}
                  <div>
                    <p className="m-0 text-xs font-semibold text-neutral-800">Position in the partner list</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="inline-flex h-10 items-center overflow-hidden rounded-lg border border-solid border-neutral-200">
                        <button type="button" onClick={() => setForm({ ...form, sortOrder: Math.max(0, Number(form.sortOrder) - 1) })} className="h-full w-9 border-0 bg-white text-neutral-500 hover:bg-neutral-50" aria-label="Move up">-</button>
                        <input
                          type="number"
                          min={0}
                          value={form.sortOrder}
                          onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                          className="h-full w-12 border-0 border-x border-solid border-neutral-200 bg-white text-center font-mono text-sm tabular-nums text-neutral-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          aria-label="Display order"
                        />
                        <button type="button" onClick={() => setForm({ ...form, sortOrder: Number(form.sortOrder) + 1 })} className="h-full w-9 border-0 bg-white text-neutral-500 hover:bg-neutral-50" aria-label="Move down">+</button>
                      </div>
                      <p className="m-0 min-w-0 flex-1 truncate text-xs text-neutral-500">
                        {ordered.length === 0
                          ? "First material in the list"
                          : !before
                            ? <>Shows first, before <span className="text-neutral-800">{after?.title}</span></>
                            : !after
                              ? <>Shows last, after <span className="text-neutral-800">{before.title}</span></>
                              : <>Between <span className="text-neutral-800">{before.title}</span> and <span className="text-neutral-800">{after.title}</span></>}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live partner view */}
                <div className="min-w-0 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-5 py-5 md:overflow-y-auto md:border-l md:border-t-0">
                  <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                    <Eye className="h-3.5 w-3.5" /> What partners will see
                  </p>
                  <div className="mt-3 overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                    <div className="flex items-center gap-1.5 border-0 border-b border-solid border-neutral-100 bg-[#0b2420] px-3 py-2">
                      <span className="h-2 w-2 rounded-full bg-white/25" /><span className="h-2 w-2 rounded-full bg-white/25" /><span className="h-2 w-2 rounded-full bg-white/25" />
                      <span className="ml-2 truncate text-[11px] text-white/60">Partner workspace · Learning</span>
                    </div>
                    <div className="space-y-2 p-3">
                      {before && (
                        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 opacity-50">
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${categoryOf(before.category).tone}`}>{(() => { const I = categoryOf(before.category).icon; return <I className="h-3.5 w-3.5" />; })()}</span>
                          <span className="truncate text-xs text-neutral-600">{before.title}</span>
                        </div>
                      )}
                      <div className={`flex items-start gap-3 rounded-lg border border-solid p-3 ${form.isPublished ? "border-emerald-200 bg-white" : "border-dashed border-neutral-300 bg-white"}`}>
                        <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${formCat.tone}`}><FormIcon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] text-neutral-400">{formCat.label}</p>
                          <p className={`m-0 truncate text-sm font-semibold ${form.title.trim() ? "text-neutral-900" : "text-neutral-300"}`}>{form.title.trim() || "Material title"}</p>
                          <p className={`m-0 mt-0.5 line-clamp-3 text-xs ${form.description.trim() ? "text-neutral-500" : "text-neutral-300"}`}>{form.description.trim() || "Description appears here."}</p>
                          <p className="m-0 mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            Open {urlOk ? `on ${hostOf(form.url)}` : "resource"} <ExternalLink className="h-3 w-3" />
                          </p>
                        </div>
                      </div>
                      {after && (
                        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 opacity-50">
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${categoryOf(after.category).tone}`}>{(() => { const I = categoryOf(after.category).icon; return <I className="h-3.5 w-3.5" />; })()}</span>
                          <span className="truncate text-xs text-neutral-600">{after.title}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className={`m-0 mt-3 flex items-center gap-1.5 text-xs ${form.isPublished ? "text-emerald-700" : "text-neutral-500"}`}>
                    {form.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {form.isPublished ? "Visible to every active sales partner" : "Hidden from partners until published"}
                  </p>
                </div>
              </div>

              {/* Footer: visibility is the save decision */}
              <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-neutral-100 bg-white px-5 py-3">
                <button type="button" onClick={() => setEditorOpen(false)} disabled={busy === "save"} className="h-10 rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-neutral-500 hover:text-neutral-800">
                  Cancel
                </button>
                <span className="ml-auto hidden text-xs text-neutral-400 sm:inline">{ready ? "Ready to save" : "Add a title and a secure link"}</span>
                <button
                  type="button"
                  disabled={busy === "save" || !ready}
                  onClick={() => { setForm((f) => ({ ...f, isPublished: false })); void saveWith(false); }}
                  className={secondaryButton}
                >
                  {busy === "save" && !form.isPublished ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
                  {editingId && !materials.find((m) => m.id === editingId)?.isPublished ? "Save draft" : editingId ? "Unpublish and save" : "Save as draft"}
                </button>
                <button
                  type="button"
                  disabled={busy === "save" || !ready}
                  onClick={() => { setForm((f) => ({ ...f, isPublished: true })); void saveWith(true); }}
                  className={primaryButton}
                >
                  {busy === "save" && form.isPublished ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {editingId && materials.find((m) => m.id === editingId)?.isPublished ? "Save changes" : "Publish"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
