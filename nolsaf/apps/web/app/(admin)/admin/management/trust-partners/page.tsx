"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  ArrowDown,
  ArrowUp,
  Award,
  Camera,
  CheckCircle2,
  Edit,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

// Same-origin so Next.js rewrites proxy to the API with the session cookie.
const api = apiClient;

type TrustPartner = {
  id: number;
  name: string;
  logoUrl: string | null;
  href: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const EMPTY_FORM = { name: "", logoUrl: "", href: "", displayOrder: 0, isActive: true };

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const fieldClass =
  "box-border w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

function domainOf(href: string | null) {
  return href ? href.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") : "";
}

function errorText(err: any, fallback: string) {
  return err?.response?.data?.error || err?.response?.data?.message || fallback;
}

function Logo({ partner, broken, onBroken, className }: { partner: Pick<TrustPartner, "name" | "logoUrl">; broken: boolean; onBroken: () => void; className: string }) {
  if (!partner.logoUrl || broken) {
    return (
      <span className={`grid place-items-center text-neutral-300 ${className}`}>
        <ImageIcon className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className={`flex items-center justify-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={partner.logoUrl} alt={`${partner.name} logo`} onError={onBroken} className="max-h-full max-w-full object-contain" />
    </span>
  );
}

export default function AdminTrustPartnersPage() {
  const [partners, setPartners] = useState<TrustPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<TrustPartner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TrustPartner | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<{ items: TrustPartner[] }>("/api/admin/trust-partners");
      setPartners(r.data?.items ?? []);
    } catch (err) {
      console.error("Failed to load trust partners", err);
      setError("Could not load trust partners.");
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!showModal && !deleteTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTarget && !deleting) setDeleteTarget(null);
      else if (showModal && !submitting) setShowModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, deleteTarget, deleting, submitting]);

  const ordered = useMemo(() => [...partners].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id), [partners]);
  const active = ordered.filter((p) => p.isActive);
  const missingLogo = partners.filter((p) => !p.logoUrl || brokenLogos.has(p.logoUrl)).length;
  const lastChanged = partners.reduce<string>((max, p) => (p.updatedAt > max ? p.updatedAt : max), "");

  const markBroken = (url: string | null) => () => {
    if (!url) return;
    setBrokenLogos((current) => (current.has(url) ? current : new Set(current).add(url)));
  };

  const flash = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess((current) => (current === message ? null : current)), 4000);
  };

  const openModal = (partner?: TrustPartner) => {
    setEditingPartner(partner ?? null);
    setFormData(
      partner
        ? { name: partner.name, logoUrl: partner.logoUrl || "", href: partner.href || "", displayOrder: partner.displayOrder, isActive: partner.isActive }
        : { ...EMPTY_FORM, displayOrder: ordered.length ? ordered[ordered.length - 1].displayOrder + 1 : 1 },
    );
    setFormError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPartner(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (editingPartner) await api.patch(`/api/admin/trust-partners/${editingPartner.id}`, formData);
      else await api.post("/api/admin/trust-partners", formData);
      const name = formData.name;
      const wasEditing = Boolean(editingPartner);
      closeModal();
      flash(wasEditing ? `${name} saved.` : `${name} added${formData.isActive ? " to the homepage" : ""}.`);
      await load();
    } catch (err: any) {
      setFormError(errorText(err, "Failed to save trust partner"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/admin/trust-partners/${deleteTarget.id}`);
      flash(`${deleteTarget.name} removed.`);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setDeleteTarget(null);
      setError(errorText(err, "Failed to delete trust partner"));
    } finally {
      setDeleting(false);
    }
  };

  const toggleActive = async (partner: TrustPartner) => {
    setBusyId(partner.id);
    try {
      await api.patch(`/api/admin/trust-partners/${partner.id}`, { isActive: !partner.isActive });
      flash(partner.isActive ? `${partner.name} hidden from the homepage.` : `${partner.name} is showing on the homepage.`);
      await load();
    } catch (err: any) {
      setError(errorText(err, "Failed to update partner status"));
    } finally {
      setBusyId(null);
    }
  };

  // Swaps display order with the neighbour. Orders are renumbered 1..n first so
  // duplicate or gapped values (common after manual edits) still move cleanly.
  const move = async (partner: TrustPartner, direction: -1 | 1) => {
    const index = ordered.findIndex((p) => p.id === partner.id);
    const neighbour = ordered[index + direction];
    if (!neighbour) return;
    setBusyId(partner.id);
    try {
      const sequence = ordered.map((p) => p.id);
      [sequence[index], sequence[index + direction]] = [sequence[index + direction], sequence[index]];
      const updates = sequence
        .map((id, i) => ({ id, order: i + 1 }))
        .filter(({ id, order }) => partners.find((p) => p.id === id)?.displayOrder !== order);
      for (const { id, order } of updates) {
        await api.patch(`/api/admin/trust-partners/${id}`, { displayOrder: order });
      }
      await load();
    } catch (err: any) {
      setError(errorText(err, "Could not change the order"));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    setFormError(null);
    try {
      let sigData: any;
      try {
        const sig = await api.get(`/api/uploads/cloudinary/sign?folder=trust-partners`);
        sigData = sig.data;
      } catch (err: any) {
        setFormError(`Could not get an upload signature (${err?.response?.status ?? "?"}). ${errorText(err, err?.message || "Unauthorized")}`);
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sigData.apiKey);
      fd.append("timestamp", String(sigData.timestamp));
      fd.append("folder", sigData.folder);
      // Must match the params signed on the server (apps/api/src/routes/uploads.cloudinary.ts).
      fd.append("overwrite", "true");
      fd.append("signature", sigData.signature);
      try {
        // Direct to Cloudinary: no session cookies involved.
        const uploadRes = await axios.post(`https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`, fd);
        const uploadedUrl = uploadRes.data.secure_url;
        setFormData((prev) => ({ ...prev, logoUrl: uploadedUrl }));
      } catch (err: any) {
        const cloudMsg = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || "Upload failed";
        setFormError(`Logo upload failed (${err?.response?.status ?? "?"}). ${cloudMsg}`);
      }
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setFormError("Choose an image file (PNG, JPG, GIF or WebP).");
    if (file.size > 5 * 1024 * 1024) return setFormError("The logo must be smaller than 5 MB.");
    void handleLogoUpload(file);
  };

  const facts = [
    { label: "Partners", value: loading ? "..." : String(partners.length), detail: "in the Trusted by list", tone: "text-white" },
    { label: "On the homepage", value: loading ? "..." : String(active.length), detail: partners.length - active.length ? `${partners.length - active.length} hidden` : "all showing", tone: active.length ? "text-emerald-300" : "text-white" },
    { label: "Missing logo", value: loading ? "..." : String(missingLogo), detail: missingLogo ? "show as a blank tile" : "every logo loads", tone: missingLogo ? "text-amber-300" : "text-white" },
    {
      label: "Last change",
      value: loading ? "..." : lastChanged ? new Date(lastChanged).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Dar_es_Salaam" }) : "None",
      detail: lastChanged ? `${new Date(lastChanged).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "nothing added yet",
      tone: "text-white",
    },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Homepage</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Trust partners</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">The logos in the Trusted by row on the public homepage, shown left to right in the order below.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => openModal()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-3 text-xs font-semibold text-[#0b2420] transition-colors hover:bg-emerald-300">
                <Plus className="h-3.5 w-3.5" /> Add partner
              </button>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
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

      {/* What visitors see */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">On the homepage now</h2>
            <p className="m-0 text-xs text-neutral-400">The Trusted by row as visitors see it. Hidden partners are left out.</p>
          </div>
        </div>
        {active.length === 0 ? (
          <p className="m-0 px-4 py-5 text-sm text-neutral-500 sm:px-5">{loading ? "Loading..." : "Nothing is showing. Add a partner or switch one on below."}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 bg-neutral-50/60 px-4 py-5 sm:px-6">
            <span className="text-[11px] font-semibold text-neutral-400">Trusted by</span>
            {active.map((p) => (
              <Logo key={p.id} partner={p} broken={Boolean(p.logoUrl && brokenLogos.has(p.logoUrl))} onBroken={markBroken(p.logoUrl)} className="h-9 w-28" />
            ))}
          </div>
        )}
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">All partners</h2>
            <p className="m-0 text-xs text-neutral-400">Use the arrows to change the order on the homepage.</p>
          </div>
        </div>

        {loading && partners.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading partners
          </div>
        ) : ordered.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Award className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-neutral-900">No trust partners yet</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Add the payment providers and brands you work with to build trust with visitors.</p>
            </div>
            <button type="button" onClick={() => openModal()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white hover:bg-[#12342f]">
              <Plus className="h-3.5 w-3.5" /> Add partner
            </button>
          </div>
        ) : (
          <div>
            {ordered.map((partner, idx) => {
              const busy = busyId === partner.id;
              const broken = Boolean(partner.logoUrl && brokenLogos.has(partner.logoUrl));
              return (
                <article key={partner.id} className={`flex min-w-0 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 ${idx ? "border-0 border-t border-solid border-neutral-200" : ""} ${partner.isActive ? "" : "bg-neutral-50/60"}`}>
                  <span className="flex shrink-0 flex-col items-center gap-0.5">
                    <button type="button" onClick={() => void move(partner, -1)} disabled={idx === 0 || busyId !== null} aria-label={`Move ${partner.name} up`} className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[11px] font-semibold tabular-nums text-neutral-500">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : idx + 1}</span>
                    <button type="button" onClick={() => void move(partner, 1)} disabled={idx === ordered.length - 1 || busyId !== null} aria-label={`Move ${partner.name} down`} className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </span>

                  <Logo partner={partner} broken={broken} onBroken={markBroken(partner.logoUrl)} className={`h-14 w-32 shrink-0 rounded-lg bg-white p-2 ring-1 ring-inset ring-neutral-200 ${partner.isActive ? "" : "opacity-50 grayscale"}`} />

                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-semibold text-neutral-900">{partner.name}</p>
                    <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-400">
                      {partner.href ? (
                        <a href={partner.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-neutral-600 no-underline hover:text-emerald-700">
                          {domainOf(partner.href)} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span>No website link</span>
                      )}
                      {(!partner.logoUrl || broken) && <span className="font-semibold text-amber-700">{partner.logoUrl ? "Logo does not load" : "No logo"}</span>}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void toggleActive(partner)}
                    disabled={busyId !== null}
                    className={`hidden h-8 shrink-0 items-center gap-1.5 rounded-full border-0 px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 sm:inline-flex ${partner.isActive ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
                    title={partner.isActive ? "Hide from the homepage" : "Show on the homepage"}
                  >
                    {partner.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {partner.isActive ? "Showing" : "Hidden"}
                  </button>

                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => openModal(partner)} title="Edit" aria-label={`Edit ${partner.name}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(partner)} title="Delete" aria-label={`Delete ${partner.name}`} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Add / edit dialog */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editingPartner ? "Edit partner" : "Add partner"} onClick={() => !submitting && closeModal()}>
          <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><Award className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-sm font-bold text-neutral-900">{editingPartner ? `Edit ${editingPartner.name}` : "Add partner"}</h2>
                <p className="m-0 text-xs text-neutral-400">{formData.isActive ? "Shows in the Trusted by row once saved." : "Saved but hidden from the homepage."}</p>
              </div>
              <button type="button" onClick={closeModal} disabled={submitting} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
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
                  <span className={sectionLabel}>Partner name</span>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="For example: M-Pesa" className={`${fieldClass} mt-1.5 h-10 font-semibold`} />
                </label>
                <label className="block">
                  <span className={sectionLabel}>Website</span>
                  <input type="url" value={formData.href} onChange={(e) => setFormData({ ...formData, href: e.target.value })} placeholder="https://example.com (optional)" className={`${fieldClass} mt-1.5 h-9`} />
                </label>
              </div>

              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <p className={sectionLabel}>Logo</p>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" onChange={handleFileSelect} className="hidden" />
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex h-20 w-full shrink-0 items-center justify-center rounded-lg bg-neutral-50 p-3 ring-1 ring-inset ring-neutral-200 sm:w-48">
                    {formData.logoUrl ? (
                      <>
                        <Logo partner={{ name: formData.name || "Partner", logoUrl: formData.logoUrl }} broken={brokenLogos.has(formData.logoUrl)} onBroken={markBroken(formData.logoUrl)} className="h-full w-full" />
                        <button type="button" onClick={() => setFormData({ ...formData, logoUrl: "" })} aria-label="Remove logo" className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/60 text-white hover:bg-black/75">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-neutral-400">No logo yet</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
                      {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                      {uploadingLogo ? "Uploading" : formData.logoUrl ? "Replace logo" : "Upload logo"}
                    </button>
                    <input type="url" value={formData.logoUrl} onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })} placeholder="Or paste a logo URL" className={`${fieldClass} h-9`} />
                    <p className="m-0 text-[11px] text-neutral-400">PNG, JPG, GIF or WebP up to 5 MB. A transparent background looks best.</p>
                    {formData.logoUrl && brokenLogos.has(formData.logoUrl) && <p className="m-0 text-[11px] font-medium text-amber-700">This logo address does not load.</p>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-2">
                <label className="block min-w-0 px-5 py-4">
                  <span className={sectionLabel}>Position</span>
                  <input type="number" min={0} value={formData.displayOrder} onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value, 10) || 0 })} className={`${fieldClass} mt-1.5 h-9 tabular-nums`} />
                  <span className="mt-1 block text-[11px] text-neutral-400">Lower numbers show first.</span>
                </label>
                <div className="min-w-0 border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:border-l sm:border-t-0">
                  <p className={sectionLabel}>On the homepage</p>
                  <div className="mt-1.5 inline-flex rounded-lg bg-neutral-100 p-0.5" role="radiogroup" aria-label="Visibility">
                    {([[true, "Showing", Eye], [false, "Hidden", EyeOff]] as const).map(([value, label, Icon]) => (
                      <button key={label} type="button" role="radio" aria-checked={formData.isActive === value} onClick={() => setFormData({ ...formData, isActive: value })} className={`inline-flex h-8 items-center gap-1.5 rounded-md border-0 px-3 text-xs font-semibold ${formData.isActive === value ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-300" : "bg-transparent text-neutral-500 hover:text-neutral-900"}`}>
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={closeModal} disabled={submitting} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={submitting || uploadingLogo || !formData.name.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-50">
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingPartner ? "Save changes" : "Add partner"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm delete" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><Trash2 className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">Delete {deleteTarget.name}?</h2>
                <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">
                  It comes out of the Trusted by row{deleteTarget.isActive ? " straight away" : ""}. To keep it for later, hide it instead. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
