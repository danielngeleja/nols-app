"use client";

/**
 * Long-stay tenant ID checks (docs/LONG_STAY_RENTALS.md, decision 10).
 * Passports (ICAO 9303), national ID cards and residence permits. The
 * reviewer opens every photo through a short signed link (audited), confirms
 * the name and the face by eye, then approves or rejects with a reason. The
 * server refuses an approval until this admin has opened every photo.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminNotificationTarget from "@/components/longStay/AdminNotificationTarget";
import {
  AlertTriangle, BadgeCheck, Ban, CalendarClock, CheckCircle2, Circle, Clock3, ExternalLink, IdCard, Loader2,
  Phone, Search, ShieldCheck, ShieldX, UserRound, XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import { countryName, idDocumentLabel, useIsoCountries } from "@/lib/isoCountries";

type Status = "PENDING" | "APPROVED" | "EXPIRING" | "REJECTED" | "BARRED";
type Side = "front" | "back" | "selfie";
type Item = {
  id: number;
  status: Exclude<Status, "EXPIRING">;
  idType: "PASSPORT" | "NATIONAL_ID" | "RES_PERMIT";
  idCountry: string | null;
  nationality: string | null;
  idNumberLast4: string;
  holderName: string | null;
  dateOfBirth: string | null;
  age: number | null;
  idExpiresOn: string | null;
  expiring: boolean;
  submittedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  barReason: string | null;
  photos: Record<Side, boolean>;
  sameIdOnOtherAccounts: number;
  nameAgreement: "MATCH" | "PARTIAL" | "DIFFERENT" | "UNKNOWN";
  tenant: { name: string | null; email: string | null; phone: string | null; phoneVerified: boolean; memberSince: string };
};
type ListResponse = { items: Item[]; counts: Record<Status, number>; oldestPendingAt: string | null; today: string };

const TABS: Array<{ key: Status; label: string; Icon: typeof Clock3 }> = [
  { key: "PENDING", label: "To check", Icon: Clock3 },
  { key: "APPROVED", label: "Verified", Icon: BadgeCheck },
  { key: "EXPIRING", label: "Expiring", Icon: CalendarClock },
  { key: "REJECTED", label: "Rejected", Icon: XCircle },
  { key: "BARRED", label: "Barred", Icon: Ban },
];
const SIDE_LABEL: Record<Side, string> = { front: "Front", back: "Back", selfie: "Selfie with ID" };
const REJECT_REASONS = [
  "The photo is blurred or cut off. Take it again in good light.",
  "The name on the document does not match your account.",
  "The selfie does not clearly show your face and the document.",
  "The details typed do not match the document.",
];

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}
function day(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}
function waited(since: string | null) {
  if (!since) return "None";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}
function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
function initials(name: string | null) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function LongStayTenantIdsPage() {
  const target = useSearchParams()?.get("id");
  return <TenantIdQueue key={target ?? ""} target={target} />;
}

function TenantIdQueue({ target }: { target: string | null | undefined }) {
  const [tab, setTab] = useState<Status>("PENDING");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [idType, setIdType] = useState("");
  const [country, setCountry] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const countries = useIsoCountries();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: tab });
      if (target) params.set("id", target);
      if (query) params.set("q", query);
      if (idType) params.set("idType", idType);
      if (country) params.set("country", country);
      const response = await apiClient.get<ListResponse>(`/api/admin/long-stay/tenants?${params.toString()}`);
      setData(response.data);
      setSelected((current) => (response.data.items.some((i) => i.id === current) ? current : response.data.items[0]?.id ?? null));
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load the list.");
      setData((current) => (current ? { ...current, items: [] } : null));
    } finally {
      setLoading(false);
    }
  }, [tab, query, idType, country, target]);

  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;
  const items = data?.items ?? [];
  const current = items.find((i) => i.id === selected) ?? null;

  return (
    <div id="tenant-ids" className="w-full">
      <style>{`#tenant-ids, #tenant-ids * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<Status>
        kicker="Long stays"
        title="Tenant IDs"
        description="Every long-stay tenant is checked once, to ICAO 9303 and ISO 3166 rules. NoLSAF keeps the last 4 characters of the number, never the whole number."
        metrics={[
          { label: "To check", value: counts?.PENDING ?? "-", tone: counts?.PENDING ? "warn" : "default" },
          { label: "Oldest waiting", value: waited(data?.oldestPendingAt ?? null), tone: "muted" },
          { label: "Verified", value: counts?.APPROVED ?? "-", tone: "good" },
          { label: "Expire in 60 days", value: counts?.EXPIRING ?? "-", tone: counts?.EXPIRING ? "warn" : "muted" },
          { label: "Barred", value: counts?.BARRED ?? "-", tone: "muted" },
        ]}
        onRefresh={load}
        loading={loading}
        tabs={target ? undefined : TABS.map((t) => ({ ...t, count: counts?.[t.key] }))}
        activeTab={tab}
        onTab={(key) => { setTab(key); setSelected(null); }}
      />

      {target ? <AdminNotificationTarget href="/admin/long-stay/tenants">Tenant ID from Notifications</AdminNotificationTarget> : <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative flex h-9 min-w-[200px] flex-1 items-center sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email or last 4" aria-label="Search"
            className="h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-8 pr-2.5 text-sm outline-none focus:border-[#02665e]" />
        </label>
        <select value={idType} onChange={(e) => setIdType(e.target.value)} aria-label="Document"
          className="h-9 rounded-md border border-solid border-slate-300 bg-white px-2 text-sm outline-none focus:border-[#02665e]">
          <option value="">All documents</option>
          <option value="PASSPORT">Passport</option>
          <option value="NATIONAL_ID">National ID</option>
          <option value="RES_PERMIT">Residence permit</option>
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Issuing country"
          className="h-9 max-w-[200px] rounded-md border border-solid border-slate-300 bg-white px-2 text-sm outline-none focus:border-[#02665e]">
          <option value="">Any issuing country</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
      </div>}

      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-label="Queue">
          <p className="m-0 border-0 border-b border-solid border-slate-100 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {target ? "Tenant ID" : tab === "PENDING" ? "Oldest first" : tab === "EXPIRING" ? "Soonest expiry first" : "Newest first"}
          </p>
          {data === null ? (
            <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-slate-300" />
              <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{target ? "Tenant ID unavailable" : tab === "PENDING" && !query && !idType && !country ? "All caught up" : "No IDs match"}</p>
              {!target && <p className="m-0 mt-0.5 text-[13px] text-slate-500">{tab === "PENDING" && !query && !idType && !country ? "New IDs show here as tenants send them." : "Try another search or filter."}</p>}
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((item) => {
                const on = item.id === selected;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => setSelected(item.id)} aria-current={on}
                      className={`grid w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-t border-solid border-slate-100 px-3.5 py-2.5 text-left [font-family:inherit] first:border-t-0 ${on ? "bg-[#02665e]/[0.06]" : "bg-white hover:bg-slate-50"}`}>
                      <span className={`grid h-9 w-9 place-items-center rounded-full text-xs font-bold ${item.sameIdOnOtherAccounts > 0 ? "bg-red-50 text-red-700" : "bg-[#02665e]/10 text-[#02665e]"}`}>{initials(item.tenant.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{item.tenant.name || "No name on the account"}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {idDocumentLabel(item.idType, item.idCountry)} · {item.idCountry} · <span className="font-mono">••••{item.idNumberLast4}</span>
                        </span>
                      </span>
                      <RowTag item={item} tab={tab} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {current ? <ReviewPanel key={current.id} item={current} today={data?.today ?? ""} onChanged={() => { window.dispatchEvent(new Event("nols:admin-long-stay-queue-change")); return load(); }} /> : (
          <section className="hidden rounded-lg border border-dashed border-slate-300 bg-white px-5 py-16 text-center text-sm text-slate-400 xl:block">Choose an ID from the list.</section>
        )}
      </div>
    </div>
  );
}

function RowTag({ item, tab }: { item: Item; tab: Status }) {
  if (item.sameIdOnOtherAccounts > 0) return <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Same ID ×{item.sameIdOnOtherAccounts}</span>;
  if (tab === "EXPIRING" || item.expiring) return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{day(item.idExpiresOn)}</span>;
  if (item.status === "PENDING") {
    const wait = waited(item.submittedAt);
    const late = Date.now() - new Date(item.submittedAt).getTime() > 4 * 3_600_000;
    return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${late ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{wait}</span>;
  }
  return null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="m-0 mt-0.5 truncate text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 border-0 border-t border-solid border-slate-100 py-2 text-[13px] first:border-t-0">
      {ok ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" /> : warn ? <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" /> : <XCircle className="mt-px h-4 w-4 shrink-0 text-red-600" />}
      <span className="min-w-0 text-slate-700">{children}</span>
    </li>
  );
}

function ReviewPanel({ item, today, onChanged }: { item: Item; today: string; onChanged: () => void }) {
  const [opened, setOpened] = useState<Record<Side, boolean>>({ front: false, back: false, selfie: false });
  const [nameOk, setNameOk] = useState(false);
  const [faceOk, setFaceOk] = useState(false);
  const [mode, setMode] = useState<"REJECT" | "BAR" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sides = (Object.keys(item.photos) as Side[]).filter((s) => item.photos[s]);
  const allOpened = sides.every((s) => opened[s]);
  const pending = item.status === "PENDING";
  const canApprove = pending && allOpened && nameOk && faceOk && !busy;
  const validMonths = item.idExpiresOn && today ? monthsBetween(today, item.idExpiresOn) : null;

  const send = async (path: "review" | "bar", body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/admin/long-stay/tenants/${item.id}/${path}`, body);
      onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
      setBusy(false);
    }
  };
  const confirmReason = () => {
    if (reason.trim().length < 5) { setError("Give a reason of at least 5 characters."); return; }
    if (mode === "REJECT") void send("review", { decision: "REJECT", reason: reason.trim() });
    if (mode === "BAR") void send("bar", { action: "BAR", reason: reason.trim() });
  };

  const btn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
  const outline = `${btn} cursor-pointer border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <section className="rounded-lg border border-solid border-slate-200 bg-white xl:sticky xl:top-3" aria-label="Review">
      <div className="flex flex-wrap items-start gap-3 border-0 border-b border-solid border-slate-100 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><UserRound className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-base font-bold text-slate-900">{item.tenant.name || "No name on the account"}</p>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-500">
            {item.tenant.email ? <span className="truncate">{item.tenant.email}</span> : null}
            {item.tenant.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{item.tenant.phone}{item.tenant.phoneVerified ? <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="verified" /> : null}</span> : null}
          </p>
          <p className="m-0 mt-0.5 text-xs text-slate-400">Member since {eat(item.tenant.memberSince).replace(/,? \d{2}:\d{2} EAT$/, "")} · sent {eat(item.submittedAt)}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
          <IdCard className="h-3.5 w-3.5" />{idDocumentLabel(item.idType, item.idCountry)}{item.idType === "PASSPORT" ? " · TD3" : ""}
        </span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Photos</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
            {sides.map((side) => (
              <a key={side} href={`/api/admin/long-stay/tenants/${item.id}/document?side=${side}`} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpened((o) => ({ ...o, [side]: true }))}
                className={`flex h-20 flex-col items-center justify-center gap-1 rounded-md border border-solid text-xs font-semibold no-underline ${opened[side] ? "border-emerald-200 bg-emerald-50/60 text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-600 hover:border-[#02665e] hover:text-[#02665e]"}`}>
                {opened[side] ? <CheckCircle2 className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />}
                {SIDE_LABEL[side]}
                <span className="text-[11px] font-normal">{opened[side] ? "Opened" : "Open"}</span>
              </a>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-[11px] text-slate-400">Each photo opens through a 5-minute private link. Every view is recorded.</p>

          <dl className="m-0 mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Issuing country">{item.idCountry ? `${countryName(item.idCountry)} (${item.idCountry})` : "-"}</Fact>
            <Fact label="Nationality">{item.nationality ? `${countryName(item.nationality)} (${item.nationality})` : "-"}</Fact>
            <Fact label="Number"><span className="font-mono">••••{item.idNumberLast4}</span></Fact>
            <Fact label="Expires">{item.idExpiresOn ? day(item.idExpiresOn) : "-"}</Fact>
            <Fact label="Name on the document">{item.holderName || "-"}</Fact>
            <Fact label="Date of birth">{item.dateOfBirth ? `${day(item.dateOfBirth)} (${item.age})` : "-"}</Fact>
          </dl>
        </div>

        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Checked by NoLSAF</p>
          <ul className="m-0 mt-1 list-none p-0">
            <Check ok={validMonths != null && validMonths >= 6} warn={validMonths != null && validMonths >= 0}>
              {validMonths == null ? "No expiry date recorded" : validMonths >= 6 ? `Valid for another ${validMonths} months` : `Expires soon (${day(item.idExpiresOn)}): check it covers the lease`}
            </Check>
            <Check ok>Number matches the {item.idCountry} format for this document</Check>
            <Check ok={item.age == null || item.age >= 18}>{item.age == null ? "No date of birth recorded" : `Holder is ${item.age}, old enough to sign a lease`}</Check>
            <Check ok={item.sameIdOnOtherAccounts === 0}>
              {item.sameIdOnOtherAccounts === 0 ? "Not on any other account" : `The same ID number is on ${item.sameIdOnOtherAccounts} other ${item.sameIdOnOtherAccounts === 1 ? "account" : "accounts"}`}
            </Check>
            <Check ok={item.nameAgreement === "MATCH"} warn={item.nameAgreement !== "DIFFERENT"}>
              {item.nameAgreement === "MATCH" ? "Name on the document matches the account" : item.nameAgreement === "PARTIAL" ? "Names match only in part: look closely" : item.nameAgreement === "DIFFERENT" ? "Name on the document differs from the account" : "No name to compare"}
            </Check>
          </ul>

          {pending ? (
            <>
              <p className="m-0 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">You confirm</p>
              <label className="mt-1.5 flex cursor-pointer items-start gap-2 text-[13px] text-slate-800">
                <input type="checkbox" checked={nameOk} onChange={(e) => setNameOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#02665e]" />
                The name and date of birth on the photo match what was typed and the account
              </label>
              <label className="mt-1.5 flex cursor-pointer items-start gap-2 text-[13px] text-slate-800">
                <input type="checkbox" checked={faceOk} onChange={(e) => setFaceOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#02665e]" />
                The face in the selfie is the face on the document, and the document is real and unaltered
              </label>
            </>
          ) : null}

          {item.status === "REJECTED" && item.rejectReason ? <p className="m-0 mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Rejected: {item.rejectReason}</p> : null}
          {item.status === "BARRED" && item.barReason ? <p className="m-0 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">Barred: {item.barReason}</p> : null}
          {item.status === "APPROVED" && item.reviewedAt ? <p className="m-0 mt-3 text-xs text-slate-500">Verified {eat(item.reviewedAt)}{item.expiring ? ". The tenant can send a newer document now." : ""}</p> : null}
        </div>
      </div>

      {mode ? (
        <div className="border-0 border-t border-solid border-slate-100 p-4">
          <label htmlFor={`reason-${item.id}`} className="block text-xs font-semibold text-slate-700">{mode === "REJECT" ? "What should the tenant fix? (they see this)" : "Why bar this tenant from long stays? (kept on record)"}</label>
          {mode === "REJECT" ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REJECT_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => { setReason(r); setError(""); }}
                  className={`cursor-pointer rounded-full border border-solid px-2.5 py-1 text-xs [font-family:inherit] ${reason === r ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                  {r.split(".")[0]}
                </button>
              ))}
            </div>
          ) : null}
          <textarea id={`reason-${item.id}`} value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} maxLength={300} autoFocus
            className="mt-2 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={confirmReason} className={`${btn} cursor-pointer border-0 ${mode === "BAR" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"} text-white`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{mode === "REJECT" ? "Reject" : "Bar tenant"}
            </button>
            <button type="button" onClick={() => { setMode(null); setReason(""); setError(""); }} className={outline}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
          {pending ? (
            <>
              <button type="button" disabled={!canApprove} onClick={() => send("review", { decision: "APPROVE", checks: { nameMatches: nameOk, faceMatches: faceOk } })}
                className={`${btn} cursor-pointer border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve
              </button>
              <button type="button" onClick={() => { setMode("REJECT"); setReason(""); }} className={outline}><ShieldX className="h-4 w-4" />Reject</button>
              {!canApprove && !busy ? (
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Circle className="h-3 w-3" />
                  {!allOpened ? `Open ${sides.filter((s) => !opened[s]).map((s) => SIDE_LABEL[s].toLowerCase()).join(", ")} first` : "Tick both boxes to approve"}
                </span>
              ) : null}
            </>
          ) : null}
          {item.status === "BARRED" ? (
            <button type="button" disabled={busy} onClick={() => send("bar", { action: "UNBAR" })} className={outline}>Lift the bar</button>
          ) : (
            <button type="button" onClick={() => { setMode("BAR"); setReason(""); }} className={`${btn} ml-auto cursor-pointer border-0 bg-transparent text-red-700 hover:bg-red-50`}>
              <Ban className="h-4 w-4" /> Bar from long stays
            </button>
          )}
        </div>
      )}
      {error ? <p className="m-0 px-4 pb-3 text-xs text-red-700">{error}</p> : null}
    </section>
  );
}
