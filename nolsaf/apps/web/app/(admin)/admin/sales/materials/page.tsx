"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, Eye, EyeOff, FilePlus2, Layers3, Link2, Loader2, Pencil, RefreshCw, Save, Users, Wallet } from "lucide-react";
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

const categories = ["PRODUCT_GUIDE", "SALES_SCRIPT", "PRESENTATION", "CASE_STUDY", "POLICY", "TRAINING", "FAQ"] as const;
const empty = { title: "", description: "", category: "PRODUCT_GUIDE", url: "", isPublished: false, sortOrder: 0 };
const fieldClass = "min-h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 shadow-sm no-underline transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";

function SummaryCard({ icon: Icon, label, value, detail, tone }: {
  icon: typeof BookOpen;
  label: string;
  value: number;
  detail: string;
  tone: "emerald" | "amber" | "blue" | "slate";
}) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-sky-100 bg-sky-50 text-sky-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p><p className="mb-0 mt-1 text-2xl font-black text-neutral-950">{value}</p></div>
        <span className={`grid h-9 w-9 place-items-center rounded-xl border ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-neutral-500">{detail}</p>
    </div>
  );
}

export default function AdminSalesMaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stats = useMemo(() => ({
    total: materials.length,
    published: materials.filter((item) => item.isPublished).length,
    drafts: materials.filter((item) => !item.isPublished).length,
    categories: new Set(materials.map((item) => item.category)).size,
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

  const reset = () => {
    setForm(empty);
    setEditingId(null);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (form.title.trim().length < 2 || !form.url.startsWith("https://")) {
      setError("Enter a title and an HTTPS resource URL.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category,
      externalUrl: form.url.trim(),
      fileUrl: null,
      isPublished: form.isPublished,
      sortOrder: Number(form.sortOrder),
    };
    try {
      if (editingId) await apiClient.patch(`/api/admin/sales/materials/${editingId}`, payload);
      else await apiClient.post("/api/admin/sales/materials", payload);
      setNotice(editingId ? "Material updated." : "Material created.");
      reset();
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save this material.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="admin-sales-materials" className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:py-6">
      <style>{`#admin-sales-materials, #admin-sales-materials * { box-sizing: border-box; }`}</style>
      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">LEARN</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><BookOpen className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Sales administration</p>
                <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 shadow-sm">Partner enablement</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Sales learning materials</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">Draft, order and publish resources. Only published materials reach the partner workspace.</p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <Link href="/admin/sales" className={actionClass}><ArrowLeft className="h-4 w-4" /> Review</Link>
            <Link href="/admin/sales/partners" className={actionClass}><Users className="h-4 w-4" /> Partners</Link>
            <Link href="/admin/sales/finance" className={actionClass}><Wallet className="h-4 w-4" /> Finance</Link>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${actionClass} h-10 w-10 shrink-0 px-0`} aria-label="Refresh sales learning materials" title="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={BookOpen} label="All materials" value={stats.total} detail="Complete resource library" tone="blue" />
        <SummaryCard icon={Eye} label="Published" value={stats.published} detail="Visible to sales partners" tone="emerald" />
        <SummaryCard icon={EyeOff} label="Drafts" value={stats.drafts} detail="Still hidden from partners" tone="amber" />
        <SummaryCard icon={Layers3} label="Categories" value={stats.categories} detail="Topics currently represented" tone="slate" />
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><FilePlus2 className="h-4 w-4" /></span>
          <div><h2 className="m-0 text-sm font-bold text-neutral-900">{editingId ? `Edit material #${editingId}` : "Create learning material"}</h2><p className="mb-0 mt-0.5 text-xs text-neutral-500">Add a secure partner resource and choose when it becomes visible.</p></div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-[11px] font-bold text-neutral-600">Material title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${fieldClass} mt-1.5`} placeholder="For example: NRMS product guide" /></label>
          <label className="text-[11px] font-bold text-neutral-600">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={`${fieldClass} mt-1.5`}>
            {categories.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
          </select></label>
          <label className="text-[11px] font-bold text-neutral-600">Secure resource URL<div className="relative mt-1.5"><Link2 className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" /><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} className={`${fieldClass} pl-9`} placeholder="https://example.com/resource" /></div></label>
          <label className="text-[11px] font-bold text-neutral-600">Display order<input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} className={`${fieldClass} mt-1.5`} placeholder="0" /></label>
          <label className="text-[11px] font-bold text-neutral-600 md:col-span-2">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${fieldClass} mt-1.5 min-h-24 py-2`} placeholder="Explain what this resource helps the partner accomplish." /></label>
          <label className="flex min-h-10 items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm font-semibold text-neutral-700"><input type="checkbox" checked={form.isPublished} onChange={(event) => setForm({ ...form, isPublished: event.target.checked })} className="h-4 w-4 accent-emerald-700" /><span><b className="block text-xs">Publish to partners</b><span className="text-[10px] font-normal text-neutral-500">Leave unchecked to keep this resource as a draft.</span></span></label>
          <div className="flex items-center justify-end gap-2">
            {editingId && <button type="button" onClick={reset} className={actionClass}>Cancel</button>}
            <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-emerald-700" /><div><h2 className="m-0 text-sm font-bold text-neutral-900">Resource library</h2><p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Ordered materials available to the partner programme.</p></div></div>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[10px] font-bold text-neutral-600">{materials.length} items</span>
        </div>
        {loading ? <div className="grid min-h-56 place-items-center text-neutral-400"><div className="text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="mb-0 mt-2 text-xs">Loading library</p></div></div> : materials.length === 0 ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-neutral-100 text-neutral-500"><BookOpen className="h-5 w-5" /></span><p className="mb-0 mt-3 text-sm font-bold text-neutral-800">No learning materials yet</p><p className="mb-0 mt-1 text-xs text-neutral-500">Create the first resource using the editor above.</p></div></div> : (
          <div className="divide-y divide-neutral-100">
            {materials.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 p-4 transition hover:bg-emerald-50/30 sm:flex-row sm:items-center">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${item.isPublished ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{item.isPublished ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-sm font-bold text-neutral-900">{item.title}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${item.isPublished ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-100 text-neutral-600"}`}>{item.isPublished ? "PUBLISHED" : "DRAFT"}</span>
                  </div>
                  {item.description && <p className="mb-0 mt-1 line-clamp-1 text-xs text-neutral-500">{item.description}</p>}
                  <p className="mb-0 mt-1 text-[11px] text-neutral-400">{item.category.replaceAll("_", " ")} / order {item.sortOrder} / updated {new Date(item.updatedAt).toLocaleDateString()}</p>
                </div>
                <button type="button" onClick={() => edit(item)} className={actionClass}><Pencil className="h-4 w-4" />Edit</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
