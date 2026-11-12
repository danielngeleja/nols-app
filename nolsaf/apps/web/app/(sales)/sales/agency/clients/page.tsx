"use client";

// Agency Desk client book: organisers and institutions this partner serves.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Handshake, Loader2, Plus, Search, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import AgencyTabs from "@/components/sales/AgencyTabs";
import InfoTip from "@/components/sales/InfoTip";

type Client = {
  reference: string;
  type: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  notes: string | null;
  status: string;
  protectedUntil: string | null;
  protectionActive: boolean;
  possibleDuplicate: boolean;
};
type Detail = {
  client: Client;
  activities: Array<{ type: string; description: string; createdAt: string }>;
  groups: Array<{ reference: string; status: string; createdAt: string; destination: string | null; headcount: number | null }>;
};

const TYPES = ["ORGANISER", "SCHOOL", "CHURCH", "NGO", "COMPANY", "BANK", "GOVERNMENT", "EVENT", "OTHER"];
const ACTIVITY = ["NOTE", "CALL", "MEETING", "EMAIL", "FOLLOW_UP"];
const card = "min-w-0 rounded-lg border border-solid border-slate-300 bg-white";
const input = "mt-1.5 block min-h-10 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const field = "block min-w-0 text-xs font-medium text-slate-600";
const inline = input.replace("mt-1.5 ", "");
const primary = "inline-flex min-h-10 items-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-");
const SOON_MS = 30 * 24 * 60 * 60 * 1000;

/** Protection state, so a partner sees which clients need a contact logged before they lapse. */
function protection(c: Client): { label: string; tone: string; ok: boolean } {
  if (!c.protectionActive || !c.protectedUntil) return { label: "Lapsed", tone: "bg-rose-50 text-rose-800", ok: false };
  const left = new Date(c.protectedUntil).getTime() - Date.now();
  if (left < SOON_MS) return { label: `Ends ${day(c.protectedUntil)}`, tone: "bg-amber-50 text-amber-800", ok: false };
  return { label: `Until ${day(c.protectedUntil)}`, tone: "bg-emerald-50 text-emerald-800", ok: true };
}
const blank = { type: "ORGANISER", name: "", contactName: "", phone: "", email: "", region: "", notes: "" };

