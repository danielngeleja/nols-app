"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FileText, Loader2, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Tags, Trash2, Truck, User, UserPlus, Users, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { PAYMENT_TERM_LABELS, RECEIPT_STATUS, formatDay } from "./shared";

export type Supplier = {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  tin: string | null;
  vrn: string | null;
  location: string | null;
  paymentTerms: string;
  payChannels: Array<{ label: string; value: string }> | null;
  deliveryDays: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  status: string;
  stats: { receipts: number; spend: number; onCredit: number; lastReceivedAt: string | null };
};

export default function SuppliersTab({ propertyId, overview, refreshKey, onChanged }: { propertyId: number; overview: StockOverview; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ canManage: boolean; suppliers: Supplier[] }>(`/api/nrms/stock/property/${propertyId}/suppliers`);
      setRows(res.data.suppliers);
      setCanManage(res.data.canManage);
    } catch (cause) {
      setError(apiError(cause, "Unable to load suppliers"));
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const q = query.trim().toLowerCase();
  const visible = (rows ?? []).filter((row) => !q || row.name.toLowerCase().includes(q) || (row.phone ?? "").includes(q) || (row.contactName ?? "").toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone or contact" className={`${smallFieldClass} w-full pl-9 text-sm`} />
        </div>
        {overview.canReceive && <button type="button" onClick={() => setEditing("new")} className={primaryButton}><UserPlus className="h-4 w-4" />Add supplier</button>}
      </div>
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!rows ? (
        <div className={`${cardClass} flex min-h-[20vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className={cardClass}><EmptyState icon={Users} title={rows.length ? "No supplier matches" : "No suppliers yet"} body="Every delivery gets a name: the beer depot, the butcher, even 'Feri fish market (cash)' for market runs. Their prices are remembered, so a jump is flagged." action={overview.canReceive && !rows.length ? <button type="button" onClick={() => setEditing("new")} className={primaryButton}><UserPlus className="h-4 w-4" />Add the first supplier</button> : undefined} /></div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr>
                  {[["Supplier", "pl-4"], ["Phone", ""], ["Terms", ""], ["Delivers", ""], ["Deliveries", "text-right"], ["Bought", "text-right"], ["On credit", "text-right"], ["Last delivery", ""], ["", "pr-4"]].map(([label, extra]) => (
                    <th key={label || "action"} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((supplier, index) => {
                  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
                  const retired = supplier.status !== "ACTIVE";
                  return (
                    <tr key={supplier.id} onClick={() => setOpenId(supplier.id)} className={`group cursor-pointer ${index % 2 ? "bg-neutral-50/60" : "bg-white"} hover:bg-brand/[0.04] ${retired ? "text-neutral-400" : "text-neutral-800"}`}>
                      <td className={`${cell} pl-4`}>
                        <div className="flex items-center gap-2.5">
                          <Initials name={supplier.name} />
                          <div className="min-w-0">
                            <p className="m-0 max-w-[240px] truncate font-bold text-neutral-900 group-hover:text-brand">{supplier.name}</p>
                            <p className="m-0 mt-0.5 max-w-[240px] truncate text-xs text-neutral-500">{supplier.contactName ?? "No contact person"}{retired ? " · retired" : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`${cell} whitespace-nowrap tabular-nums`}>{supplier.phone ?? <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap`}>{retired ? <Pill tone="muted">Retired</Pill> : <Pill tone={supplier.paymentTerms === "CASH_ON_DELIVERY" ? "ok" : "info"}>{PAYMENT_TERM_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms}</Pill>}</td>
                      <td className={`${cell} max-w-[180px] truncate whitespace-nowrap text-[13px]`} title={supplier.deliveryDays ?? ""}>{supplier.deliveryDays ?? <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} text-right tabular-nums`}>{supplier.stats.receipts || <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap text-right font-bold tabular-nums`}>{supplier.stats.spend ? formatMoney(supplier.stats.spend, overview.currency) : <span className="font-normal text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{supplier.stats.onCredit ? <span className="font-bold text-amber-700">{formatMoney(supplier.stats.onCredit, overview.currency)}</span> : <span className="text-neutral-300">-</span>}</td>
                      <td className={`${cell} whitespace-nowrap text-[13px]`}>{supplier.stats.lastReceivedAt ? formatDay(supplier.stats.lastReceivedAt) : <span className="text-neutral-400">Nothing yet</span>}</td>
                      <td className={`${cell} pr-4 text-right`}>
                        <span className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-700 group-hover:border-brand group-hover:text-brand">Open</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <SupplierModal propertyId={propertyId} supplier={editing === "new" ? null : editing} canManage={canManage} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); onChanged(); }} />}
      {openId != null && <SupplierDetailModal supplierId={openId} summary={rows?.find((row) => row.id === openId) ?? null} currency={overview.currency} onEdit={(supplier) => { setOpenId(null); setEditing(supplier); }} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, warn, muted }: { label: string; value: string; warn?: boolean; muted?: boolean }) {
  return (
    <div className="border-0 border-l border-solid border-neutral-100 px-3 py-2.5 first:border-l-0">
      <p className={`m-0 truncate text-sm font-bold tabular-nums ${warn ? "text-amber-700" : muted ? "text-neutral-400" : "text-neutral-900"}`}>{value}</p>
      <p className="m-0 mt-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
    </div>
  );
}

/** Two-letter badge so a long list of suppliers scans by eye. */
function Initials({ name, large }: { name: string; large?: boolean }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
  return <span className={`flex shrink-0 items-center justify-center rounded-xl bg-brand/10 font-bold text-brand ${large ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm"}`}>{letters}</span>;
}

/** wa.me wants the number in international form without the plus. */
function whatsappLink(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const international = phone.trim().startsWith("+") ? digits : digits.startsWith("0") && digits.length === 10 ? `255${digits.slice(1)}` : digits;
  return `https://wa.me/${international}`;
}

function SupplierModal({ propertyId, supplier, canManage, onClose, onSaved }: { propertyId: number; supplier: Supplier | null; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    contactName: supplier?.contactName ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    tin: supplier?.tin ?? "",
    vrn: supplier?.vrn ?? "",
    location: supplier?.location ?? "",
    paymentTerms: supplier?.paymentTerms ?? "CASH_ON_DELIVERY",
    deliveryDays: supplier?.deliveryDays ?? "",
    leadTimeDays: supplier?.leadTimeDays != null ? String(supplier.leadTimeDays) : "",
    notes: supplier?.notes ?? "",
  });
  const [channels, setChannels] = useState<Array<{ label: string; value: string }>>(supplier?.payChannels ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (status?: "ACTIVE" | "INACTIVE") => {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      contactName: form.contactName.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      tin: form.tin.trim() || null,
      vrn: form.vrn.trim() || null,
      location: form.location.trim() || null,
      paymentTerms: form.paymentTerms,
      deliveryDays: form.deliveryDays.trim() || null,
      leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
      notes: form.notes.trim() || null,
      payChannels: channels.filter((row) => row.label.trim() && row.value.trim()),
      ...(status ? { status } : {}),
    };
    try {
      if (supplier) await apiClient.patch(`/api/nrms/stock/suppliers/${supplier.id}`, body);
      else await apiClient.post(`/api/nrms/stock/property/${propertyId}/suppliers`, body);
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not save the supplier"));
    } finally {
      setBusy(false);
    }
  };

  const readOnly = Boolean(supplier) && !canManage;

  return (
    <ModalFrame
      title={supplier ? supplier.name : "Add supplier"}
      subtitle="Who delivers, how they are paid, when they come"
      icon={<UserPlus className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          {supplier && canManage ? <button type="button" disabled={busy} onClick={() => void save(supplier.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-600 [font-family:inherit] hover:bg-neutral-50">{supplier.status === "ACTIVE" ? "Retire supplier" : "Restore supplier"}</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            {!readOnly && <button type="button" disabled={busy || !form.name.trim()} onClick={() => void save()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>}
          </div>
        </div>
      )}
    >
      {readOnly && <p className="mb-4 mt-0 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">Only the owner or a manager can change a supplier.</p>}
      <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>Name<input value={form.name} onChange={set("name")} placeholder="Kilimanjaro depot, Mama Fatuma fish, Feri market (cash)" className={fieldClass} /></label>
        <label className={labelClass}>Contact person<input value={form.contactName} onChange={set("contactName")} className={fieldClass} /></label>
        <label className={labelClass}>Phone (WhatsApp)<input value={form.phone} onChange={set("phone")} placeholder="+255..." className={fieldClass} /></label>
        <label className={labelClass}>Email<input value={form.email} onChange={set("email")} className={fieldClass} /></label>
        <label className={labelClass}>Location<input value={form.location} onChange={set("location")} placeholder="Area, market or town" className={fieldClass} /></label>
        <label className={labelClass}>TIN<input value={form.tin} onChange={set("tin")} className={fieldClass} /></label>
        <label className={labelClass}>VRN<input value={form.vrn} onChange={set("vrn")} className={fieldClass} /></label>
        <label className={labelClass}>
          Payment terms
          <select value={form.paymentTerms} onChange={set("paymentTerms")} className={fieldClass}>
            {Object.entries(PAYMENT_TERM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>Delivery days<input value={form.deliveryDays} onChange={set("deliveryDays")} placeholder="Fish: Tuesday and Friday" className={fieldClass} /></label>
        <div className="sm:col-span-2">
          <p className={`${labelClass} m-0`}>How they get paid</p>
          <div className="mt-1.5 space-y-2">
            {channels.map((row, index) => (
              <div key={index} className="flex gap-2">
                <input value={row.label} onChange={(event) => setChannels((rows) => rows.map((item, i) => (i === index ? { ...item, label: event.target.value.slice(0, 60) } : item)))} placeholder="Lipa Namba, CRDB account" className={`${smallFieldClass} w-44`} />
                <input value={row.value} onChange={(event) => setChannels((rows) => rows.map((item, i) => (i === index ? { ...item, value: event.target.value.slice(0, 120) } : item)))} placeholder="Number or account" className={`${smallFieldClass} min-w-0 flex-1`} />
                <button type="button" aria-label="Remove" onClick={() => setChannels((rows) => rows.filter((_, i) => i !== index))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {channels.length < 6 && <button type="button" onClick={() => setChannels((rows) => [...rows, { label: "", value: "" }])} className={quietButton}><Plus className="h-3.5 w-3.5" />Add a payment channel</button>}
          </div>
        </div>
        <label className={`${labelClass} sm:col-span-2`}>Notes<input value={form.notes} onChange={set("notes")} className={fieldClass} /></label>
      </fieldset>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

type SupplierDetail = {
  supplier: Supplier;
  canManage: boolean;
  prices: Array<{ stockItemId: number; stockItemName: string; baseUnit: string; lastUnitCost: number | null; agreedUnitCost: number | null; lastReceivedAt: string | null }>;
  receipts: Array<{ id: number; receiptNumber: string; status: string; paymentMode: string; totalCost: number; receivedAt: string; locationName: string; lineCount: number; flaggedLines: number }>;
};

function InfoItem({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
        <div className="m-0 mt-0.5 text-sm text-neutral-800">{children}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Phone; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-brand" />
      <p className="m-0 text-sm font-bold text-neutral-900">{title}</p>
      {hint && <span className="text-xs text-neutral-400">{hint}</span>}
    </div>
  );
}

function EmptyBox({ icon: Icon, text }: { icon: typeof Phone; text: string }) {
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-4 py-4">
      <Icon className="h-5 w-5 shrink-0 text-neutral-300" />
      <p className="m-0 text-sm text-neutral-500">{text}</p>
    </div>
  );
}

function SupplierDetailModal({ supplierId, summary, currency, onEdit, onClose }: { supplierId: number; summary: Supplier | null; currency: string; onEdit: (supplier: Supplier) => void; onClose: () => void }) {
  const [data, setData] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<SupplierDetail>(`/api/nrms/stock/suppliers/${supplierId}`);
      setData(res.data);
      setDrafts({});
    } catch (cause) {
      setError(apiError(cause, "Unable to load the supplier"));
    }
  }, [supplierId]);
  useEffect(() => { void load(); }, [load]);

  const saveAgreed = async (stockItemId: number) => {
    const raw = drafts[stockItemId];
    if (raw === undefined) return;
    setSavingId(stockItemId);
    try {
      await apiClient.put(`/api/nrms/stock/suppliers/${supplierId}/prices/${stockItemId}`, { agreedUnitCost: raw.trim() ? Number(raw) : null });
      await load();
    } catch (cause) {
      setError(apiError(cause, "Could not save the agreed price"));
    } finally {
      setSavingId(null);
    }
  };

  const supplier = data?.supplier;
  return (
    <ModalFrame title="Supplier" subtitle="Contact, how they are paid, prices and deliveries" icon={<Users className="h-5 w-5" />} onClose={onClose} extraWide>
      {!data || !supplier ? (
        <div className="flex min-h-[20vh] items-center justify-center text-neutral-300">{error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-neutral-200 bg-neutral-50/60 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <Initials name={supplier.name} large />
              <div className="min-w-0">
                <p className="m-0 truncate text-lg font-bold text-neutral-950">{supplier.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {supplier.status !== "ACTIVE" ? <Pill tone="muted">Retired</Pill> : <Pill tone={supplier.paymentTerms === "CASH_ON_DELIVERY" ? "ok" : "info"}>{PAYMENT_TERM_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms}</Pill>}
                  {supplier.leadTimeDays != null && <span className="text-xs text-neutral-500">Delivers {supplier.leadTimeDays === 0 ? "the same day" : `${supplier.leadTimeDays} ${supplier.leadTimeDays === 1 ? "day" : "days"} after ordering`}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {supplier.phone && <a href={`tel:${supplier.phone}`} className={`${quietButton} h-9 no-underline`}><Phone className="h-3.5 w-3.5" />Call</a>}
              {supplier.phone && <a href={whatsappLink(supplier.phone)} target="_blank" rel="noreferrer" className={`${quietButton} h-9 no-underline`}><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
              {data.canManage && <Link href={`/owner/nrms/stock/payables/${supplier.id}`} className={`${quietButton} h-9 no-underline`}><Wallet className="h-3.5 w-3.5" />Statement</Link>}
              <button type="button" onClick={() => onEdit(supplier)} className={`${quietButton} h-9`}><Pencil className="h-3.5 w-3.5" />Edit</button>
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-solid border-neutral-200 sm:grid-cols-4">
              <Stat label="Deliveries" value={summary.stats.receipts ? String(summary.stats.receipts) : "None"} muted={!summary.stats.receipts} />
              <Stat label="Bought" value={summary.stats.spend ? formatMoney(summary.stats.spend, currency) : "-"} muted={!summary.stats.spend} />
              <Stat label="On credit" value={summary.stats.onCredit ? formatMoney(summary.stats.onCredit, currency) : "-"} warn={summary.stats.onCredit > 0} muted={!summary.stats.onCredit} />
              <Stat label="Last delivery" value={summary.stats.lastReceivedAt ? formatDay(summary.stats.lastReceivedAt) : "-"} muted={!summary.stats.lastReceivedAt} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem icon={User} label="Contact person">{supplier.contactName ?? <span className="text-neutral-400">Not set</span>}</InfoItem>
            <InfoItem icon={Phone} label="Phone">{supplier.phone ? <a href={`tel:${supplier.phone}`} className="tabular-nums text-brand no-underline hover:underline">{supplier.phone}</a> : <span className="text-neutral-400">Not set</span>}</InfoItem>
            <InfoItem icon={Mail} label="Email">{supplier.email ? <a href={`mailto:${supplier.email}`} className="break-all text-brand no-underline hover:underline">{supplier.email}</a> : <span className="text-neutral-400">Not set</span>}</InfoItem>
            <InfoItem icon={MapPin} label="Location">{supplier.location ?? <span className="text-neutral-400">Not set</span>}</InfoItem>
            <InfoItem icon={Truck} label="Delivery days">{supplier.deliveryDays ?? <span className="text-neutral-400">Not set</span>}</InfoItem>
            <InfoItem icon={FileText} label="Tax numbers">{supplier.tin || supplier.vrn ? <span className="tabular-nums">{supplier.tin ? `TIN ${supplier.tin}` : ""}{supplier.tin && supplier.vrn ? " · " : ""}{supplier.vrn ? `VRN ${supplier.vrn}` : ""}</span> : <span className="text-neutral-400">Not set</span>}</InfoItem>
          </div>

          <div>
            <SectionTitle icon={Wallet} title="How they get paid" />
            {(supplier.payChannels ?? []).length === 0 ? (
              <EmptyBox icon={Wallet} text="No Lipa Namba, mobile money or bank account saved. Add one with Edit so payments go to the right place." />
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {(supplier.payChannels ?? []).map((row) => (
                  <span key={`${row.label}-${row.value}`} className="inline-flex items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-sm">
                    <span className="font-bold text-neutral-800">{row.label}</span><span className="tabular-nums text-neutral-600">{row.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {supplier.notes && <p className="m-0 rounded-lg bg-amber-50/70 px-3 py-2 text-sm text-amber-900">{supplier.notes}</p>}

          <div>
            <SectionTitle icon={Tags} title="Price list" hint="Last price paid and the price you agreed, per unit" />
            {data.prices.length === 0 ? (
              <EmptyBox icon={Tags} text="Prices fill in by themselves from the first delivery. Once they appear you can set an agreed price, and anything above it is flagged." />
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-solid border-neutral-200">
                <table className="w-full min-w-[620px] border-collapse text-left">
                  <thead>
                    <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                      <th className="px-3 py-2">Good</th>
                      <th className="px-2 py-2 text-right">Last paid</th>
                      <th className="px-2 py-2">Agreed price</th>
                      <th className="px-3 py-2 text-right">Last delivery</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.prices.map((row) => (
                      <tr key={row.stockItemId} className="border-0 border-t border-solid border-neutral-100">
                        <td className="px-3 py-2 text-sm font-bold text-neutral-900">{row.stockItemName}</td>
                        <td className="px-2 py-2 text-right text-sm tabular-nums">{row.lastUnitCost != null ? `${formatUnitCost(row.lastUnitCost, currency)}/${unitShort(row.baseUnit)}` : "-"}</td>
                        <td className="px-2 py-2">
                          {data.canManage ? (
                            <div className="flex items-center gap-1.5">
                              <input inputMode="decimal" value={drafts[row.stockItemId] ?? (row.agreedUnitCost != null ? String(row.agreedUnitCost) : "")} onChange={(event) => setDrafts((current) => ({ ...current, [row.stockItemId]: event.target.value.replace(/[^\d.]/g, "") }))} onBlur={() => void saveAgreed(row.stockItemId)} placeholder="Not agreed" className={`${smallFieldClass} h-8 w-28 text-sm tabular-nums`} />
                              <span className="text-xs text-neutral-500">per {unitShort(row.baseUnit)}</span>
                              {savingId === row.stockItemId && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                            </div>
                          ) : (
                            <span className="text-sm">{row.agreedUnitCost != null ? formatUnitCost(row.agreedUnitCost, currency) : "-"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-sm text-neutral-600">{formatDay(row.lastReceivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <SectionTitle icon={Truck} title="Recent deliveries" hint={data.receipts.length ? `Last ${data.receipts.length}` : undefined} />
            {data.receipts.length === 0 ? (
              <EmptyBox icon={Truck} text="Nothing received from this supplier yet. Deliveries recorded under New delivery or against an order show here." />
            ) : (
              <ul className="m-0 mt-2 list-none divide-y divide-neutral-100 rounded-xl border border-solid border-neutral-200 p-0">
                {data.receipts.map((row) => {
                  const state = RECEIPT_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
                  return (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <span className="text-sm"><strong>{row.receiptNumber}</strong> <span className="text-neutral-500">· {formatDay(row.receivedAt)} · {row.locationName} · {row.lineCount} goods</span></span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-bold tabular-nums">{formatMoney(row.totalCost, currency)}</span>
                        {row.paymentMode === "CREDIT" && <Pill tone="info">Credit</Pill>}
                        {row.flaggedLines > 0 && <Pill tone="low">Price jump</Pill>}
                        <Pill tone={state.tone}>{state.label}</Pill>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {error && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </ModalFrame>
  );
}
