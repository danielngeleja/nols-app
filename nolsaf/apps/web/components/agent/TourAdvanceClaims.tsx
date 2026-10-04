"use client";

// Operator side of the pre-trip advance (Tour Operator Disbursement Policy,
// api/src/lib/tourPayoutPolicy.ts). Lists trips an advance can be requested
// on, explains why others cannot yet, and sends the request with any supplier
// receipts. NoLSAF finance verifies and approves; money moves through the
// disbursement ledger.
import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, HandCoins, Info, Plus, Receipt, ShieldCheck, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type AdvanceOffer = {
  ok: boolean;
  reason: string | null;
  opensAt: string | null;
  fullWindowAt: string | null;
  inFullWindow: boolean;
  percentWithoutEvidence: number;
  availableWithoutEvidence: number;
  availableWithEvidence: number;
  alreadyAdvanced: number;
};

export type AdvanceClaimRow = { id: number; status: string; amount: number; createdAt: string; evidenceTotal: number; reason: string | null };

export type AdvanceTrip = {
  id: string | number;
  bookingCode?: string | null;
  title: string;
  client: string;
  currency: string;
  agentEarning: number;
  dateFrom?: string | null;
  advance?: { offer: AdvanceOffer | null; paid: number; inFlight: number; claims: AdvanceClaimRow[] } | null;
};

type Evidence = { description: string; amount: string; evidenceUrl: string };

