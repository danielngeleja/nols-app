"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Fingerprint, Gauge, Loader2, RefreshCw, ShieldCheck, SlidersHorizontal, UserX, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type FlaggedItem = {
  id: number;
  externalReferenceId: string;
  amount: string;
  currency: string;
  sourceType: string;
  sourceId: number;
  riskLevel: string | null;
  riskFlags: string[] | null;
  securityReviewReason: string | null;
  updatedAt: string;
  payoutAccount: { accountName: string; accountNumber: string; provider: string };
};

type ReasonKey = "verification" | "fingerprint" | "risk";

/** Why a payout is held, read from the reason the batcher recorded. */
const REASONS: Array<{ key: ReasonKey; label: string; hint: string; icon: typeof Gauge; text: string; bar: string; soft: string }> = [
  { key: "verification", label: "Failed re-verification", hint: "AzamPay name lookup no longer matches the locked account.", icon: UserX, text: "text-rose-700", bar: "bg-rose-500", soft: "bg-rose-50/70" },
  { key: "fingerprint", label: "Changed after approval", hint: "The amount or destination changed after it was approved.", icon: Fingerprint, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70" },
  { key: "risk", label: "Risk score or limit", hint: "Too risky to batch automatically, or past a payout limit.", icon: Gauge, text: "text-indigo-700", bar: "bg-indigo-500", soft: "bg-indigo-50/70" },
];

function reasonOf(item: FlaggedItem): ReasonKey {
  const reason = String(item.securityReviewReason || "").toLowerCase();
  if (reason.startsWith("risk score")) return "risk";
  if (reason.includes("fingerprint")) return "fingerprint";
  return "verification";
}

const FLAG_LABELS: Record<string, string> = {
  RECENT_ACCOUNT_CHANGE: "Payout account just changed",
  PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE: "Paid to a different account before",
  FIRST_PAYOUT_TO_BENEFICIARY: "First payout to this account",
  AMOUNT_ABOVE_NORMAL_RANGE: "Well above this payee's usual amount",
  ACCOUNT_SHARED_ACROSS_PARTNERS: "Account also used by another partner",
  AFTER_HOURS_APPROVAL: "Approved after hours",
  REPEATED_RECENT_FAILURES: "Recent failed payouts to this account",
  AMOUNT_AT_REVIEW_THRESHOLD: "At or above the review amount",
  PAYEE_DAILY_CAP_EXCEEDED: "Over the payee's daily limit",
};

const SOURCE_LABELS: Record<string, string> = {
  OWNER_INVOICE: "Owner invoice",
  TOUR_BOOKING: "Tour booking",
  DRIVER_TRIP: "Driver trip",
  SALES_PAYOUT: "Sales payout",
};

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

function money(value: string | number, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function heldFor(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes < 1 ? "just now" : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function riskTone(level: string | null) {
  if (level === "CRITICAL") return "bg-rose-600 text-white";
  if (level === "HIGH") return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  if (level === "MEDIUM") return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  return "bg-neutral-100 text-neutral-500";
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance verification is required. Complete it in the verification panel, then clear again.";
  }
  return cause?.response?.data?.error || fallback;
}

export default function SecurityReviewPage() {
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<ReasonKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/security-review");
      setItems(response.data?.disbursements || []);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load security review items."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Clearing a hold is the one action that puts a flagged payout back into the
  // money pipeline, so the reason is recorded with it and cannot be skipped.
  // The API rejects a note under 10 characters, and rejects the clear outright
  // when the caller is the admin who approved the payout.
  const clear = async (id: number) => {
    const note = (notes[id] || "").trim();
    if (note.length < 10) {
      setError(`Write what you confirmed out of band before clearing disbursement #${id} (at least 10 characters).`);
      return;
    }
    setBusy(String(id));
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/disbursements/${id}/security-review/clear`, { note });
      setNotice(`Disbursement #${id} cleared. It returns to the approved queue and joins the next batch.`);
      setNotes((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, `Could not clear disbursement #${id}.`));
    } finally {
      setBusy("");
    }
  };

  const counts = useMemo(() => {
    const out: Record<ReasonKey, number> = { verification: 0, fingerprint: 0, risk: 0 };
    for (const item of items) out[reasonOf(item)] += 1;
    return out;
  }, [items]);

  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const item of items) byCurrency.set(item.currency, (byCurrency.get(item.currency) || 0) + Number(item.amount));
    return Array.from(byCurrency.entries());
  }, [items]);

  const severe = items.filter((item) => item.riskLevel === "HIGH" || item.riskLevel === "CRITICAL").length;
  const oldest = items.reduce<string | null>((min, item) => (!min || item.updatedAt < min ? item.updatedAt : min), null);
  const visible = filter ? items.filter((item) => reasonOf(item) === filter) : items;

  const facts = [
    { label: "Held now", value: loading ? "..." : String(items.length), detail: items.length === 1 ? "payout waiting for review" : "payouts waiting for review", tone: items.length ? "text-amber-300" : "text-emerald-300" },
    {
      label: "Money held",
      value: loading ? "..." : totals.length ? money(totals[0][1], totals[0][0]) : "None",
      detail: totals.length > 1 ? `plus ${totals.slice(1).map(([c, v]) => money(v, c)).join(", ")}` : "Not sent until cleared",
      tone: "text-white",
    },
    { label: "High or critical", value: loading ? "..." : String(severe), detail: "Possible account takeover or mule", tone: severe ? "text-rose-300" : "text-white" },
    { label: "Oldest hold", value: loading ? "..." : oldest ? heldFor(oldest) : "None", detail: oldest ? `Since ${eat(oldest)}` : "Nothing waiting", tone: "text-white" },
  ];

  return (
    <div id="disbursement-security-review" className="w-full min-w-0 space-y-5">
      <style>{`#disbursement-security-review, #disbursement-security-review * { box-sizing: border-box; }`}</style>

      {/* Header: dark band with what is held right now */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Fraud controls</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Security review</h1>
              <p className="m-0 mt-1 max-w-3xl text-sm text-white/60">
                Payouts held back from batching. Clearing one sends it to the next batch, so confirm the reason no longer applies first. The admin who approved a payout cannot clear it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/management/settings#payoutsafeguards" className={heroButton}><SlidersHorizontal className="h-3.5 w-3.5" /> Payout limits</Link>
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
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Why payouts are held: one card per reason, doubling as a filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {REASONS.map((reason) => {
            const Icon = reason.icon;
            const n = counts[reason.key];
            const share = items.length ? Math.round((n / items.length) * 100) : 0;
            const selected = filter === reason.key;
            return (
              <button
                key={reason.key}
                type="button"
                onClick={() => setFilter(selected ? null : reason.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${reason.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${reason.text}`}><Icon className="h-3.5 w-3.5" /> {reason.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{loading ? "..." : n}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{reason.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${reason.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Held payouts */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{filter ? REASONS.find((r) => r.key === filter)?.label : "All held payouts"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${visible.length} ${visible.length === 1 ? "payout" : "payouts"}`}</p>
          </div>
          {filter && (
            <button type="button" onClick={() => setFilter(null)} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Show all
            </button>
          )}
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading held payouts
          </div>
        ) : visible.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-5 sm:px-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-neutral-900">{filter ? "Nothing held for this reason" : "Nothing held"}</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Every approved payout passed its checks and is batched or waiting to be.</p>
            </div>
          </div>
        ) : (
          <div>
            {visible.map((item, idx) => {
              const reason = REASONS.find((r) => r.key === reasonOf(item))!;
              const Icon = reason.icon;
              const flags = Array.isArray(item.riskFlags) ? item.riskFlags : [];
              const note = notes[item.id] || "";
              return (
                <article key={item.id} className={`grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)] ${idx ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                  {/* Who and how much */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold tabular-nums text-neutral-900">{money(item.amount, item.currency)}</span>
                      {item.riskLevel && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${riskTone(item.riskLevel)}`}>{item.riskLevel}</span>}
                    </div>
                    <p className="m-0 mt-1 truncate text-sm font-semibold text-neutral-800">{item.payoutAccount.accountName}</p>
                    <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{item.payoutAccount.provider} · {item.payoutAccount.accountNumber}</p>
                    <p className="m-0 mt-2 text-[11px] text-neutral-400">
                      {SOURCE_LABELS[item.sourceType] || item.sourceType} #{item.sourceId} · <span className="font-mono">{item.externalReferenceId}</span>
                    </p>
                  </div>

                  {/* Why it is held */}
                  <div className="min-w-0">
                    <p className={`m-0 inline-flex items-center gap-1.5 text-xs font-semibold ${reason.text}`}><Icon className="h-3.5 w-3.5" /> {reason.label}</p>
                    <p className="m-0 mt-1 text-xs leading-5 text-neutral-600">
                      {reason.key === "risk" && flags.length
                        ? `Scored ${(item.riskLevel || "high").toLowerCase()} risk. The signals that fired:`
                        : item.securityReviewReason || "No reason recorded."}
                    </p>
                    {flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {flags.map((flag) => (
                          <span key={flag} className="rounded-md bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200">{FLAG_LABELS[flag] || flag}</span>
                        ))}
                      </div>
                    )}
                    <p className="m-0 mt-2 text-[11px] text-neutral-400">Held {heldFor(item.updatedAt)} · {eat(item.updatedAt)}</p>
                  </div>

                  {/* Clear */}
                  <div className="min-w-0">
                    <label htmlFor={`note-${item.id}`} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">What you confirmed</label>
                    <textarea
                      id={`note-${item.id}`}
                      value={note}
                      onChange={(e) => setNotes((previous) => ({ ...previous, [item.id]: e.target.value }))}
                      rows={2}
                      maxLength={300}
                      placeholder="For example: called the owner on their registered number, they confirmed the new account."
                      className="mt-1.5 box-border block w-full resize-none rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 text-xs text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`text-[11px] tabular-nums ${note.trim().length >= 10 ? "text-emerald-700" : "text-neutral-400"}`}>
                        {note.trim().length >= 10 ? "Ready to clear" : `${Math.max(0, 10 - note.trim().length)} more characters`}
                      </span>
                      <button
                        type="button"
                        disabled={!!busy || note.trim().length < 10}
                        onClick={() => void clear(item.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy === String(item.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        Clear hold
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