export default function AgencyClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<Detail | null>(null);
  const [activity, setActivity] = useState({ type: "CALL", description: "" });
  const [opening, setOpening] = useState("");
  const [query, setQuery] = useState("");
  const detailRef = useRef<HTMLElement | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => [c.name, c.contactName, c.phone, c.region].some((v) => (v || "").toLowerCase().includes(q)));
  }, [clients, query]);
  const needContact = useMemo(() => clients.filter((c) => c.status !== "ARCHIVED" && !protection(c).ok).length, [clients]);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/sales/agency/clients");
      setClients(res.data?.items || []);
    } catch (cause: any) {
      if (cause?.response?.status === 404 || cause?.response?.status === 403) setUnavailable(true);
      else setError(cause?.response?.data?.error || "Could not load your clients.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openClient = async (reference: string, scroll = true) => {
    setError("");
    setOpening(reference);
    try {
      const res = await apiClient.get(`/api/sales/agency/clients/${encodeURIComponent(reference)}`);
      setOpen(res.data);
      if (res.data?.client) setClients((prev) => prev.map((c) => (c.reference === reference ? { ...c, ...res.data.client } : c)));
      if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not open this client.");
    } finally {
      setOpening("");
    }
  };

  const add = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, string> = { type: form.type, name: form.name.trim() };
      for (const k of ["contactName", "phone", "email", "region", "notes"] as const) if (form[k].trim()) body[k] = form[k].trim();
      const res = await apiClient.post("/api/sales/agency/clients", body);
      setClients((prev) => [res.data.client, ...prev]);
      setForm(blank);
      setAdding(false);
      setNotice(res.data.warning || "Client added. It is yours for 12 months, renewed each time you log contact.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not add the client.");
    } finally {
      setBusy(false);
    }
  };

  const logActivity = async () => {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/agency/clients/${encodeURIComponent(open.client.reference)}/activities`, activity);
      setActivity({ type: "CALL", description: "" });
      await openClient(open.client.reference, false);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SalesShell>
      <div className="min-w-0 space-y-4">
        <SalesPageHeader
          icon={Handshake}
          title="Clients"
          description="Organisers and institutions you serve, protected for you while you stay in touch."
          actions={!unavailable ? <button type="button" className={primary} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{adding ? "Close form" : "Add client"}</button> : null}
        />
        {!unavailable ? <AgencyTabs /> : null}
        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

        {unavailable ? (
          <article className={`${card} p-5 text-sm text-slate-600`}>The Agency Desk is not available on your account.</article>
        ) : (
          <>
            {adding ? (
              <article className={`${card} overflow-hidden`}>
                <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
                  <div className="grid min-w-0 gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
                    <label className={field}>Type
                      <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={input}>
                        {TYPES.map((t) => <option key={t} value={t}>{codeLabel(t)}</option>)}
                      </select>
                    </label>
                    <label className={`${field} lg:col-span-2`}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="St. Mary's Secondary School, Moshi" className={input} /></label>
                    <label className={field}>Contact person<input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={input} /></label>
                    <label className={field}>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="0712 345 678" className={input} /></label>
                    <label className={field}>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} inputMode="email" className={input} /></label>
                    <label className={field}>Region<input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className={input} /></label>
                    <label className={`${field} lg:col-span-2`}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={input} /></label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-300 bg-slate-50 px-4 py-3">
                    <button type="submit" className={primary} disabled={busy || form.name.trim().length < 2}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save client</button>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      Protected for you for 12 months
                      <InfoTip label="Client protection">While a client is protected, no other partner can add a client with the same phone or email. A similar name goes to NoLSAF for review. Each call, meeting or note you log renews the 12 months.</InfoTip>
                    </span>
                  </div>
                </form>
              </article>
            ) : null}

            <article className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3">
                <label className="relative block w-full min-w-0 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, contact, phone or region" aria-label="Search clients"
                    className="block h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                </label>
                {needContact ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-solid border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">{needContact} need{needContact === 1 ? "s" : ""} a contact logged</span>
                    <InfoTip label="Staying protected">Log a call, meeting, email or note on the client. Lapsed clients can be added by another partner.</InfoTip>
                  </span>
                ) : null}
              </div>

              {loading ? (
                <div className="grid h-24 place-items-center text-[#02665e]"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : !shown.length ? (
                <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">{clients.length ? "No client matches that search." : "No clients yet. Add the organisers and institutions you work with."}</p>
              ) : (
                <>
                  {/* Phones: one row per client */}
                  <ul className="m-0 list-none p-0 md:hidden">
                    {shown.map((c) => {
                      const p = protection(c);
                      const isOpen = open?.client.reference === c.reference;
                      return (
                        <li key={c.reference} className="border-0 border-t border-solid border-slate-200 first:border-t-0">
                          <button type="button" onClick={() => void openClient(c.reference)} aria-expanded={isOpen}
                            className={`block w-full border-0 px-4 py-3 text-left ${isOpen ? "bg-[#02665e]/[0.05]" : "bg-white hover:bg-slate-50"}`}>
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                                {c.name}
                                {opening === c.reference ? <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin text-[#02665e]" /> : null}
                              </span>
                              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${p.tone}`}>{p.label}</span>
                            </span>
                            <span className="mt-1 block text-xs text-slate-500 [overflow-wrap:anywhere]">
                              {[codeLabel(c.type), c.contactName, c.phone, c.region].filter(Boolean).join(" · ")}
                            </span>
                            <Flags c={c} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Wider screens: table, fixed columns */}
                  <table className="hidden w-full table-fixed border-collapse text-left text-sm md:table">
                    <colgroup><col className="w-[30%]" /><col className="w-[13%]" /><col className="w-[25%]" /><col className="w-[14%]" /><col /></colgroup>
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Client</th>
                        <th className="px-3 py-2.5 font-medium">Type</th>
                        <th className="px-3 py-2.5 font-medium">Contact</th>
                        <th className="px-3 py-2.5 font-medium">Region</th>
                        <th className="px-4 py-2.5 font-medium"><span className="inline-flex items-center gap-1">Protection<InfoTip label="Client protection">12 months from the last contact you logged. Amber means it ends within 30 days; red means it has lapsed.</InfoTip></span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((c) => {
                        const p = protection(c);
                        const isOpen = open?.client.reference === c.reference;
                        const contact = [c.contactName, c.phone].filter(Boolean).join(" · ") || c.email || "-";
                        return (
                          <tr key={c.reference} className={`border-0 border-t border-solid border-slate-200 ${isOpen ? "bg-[#02665e]/[0.05]" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-3 align-top">
                              <button type="button" onClick={() => void openClient(c.reference)} aria-expanded={isOpen} title={c.name}
                                className="inline-flex max-w-full items-center gap-1.5 border-0 bg-transparent p-0 text-left text-sm font-medium text-slate-900 hover:text-[#02665e] hover:underline">
                                <span className="min-w-0 truncate">{c.name}</span>
                                {opening === c.reference ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#02665e]" /> : null}
                              </button>
                              <Flags c={c} />
                            </td>
                            <td className="truncate px-3 py-3 align-top text-slate-600">{codeLabel(c.type)}</td>
                            <td className="truncate px-3 py-3 align-top text-slate-600" title={contact}>{contact}</td>
                            <td className="truncate px-3 py-3 align-top text-slate-600">{c.region || "-"}</td>
                            <td className="px-4 py-3 align-top"><span className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs font-semibold ${p.tone}`}>{p.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </article>

            {open ? (
              <article ref={detailRef} className={`${card} scroll-mt-4 overflow-hidden`}>
                <div className="flex flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-slate-200 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="m-0 text-base font-bold text-slate-900 [overflow-wrap:anywhere]">{open.client.name}</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">{codeLabel(open.client.type)} · protected until {day(open.client.protectedUntil)}</p>
                  </div>
                  <button type="button" onClick={() => setOpen(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"><X className="h-4 w-4" />Close</button>
                </div>
                <form className="grid min-w-0 gap-2 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:px-5" onSubmit={(e) => { e.preventDefault(); void logActivity(); }}>
                  <select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })} aria-label="Contact type" className={inline}>
                    {ACTIVITY.map((t) => <option key={t} value={t}>{codeLabel(t)}</option>)}
                  </select>
                  <input value={activity.description} onChange={(e) => setActivity({ ...activity, description: e.target.value })} aria-label="What happened" placeholder="What happened, and what is next" className={inline} />
                  <button type="submit" className={`${primary} justify-center`} disabled={busy || activity.description.trim().length < 2}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Log contact</button>
                </form>
                <div className="grid min-w-0 gap-px bg-slate-200 lg:grid-cols-2">
                  <section className="min-w-0 bg-white px-4 py-4 sm:px-5">
                    <h3 className="m-0 text-xs font-semibold text-slate-500">Timeline</h3>
                    <ol className="m-0 mt-2 list-none space-y-2 p-0">
                      {open.activities.length ? open.activities.map((a, i) => (
                        <li key={i} className="rounded-md border border-solid border-slate-200 px-3 py-2 text-sm">
                          <span className="text-xs font-semibold text-slate-500">{codeLabel(a.type)} · {day(a.createdAt)}</span>
                          <p className="m-0 mt-0.5 text-slate-700 [overflow-wrap:anywhere]">{a.description}</p>
                        </li>
                      )) : <li className="text-sm text-slate-500">Nothing logged yet.</li>}
                    </ol>
                  </section>
                  <section className="min-w-0 bg-white px-4 py-4 sm:px-5">
                    <h3 className="m-0 text-xs font-semibold text-slate-500">Group stays</h3>
                    <ul className="m-0 mt-2 list-none space-y-2 p-0">
                      {open.groups.length ? open.groups.map((g) => (
                        <li key={g.reference}>
                          <Link href={`/sales/agency/groups/${g.reference}`} className="flex items-center justify-between gap-2 rounded-md border border-solid border-slate-200 px-3 py-2 text-sm text-slate-700 no-underline hover:border-[#02665e]/50 hover:bg-slate-50">
                            <span className="min-w-0 [overflow-wrap:anywhere]">{g.destination || "Group stay"}{g.headcount ? ` · ${g.headcount} people` : ""}</span>
                            <span className="shrink-0 text-xs font-semibold text-slate-500">{codeLabel(g.status)}</span>
                          </Link>
                        </li>
                      )) : <li className="text-sm text-slate-500">No group stays yet.</li>}
                    </ul>
                  </section>
                </div>
              </article>
            ) : null}
          </>
        )}
      </div>
    </SalesShell>
  );
}

function Flags({ c }: { c: Client }) {
  if (c.status !== "ARCHIVED" && !c.possibleDuplicate) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {c.status === "ARCHIVED" ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Archived</span> : null}
      {c.possibleDuplicate ? <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">Under review</span> : null}
    </span>
  );
}