const REASON_TEXT: Record<string, string> = {
  too_early: "Opens 7 days before departure",
  cooling_off: "Opens after the traveller's 24-hour cooling-off",
  open_case: "Held while a case is open",
  tier_too_low: "Advances unlock at Silver tier",
  no_payout_destination: "Add a verified payout destination",
  recovery_debt: "Settle your open recovery first",
  fully_advanced: "Full 70% already advanced",
  no_start_date: "Trip date not set yet",
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

function placeCode(title: string): string {
  const [tour, destination] = String(title || "").split(" • ");
  return ((destination || tour || "").replace(/[^A-Za-z]/g, "").slice(0, 3) || "TRP").toUpperCase();
}

export default function TourAdvanceClaims({
  trips,
  onClaimed,
}: {
  trips: AdvanceTrip[];
  onClaimed: (tripId: string | number, row: AdvanceClaimRow) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const withAdvance = useMemo(() => trips.filter((t) => t.advance?.offer), [trips]);
  const ready = withAdvance.filter((t) => t.advance!.offer!.ok && !t.advance!.inFlight);
  const inFlight = withAdvance.filter((t) => t.advance!.inFlight > 0);
  // Only reasons an operator can act on or wait for; closed trips stay out.
  const waiting = withAdvance.filter((t) => !t.advance!.offer!.ok && t.advance!.offer!.reason && REASON_TEXT[t.advance!.offer!.reason!] && !t.advance!.inFlight);
  const selected = ready.find((t) => t.id === selectedId) || null;
  const offer = selected?.advance?.offer || null;

  const evidenceTotal = evidence.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const maxNow = offer ? Math.min(offer.availableWithEvidence, offer.availableWithoutEvidence + evidenceTotal) : 0;
  const requested = Number(amount) || 0;
  const needsReceipts = offer ? requested > offer.availableWithoutEvidence + 0.01 : false;
  const evidenceValid = evidence.every((e) => e.description.trim().length >= 3 && Number(e.amount) > 0 && /^https:\/\//i.test(e.evidenceUrl.trim()));
  const canSend = Boolean(offer && requested > 0 && requested <= maxNow + 0.01 && agree && evidenceValid && !sending);

  const pick = (trip: AdvanceTrip) => {
    setSelectedId(trip.id);
    setAmount(String(Math.floor(trip.advance!.offer!.availableWithoutEvidence)));
    setEvidence([]);
    setAgree(false);
    setError(null);
    setSent(null);
  };

  const send = async () => {
    if (!selected || !offer) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiClient.post("/api/agent/revenues/claim-advance", {
        tourCode: selected.bookingCode,
        amount: requested,
        evidence: evidence.map((e) => ({ description: e.description.trim(), amount: Number(e.amount), evidenceUrl: e.evidenceUrl.trim() })),
      });
      const row = (res as any)?.data?.advance;
      onClaimed(selected.id, { id: row?.id, status: "CLAIMED", amount: requested, createdAt: row?.createdAt || new Date().toISOString(), evidenceTotal, reason: null });
      setSent(`Advance of ${selected.currency} ${requested.toLocaleString("en-US")} sent. NoLSAF finance will verify it next.`);
      setSelectedId(null);
    } catch (err: any) {
      setError(String(err?.response?.data?.message || err?.response?.data?.error || "Could not send the advance request."));
    } finally {
      setSending(false);
    }
  };

  if (!ready.length && !inFlight.length && !waiting.length && !sent) return null;

  return (
    <div className="rounded-2xl border border-solid border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-[13.5px] font-bold text-neutral-900">
            Advance before the trip
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">{ready.length}</span>
          </h3>
          <p className="m-0 mt-0.5 text-[12px] text-neutral-500">
            Cover park fees, lodges and fuel early. 30% from 7 days out, up to 70% with supplier receipts, and 70% with no paperwork inside the last 96 hours.
          </p>
        </div>
        <Link href="/tour-operator-disbursement-policy" target="_blank" className="inline-flex flex-shrink-0 items-center gap-1 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">
          <Info className="h-3.5 w-3.5" aria-hidden />
          How payouts work
        </Link>
      </div>

      {sent ? (
        <p className="m-0 mb-3 flex items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-emerald-800">
          <Check className="h-4 w-4 flex-shrink-0" aria-hidden />
          {sent}
        </p>
      ) : null}

      {ready.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {ready.map((trip) => {
            const o = trip.advance!.offer!;
            const on = trip.id === selectedId;
            return (
              <button
                key={String(trip.id)}
                type="button"
                onClick={() => pick(trip)}
                aria-pressed={on}
                style={{ fontFamily: "inherit" }}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-solid p-3.5 text-left transition-all ${
                  on ? "border-[#02665e] bg-[#02665e]/5 shadow-[0_0_0_3px_rgba(2,102,94,0.12)]" : "border-neutral-200 bg-white hover:-translate-y-px hover:border-neutral-300"
                }`}
              >
                <span className={`inline-flex h-11 w-12 flex-shrink-0 items-center justify-center rounded-xl text-[13px] font-black tracking-[0.08em] ${on ? "bg-[#02665e] text-white" : "bg-neutral-100 text-[#02665e]"}`}>
                  {placeCode(trip.title)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold text-neutral-900">{trip.client}</span>
                  <span className="block truncate text-[11.5px] text-neutral-500">
                    {o.inFullWindow ? "70% open now, no receipts" : `${o.percentWithoutEvidence}% now, 70% with receipts`}
                  </span>
                </span>
                <span className="flex-shrink-0 text-right">
                  <span className="block text-[14px] font-extrabold tabular-nums text-neutral-900">{Math.floor(o.availableWithoutEvidence).toLocaleString("en-US")}</span>
                  <span className="block text-[10.5px] font-semibold text-neutral-400">{trip.currency} now</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selected && offer ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-solid border-[#02665e]/30">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <label className="block">
                <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-500">Advance amount ({selected.currency})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={offer.availableWithEvidence}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="block h-12 w-full min-w-0 rounded-xl border border-solid border-neutral-300 bg-white px-3.5 text-[18px] font-bold tabular-nums text-neutral-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-[#02665e] focus:outline-none focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]"
                  style={{ fontFamily: "inherit", boxSizing: "border-box" }}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  { label: `${offer.percentWithoutEvidence}% now`, value: offer.availableWithoutEvidence },
                  ...(offer.inFullWindow ? [] : [{ label: "70% with receipts", value: offer.availableWithEvidence }]),
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setAmount(String(Math.floor(chip.value)))}
                    style={{ fontFamily: "inherit" }}
                    className="h-7 cursor-pointer rounded-full border border-solid border-neutral-300 bg-white px-2.5 text-[11.5px] font-semibold text-neutral-700 hover:border-[#02665e] hover:text-[#02665e]"
                  >
                    {chip.label} · {Math.floor(chip.value).toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <p className={`m-0 mt-2 text-[12px] ${requested > maxNow + 0.01 ? "font-semibold text-rose-700" : "text-neutral-500"}`}>
                {requested > maxNow + 0.01
                  ? `Above what you can request now (${selected.currency} ${Math.floor(maxNow).toLocaleString("en-US")}). ${offer.inFullWindow ? "" : "Add receipts to request more."}`
                  : offer.inFullWindow
                    ? "You are inside the last 96 hours: no receipts needed up to 70%."
                    : `Up to ${selected.currency} ${Math.floor(offer.availableWithoutEvidence).toLocaleString("en-US")} without receipts.`}
                {offer.alreadyAdvanced > 0 ? ` ${selected.currency} ${Math.round(offer.alreadyAdvanced).toLocaleString("en-US")} already advanced.` : ""}
              </p>
              {!offer.inFullWindow && offer.fullWindowAt ? (
                <p className="m-0 mt-1 flex items-center gap-1.5 text-[11.5px] text-neutral-400">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  70% without receipts opens {fmtDate(offer.fullWindowAt)}
                </p>
              ) : null}
            </div>

            {offer.inFullWindow ? (
              <div className="rounded-2xl bg-neutral-50 p-4 text-[12.5px] leading-relaxed text-neutral-600">
                <ShieldCheck className="mb-1.5 h-5 w-5 text-[#02665e]" aria-hidden />
                The traveller can no longer get a refund this close to departure, so NoLSAF releases up to 70% without paperwork. The balance follows after the trip.
              </div>
            ) : (
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-500">Supplier receipts {needsReceipts ? "(needed)" : "(optional)"}</span>
                  <span className="text-[11.5px] font-semibold tabular-nums text-neutral-500">{selected.currency} {evidenceTotal.toLocaleString("en-US")}</span>
                </div>
                <div className="space-y-2">
                  {evidence.map((item, index) => (
                    <div key={index} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-1.5">
                      <input
                        value={item.description}
                        onChange={(e) => setEvidence((old) => old.map((x, i) => (i === index ? { ...x, description: e.target.value } : x)))}
                        placeholder="e.g. Serengeti park fees"
                        className="h-9 min-w-0 rounded-lg border border-solid border-neutral-300 px-2.5 text-[12.5px] focus:border-[#02665e] focus:outline-none"
                        style={{ fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                      <input
                        value={item.amount}
                        onChange={(e) => setEvidence((old) => old.map((x, i) => (i === index ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                        placeholder="Amount"
                        inputMode="decimal"
                        className="h-9 min-w-0 rounded-lg border border-solid border-neutral-300 px-2.5 text-[12.5px] tabular-nums focus:border-[#02665e] focus:outline-none"
                        style={{ fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                      <button
                        type="button"
                        onClick={() => setEvidence((old) => old.filter((_, i) => i !== index))}
                        aria-label="Remove receipt"
                        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                      <input
                        value={item.evidenceUrl}
                        onChange={(e) => setEvidence((old) => old.map((x, i) => (i === index ? { ...x, evidenceUrl: e.target.value } : x)))}
                        placeholder="https:// link to the receipt"
                        className="col-span-3 h-9 min-w-0 rounded-lg border border-solid border-neutral-300 px-2.5 text-[12px] focus:border-[#02665e] focus:outline-none"
                        style={{ fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEvidence((old) => [...old, { description: "", amount: "", evidenceUrl: "" }])}
                    disabled={evidence.length >= 10}
                    style={{ fontFamily: "inherit" }}
                    className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-white text-[12.5px] font-semibold text-neutral-600 hover:border-[#02665e] hover:text-[#02665e] disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    <Receipt className="h-3.5 w-3.5" aria-hidden />
                    Add a supplier receipt
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-neutral-700">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                I agree to the{" "}
                <Link href="/tour-operator-disbursement-policy" target="_blank" className="font-semibold text-[#02665e]">Tour Operator Disbursement Policy</Link>
                : if this trip is cancelled, the advance is recovered from me.
              </span>
            </label>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              style={{ fontFamily: "inherit" }}
              className="inline-flex h-10 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <HandCoins className="h-4 w-4" aria-hidden />
              {sending ? "Sending..." : `Request ${selected.currency} ${requested > 0 ? requested.toLocaleString("en-US") : "0"}`}
            </button>
          </div>
          {error ? (
            <p role="alert" className="m-0 border-0 border-t border-solid border-rose-100 bg-rose-50 px-4 py-2.5 text-[12.5px] font-semibold text-rose-700">{error}</p>
          ) : null}
        </div>
      ) : null}

      {inFlight.length || waiting.length ? (
        <ul className="m-0 mt-3 list-none divide-y divide-solid divide-neutral-100 overflow-hidden rounded-2xl border border-solid border-neutral-200 p-0 [&>*]:border-x-0">
          {inFlight.map((trip) => (
            <li key={`f-${trip.id}`} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2.5">
              <span className="min-w-0 truncate text-[13px] font-semibold text-neutral-800">{trip.client}</span>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
                Advance {trip.currency} {Math.round(trip.advance!.inFlight).toLocaleString("en-US")} with NoLSAF
              </span>
            </li>
          ))}
          {waiting.map((trip) => {
            const o = trip.advance!.offer!;
            return (
              <li key={`w-${trip.id}`} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2.5">
                <span className="min-w-0 truncate text-[13px] font-semibold text-neutral-800">{trip.client}</span>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                  {REASON_TEXT[o.reason!]}
                  {o.opensAt ? ` · ${fmtDate(o.opensAt)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
