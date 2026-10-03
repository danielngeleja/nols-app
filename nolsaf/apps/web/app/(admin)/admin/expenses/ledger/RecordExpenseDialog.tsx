"use client";

import { useEffect, useMemo, useState } from "react";
import { DateField } from "../_shared";
import { AlertTriangle, CreditCard, Loader2, Mail, Megaphone, MessageSquare, MoreHorizontal, Plus, ReceiptText, Server, Users, X } from "lucide-react";

/**
 * Record one of NoLSAF's own costs. Built around what is being recorded:
 * pick the kind of cost, tap the supplier, say which month the bill covers,
 * enter the amount. The description writes itself, gateway fees are checked
 * against the guest money collected in that month, and a likely duplicate is
 * flagged before it is saved. Bonuses are not offered: the platform records
 * them when they are granted.
 */

type Category = { key: string; label: string; kind: "COST_OF_REVENUE" | "OPERATING" };
type Existing = { id: number; vendor: string | null; amount: number; currency: string; incurredAt: string; periodStart: string | null; reversedAt: string | null; reversesExpenseId: number | null };

const GUIDE: Record<string, { icon: typeof CreditCard; help: string; suppliers: string[]; example: string }> = {
  GATEWAY_FEE: { icon: CreditCard, help: "What AzamPay kept from guest payments, by mobile money, bank and card", suppliers: ["AzamPay"], example: "settlement fees" },
  SMS: { icon: MessageSquare, help: "Booking codes, OTPs and alerts by text", suppliers: ["Beem Africa", "Africa's Talking", "NextSMS"], example: "SMS bundle" },
  EMAIL: { icon: Mail, help: "Transactional and marketing email", suppliers: ["Resend", "SendGrid", "Zoho Mail", "Google Workspace"], example: "email service" },
  HOSTING: { icon: Server, help: "Servers, database, domains and software", suppliers: ["AWS", "Vercel", "Railway", "Render", "Cloudflare", "Aiven"], example: "hosting" },
  STAFF: { icon: Users, help: "Salaries, allowances and statutory contributions", suppliers: ["Payroll", "NSSF", "WCF"], example: "payroll" },
  MARKETING: { icon: Megaphone, help: "Ads, promotions and printed material", suppliers: ["Meta ads", "Google Ads", "TikTok ads", "Printing"], example: "campaign" },
  OTHER: { icon: MoreHorizontal, help: "Anything else it costs to run NoLSAF", suppliers: [], example: "expense" },
};
const STREAM_LABEL: Record<string, string> = { accommodation: "Accommodation", tours: "Tours", transport: "Transport", groupStay: "Group stay", subscriptions: "Subscriptions" };

type PeriodMode = "lastMonth" | "thisMonth" | "oneOff";

function eatToday() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00Z`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthName = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function periodFor(mode: PeriodMode, oneOffDay: string) {
  const t = eatToday();
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  if (mode === "lastMonth") {
    const start = iso(new Date(Date.UTC(y, m - 1, 1)));
    const end = iso(new Date(Date.UTC(y, m, 0)));
    return { periodStart: start, periodEnd: end, incurredOn: end, label: monthName(start) };
  }
  if (mode === "thisMonth") {
    const start = iso(new Date(Date.UTC(y, m, 1)));
    return { periodStart: start, periodEnd: iso(t), incurredOn: iso(t), label: `${monthName(start)} so far` };
  }
  return { periodStart: null as string | null, periodEnd: null as string | null, incurredOn: oneOffDay, label: shortDay(oneOffDay) };
}

const fieldClass =
  "box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
const label = "m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400";
const chip = (on: boolean) =>
  `inline-flex h-8 items-center rounded-full border border-solid px-3 text-xs font-semibold transition-colors ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`;
const segment = (on: boolean) =>
  `h-8 rounded-md border-0 px-3 text-xs font-semibold transition ${on ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`;

export default function RecordExpenseDialog({
  categories,
  streams,
  feeRates,
  onClose,
  onSaved,
}: {
  categories: Category[];
  streams: string[];
  feeRates: { provider: string; MNO: number; BANK: number; CARD: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Bonuses are recorded by the platform when granted; offering them here would count them twice.
  const choices = categories.filter((c) => c.key !== "PARTNER_BONUS");
  const groups = [
    { title: "Cost of earning revenue", items: choices.filter((c) => c.kind === "COST_OF_REVENUE") },
    { title: "Running costs", items: choices.filter((c) => c.kind === "OPERATING") },
  ];

  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [customSupplier, setCustomSupplier] = useState(false);
  const [mode, setMode] = useState<PeriodMode>("lastMonth");
  const [oneOffDay, setOneOffDay] = useState(iso(eatToday()));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"TZS" | "USD">("TZS");
  const [description, setDescription] = useState("");
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [reference, setReference] = useState("");
  const [stream, setStream] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [expected, setExpected] = useState<{ total: number; lines: Array<{ channel: string; label: string; gmv: number; rate: number; fee: number }> } | null>(null);
  const [duplicates, setDuplicates] = useState<Existing[]>([]);

  const guide = category ? GUIDE[category] ?? GUIDE.OTHER : null;
  const period = periodFor(mode, oneOffDay);
  const amountNumber = Number(amount.replace(/,/g, ""));
  const categoryLabel = choices.find((c) => c.key === category)?.label ?? "";
  const isGateway = category === "GATEWAY_FEE";

  // The description writes itself until the admin types their own.
  const suggested = guide ? `${supplier || categoryLabel} ${guide.example}, ${period.label}`.replace(/\s+/g, " ").trim() : "";
  useEffect(() => {
    if (!descriptionTouched) setDescription(suggested.charAt(0).toUpperCase() + suggested.slice(1));
  }, [suggested, descriptionTouched]);

  // Reset the supplier when the kind of cost changes.
  useEffect(() => {
    setSupplier(category === "GATEWAY_FEE" ? feeRates?.provider || "AzamPay" : "");
    setCustomSupplier(false);
    setStream("");
  }, [category, feeRates?.provider]);

  // Guest money collected in the covered period, to sense-check a gateway fee.
  useEffect(() => {
    if (!isGateway || mode === "oneOff" || !period.periodStart || !period.periodEnd) { setCollected(null); setExpected(null); return; }
    let cancelled = false;
    const from = new Date(`${period.periodStart}T00:00:00+03:00`).toISOString();
    const to = new Date(`${period.periodEnd}T23:59:59.999+03:00`).toISOString();
    fetch(`/api/admin/finance/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setCollected(typeof j?.totals?.gmv === "number" ? j.totals.gmv : null);
        const line = (j?.margin?.costs ?? []).find((c: any) => c.key === "gatewayFees");
        setExpected(line?.estimate ? { total: Number(line.estimate.total) || 0, lines: line.estimate.lines ?? [] } : null);
      })
      .catch(() => { if (!cancelled) { setCollected(null); setExpected(null); } });
    return () => { cancelled = true; };
  }, [isGateway, mode, period.periodStart, period.periodEnd]);

  // Entries already recorded for the same kind of cost in the same period.
  useEffect(() => {
    if (!category) { setDuplicates([]); return; }
    let cancelled = false;
    const from = period.periodStart ?? period.incurredOn;
    const to = period.periodEnd ?? period.incurredOn;
    fetch(`/api/admin/finance/expenses?category=${category}&from=${from}&to=${to}&pageSize=50`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setDuplicates(Array.isArray(j?.items) ? j.items : []); })
      .catch(() => { if (!cancelled) setDuplicates([]); });
    return () => { cancelled = true; };
  }, [category, period.periodStart, period.periodEnd, period.incurredOn]);

  const likelyDuplicates = useMemo(
    () => duplicates.filter((d) => !d.reversedAt && d.reversesExpenseId == null && (!supplier || (d.vendor || "").toLowerCase() === supplier.toLowerCase())),
    [duplicates, supplier],
  );

  const effectiveRate = isGateway && collected && collected > 0 && amountNumber > 0 && currency === "TZS" ? (amountNumber / collected) * 100 : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const ready = Boolean(category) && amountNumber > 0 && description.trim().length >= 3 && Boolean(period.incurredOn);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/expenses", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description: description.trim(),
          amount: amountNumber,
          currency,
          incurredOn: period.incurredOn,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          vendor: supplier.trim() || null,
          reference: reference.trim() || null,
          stream: stream || null,
          note: note.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error || "The expense was not recorded."); return; }
      onSaved();
    } catch {
      setError("Network error, the expense was not recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Record an expense" onClick={() => !saving && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0b2420] text-emerald-300"><ReceiptText className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-neutral-900">Record an expense</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">One bill or statement per entry. Bonuses are recorded automatically when granted.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden sm:grid-cols-[240px_minmax(0,1fr)]">
          {/* What is being recorded */}
          <nav aria-label="Kind of cost" className="min-h-0 overflow-y-auto border-0 border-b border-solid border-neutral-200 bg-neutral-50 p-3 sm:border-b-0 sm:border-r">
            {groups.map((group) => (
              <div key={group.title} className="mb-3 last:mb-0">
                <p className="m-0 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{group.title}</p>
                {group.items.map((c) => {
                  const g = GUIDE[c.key] ?? GUIDE.OTHER;
                  const on = category === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setCategory(c.key)}
                      aria-pressed={on}
                      className={`mb-1 flex w-full items-start gap-2.5 rounded-lg border-0 px-2 py-2 text-left transition-colors ${on ? "bg-white shadow-sm ring-1 ring-inset ring-[#02665e]/30" : "bg-transparent hover:bg-white/70"}`}
                    >
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${on ? "bg-[#02665e] text-white" : "bg-white text-neutral-500 ring-1 ring-inset ring-neutral-200"}`}><g.icon className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0">
                        <span className={`block text-xs font-semibold ${on ? "text-neutral-900" : "text-neutral-700"}`}>{c.label}</span>
                        <span className="block text-[11px] leading-snug text-neutral-500">{g.help}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* The bill */}
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {!guide ? (
              <div className="grid h-full min-h-[280px] place-items-center text-center">
                <div>
                  <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-neutral-100 text-neutral-400"><ReceiptText className="h-5 w-5" /></span>
                  <p className="m-0 mt-3 text-sm font-semibold text-neutral-900">What are you recording?</p>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">Pick the kind of cost on the left.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Supplier */}
                <div>
                  <p className={label}>Supplier</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {guide.suppliers.map((s) => (
                      <button key={s} type="button" onClick={() => { setSupplier(s); setCustomSupplier(false); }} className={chip(!customSupplier && supplier === s)}>{s}</button>
                    ))}
                    <button type="button" onClick={() => { setCustomSupplier(true); setSupplier(""); }} className={chip(customSupplier || guide.suppliers.length === 0)}>{guide.suppliers.length ? "Someone else" : "Enter supplier"}</button>
                  </div>
                  {(customSupplier || guide.suppliers.length === 0) && (
                    <input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} placeholder="Supplier name" className={`${fieldClass} mt-2`} autoFocus />
                  )}
                </div>

                {/* Period */}
                <div>
                  <p className={label}>The bill covers</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5" role="group" aria-label="Billing period">
                      <button type="button" onClick={() => setMode("lastMonth")} aria-pressed={mode === "lastMonth"} className={segment(mode === "lastMonth")}>Last month</button>
                      <button type="button" onClick={() => setMode("thisMonth")} aria-pressed={mode === "thisMonth"} className={segment(mode === "thisMonth")}>This month</button>
                      <button type="button" onClick={() => setMode("oneOff")} aria-pressed={mode === "oneOff"} className={segment(mode === "oneOff")}>One-off</button>
                    </div>
                    {mode === "oneOff" ? (
                      <DateField value={oneOffDay} onChange={(v) => setOneOffDay(v || iso(eatToday()))} max={iso(eatToday())} ariaLabel="Date of the cost" className="h-10 w-48 rounded-lg border border-solid border-neutral-300 bg-white" />
                    ) : (
                      <span className="text-xs text-neutral-500">{shortDay(period.periodStart!)} to {shortDay(period.periodEnd!)}</span>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <p className={label}>Amount</p>
                  <div className="mt-2 flex items-stretch overflow-hidden rounded-xl border border-solid border-neutral-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15">
                    <div className="flex shrink-0 items-center gap-0.5 border-0 border-r border-solid border-neutral-200 bg-neutral-50 p-1" role="group" aria-label="Currency">
                      {(["TZS", "USD"] as const).map((c) => (
                        <button key={c} type="button" onClick={() => setCurrency(c)} aria-pressed={currency === c} className={`h-9 rounded-md border-0 px-2.5 text-xs font-bold ${currency === c ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-400 hover:text-neutral-700"}`}>{c}</button>
                      ))}
                    </div>
                    <input
                      value={amount}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^\d.]/g, "");
                        const [whole, decimals] = digits.split(".");
                        setAmount(`${Number(whole || 0).toLocaleString("en-US")}${decimals !== undefined ? `.${decimals.slice(0, 2)}` : ""}`.replace(/^0(?=\d)/, ""));
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Amount"
                      className="min-w-0 flex-1 border-0 bg-white px-4 text-2xl font-bold tabular-nums text-neutral-900 outline-none placeholder:text-neutral-300"
                    />
                  </div>
                </div>

                {/* What AzamPay should have kept, channel by channel */}
                {isGateway && mode !== "oneOff" && (
                  <div className="overflow-hidden rounded-xl border border-solid border-neutral-200">
                    <div className="flex items-center justify-between gap-3 bg-neutral-50 px-3.5 py-2.5">
                      <p className="m-0 text-xs font-semibold text-neutral-700">Expected from {feeRates?.provider ?? "AzamPay"} rates</p>
                      <span className="text-[11px] text-neutral-500">Guest money {collected == null ? "..." : `TZS ${Math.round(collected).toLocaleString("en-US")}`}</span>
                    </div>
                    <table className="w-full border-collapse text-xs">
                      <tbody>
                        {(expected?.lines ?? [
                          { channel: "MNO", label: "Mobile money", gmv: 0, rate: feeRates?.MNO ?? 2.5, fee: 0 },
                          { channel: "BANK", label: "Bank", gmv: 0, rate: feeRates?.BANK ?? 2.5, fee: 0 },
                          { channel: "CARD", label: "Card", gmv: 0, rate: feeRates?.CARD ?? 2.9, fee: 0 },
                        ]).map((l) => (
                          <tr key={l.channel} className="border-0 border-t border-solid border-neutral-100">
                            <td className="px-3.5 py-2 text-neutral-700">{l.label}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-500">TZS {Math.round(l.gmv).toLocaleString("en-US")}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-500">{l.rate}%</td>
                            <td className="px-3.5 py-2 text-right font-semibold tabular-nums text-neutral-900">TZS {Math.round(l.fee).toLocaleString("en-US")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-200 px-3.5 py-2.5">
                      <span className="text-xs">
                        <span className="text-neutral-500">Expected fee </span>
                        <b className="tabular-nums text-neutral-900">TZS {Math.round(expected?.total ?? 0).toLocaleString("en-US")}</b>
                        {expected && amountNumber > 0 && currency === "TZS" && expected.total > 0 ? (() => {
                          const diff = amountNumber - expected.total;
                          const off = Math.abs(diff) / expected.total;
                          return <span className={`ml-2 font-semibold ${off > 0.05 ? "text-amber-700" : "text-emerald-700"}`}>{off <= 0.05 ? "matches the statement" : `statement is TZS ${Math.round(Math.abs(diff)).toLocaleString("en-US")} ${diff > 0 ? "above" : "below"}`}</span>;
                        })() : null}
                      </span>
                      {expected && expected.total > 0 ? (
                        <button type="button" onClick={() => { setCurrency("TZS"); setAmount(Math.round(expected.total).toLocaleString("en-US")); }} className="h-7 rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50">Use expected</button>
                      ) : null}
                    </div>
                    {effectiveRate != null ? <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3.5 py-2 text-[11px] text-neutral-500">The amount entered is {effectiveRate.toFixed(2)}% of guest money collected.</p> : null}
                  </div>
                )}

                {/* Description and reference */}
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <label className="block min-w-0">
                    <span className={label}>Description</span>
                    <input value={description} onChange={(e) => { setDescription(e.target.value); setDescriptionTouched(true); }} maxLength={300} className={`${fieldClass} mt-2`} />
                  </label>
                  <label className="block min-w-0">
                    <span className={label}>Statement or invoice no.</span>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="For matching the paperwork" className={`${fieldClass} mt-2`} />
                  </label>
                </div>

                {/* Stream: only where a cost can belong to one */}
                {isGateway && (
                  <div>
                    <p className={label}>Charged on</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setStream("")} className={chip(stream === "")}>All streams</button>
                      {streams.map((s) => <button key={s} type="button" onClick={() => setStream(s)} className={chip(stream === s)}>{STREAM_LABEL[s] ?? s}</button>)}
                    </div>
                  </div>
                )}

                {noteOpen ? (
                  <label className="block">
                    <span className={label}>Note</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={`${fieldClass} mt-2 h-auto resize-y py-2`} autoFocus />
                  </label>
                ) : (
                  <button type="button" onClick={() => setNoteOpen(true)} className="border-0 bg-transparent p-0 text-xs font-semibold text-[#02665e] hover:underline">+ Add a note</button>
                )}

                {likelyDuplicates.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-solid border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {likelyDuplicates.length === 1 ? "An entry" : `${likelyDuplicates.length} entries`} for {supplier || categoryLabel.toLowerCase()} already {likelyDuplicates.length === 1 ? "covers" : "cover"} this period
                      {" "}({likelyDuplicates.map((d) => `${d.currency} ${Math.round(d.amount).toLocaleString("en-US")}`).join(", ")}). Check it is not the same bill.
                    </span>
                  </div>
                )}
                {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-800">{error}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-5 py-3">
          <p className="m-0 min-w-0 text-xs text-neutral-500">
            {guide && amountNumber > 0 ? (
              <>
                <span className="font-semibold tabular-nums text-neutral-900">{currency} {amountNumber.toLocaleString("en-US")}</span>
                {" "}· {categoryLabel} · {period.label} · lowers the {isGateway ? "contribution" : "net"} margin
              </>
            ) : "Entries cannot be edited later. A mistake is corrected by reversing it."}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving || !ready} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white hover:bg-[#12342f] disabled:opacity-40">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Record expense
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
