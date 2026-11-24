"use client";

/**
 * Reservation and lease on a long stay (docs/LONG_STAY_RENTALS.md section 3.3).
 * The tenant reserved at the listed terms; the landlord confirms within 24
 * hours. Money comes from the server, frozen once the landlord confirms. A
 * side accepts the lease by sending the fingerprint of the exact text it was shown.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarRange, Check, CheckCircle2, ChevronDown, Clock3, CreditCard, FileSignature, Loader2, Printer, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DocumentViewer from "@/components/admin/DocumentViewer";
import { LEASE_PDF_FLOW, leaseDocumentHtml } from "@/lib/leaseDocument";
import MoveInPanel, { type MoveInView } from "./MoveInPanel";
import StayLifecyclePanel, { type LifecycleView } from "./StayLifecyclePanel";

type Side = "TENANT" | "LANDLORD";
export type OfferLeaseView = {
  ref: string;
  status: string;
  home: { terms?: { minTermMonths: number; maxTermMonths: number | null; availableFrom: string } | null } | null;
  offer: { moveInDate: string; termMonths: number; endDate: string | null } | null;
  confirmBy?: string | null;
  money: { currency: string; monthlyRent: number; upfrontMonths: number; balanceDue: number; bookingAmount?: number; tenantFee?: number; landlordCommission?: number; landlordPayout?: number; firstMonth?: number } | null;
  lease: { version: string; hash: string; tenantAcceptedAt: string | null; landlordAcceptedAt: string | null } | null;
  paymentDueAt: string | null;
  paidAt?: string | null;
  moveIn?: MoveInView["moveIn"];
  payout?: MoveInView["payout"];
  endDate?: LifecycleView["endDate"];
  notice?: LifecycleView["notice"];
  cancellation?: LifecycleView["cancellation"];
  claims?: LifecycleView["claims"];
};

function money(value: number | undefined, currency: string) {
  return `${currency} ${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function dayLabel(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:opacity-50 [font-family:inherit]";
const primary = `${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`;
const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

export default function OfferLeasePanel({ side, view, base, onChanged }: { side: Side; view: OfferLeaseView; base: string; onChanged: () => Promise<void> | void }) {
  const ref = encodeURIComponent(view.ref);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const post = async (key: string, path: string, body: unknown = {}) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`${base}/tenancies/${ref}/${path}`, body);
      await onChanged();
      return true;
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const status = view.status;
  let body: React.ReactNode = null;

  if (status === "OFFERED" && view.offer) body = <OfferReview side={side} view={view} post={post} busy={busy} />;
  else if ((status === "ACCEPTED" || status === "AWAITING_PAYMENT") && view.lease) body = <LeaseBlock side={side} view={view} base={base} post={post} busy={busy} />;
  else if ((status === "RESERVED" || status === "MOVE_IN") && view.money) body = <><ReservedBlock side={side} view={view} /><div className="mt-3"><MoveInPanel side={side} view={view} base={base} onChanged={onChanged} /></div>{status === "RESERVED" ? <div className="mt-3"><StayLifecyclePanel side={side} view={view} base={base} onChanged={onChanged} /></div> : null}</>;
  else if (["ACTIVE", "ENDING", "OVERDUE", "DISPUTED"].includes(status) && view.money) body = <><MoveInPanel side={side} view={view} base={base} onChanged={onChanged} /><div className="mt-3"><StayLifecyclePanel side={side} view={view} base={base} onChanged={onChanged} /></div></>;
  else if ((status === "ENDED" || (status === "CANCELLED" && view.cancellation)) && view.money) body = <StayLifecyclePanel side={side} view={view} base={base} onChanged={onChanged} />;
  if (!body) return null;

  return (
    <div className="border-0 border-t border-solid border-slate-100 px-5 py-4">
      {body}
      {error ? <p role="alert" className="m-0 mt-2 text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}

type Post = (key: string, path: string, body?: unknown) => Promise<boolean>;

function eatTime(iso: string | null | undefined) {
  if (!iso) return "";
  return `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function ReservationDates({ offer }: { offer: NonNullable<OfferLeaseView["offer"]> }) {
  return (
    <div className="rounded-md bg-[#f0f6f4] px-3.5 py-3">
      <h2 className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[#215b50]"><CalendarRange className="size-4" aria-hidden />Stay dates</h2>
      <dl className="m-0 mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 sm:gap-x-4">
        <div className="min-w-0">
          <dt className="text-xs text-slate-600">Move-in</dt>
          <dd className="m-0 mt-0.5 text-sm font-bold leading-snug tabular-nums text-slate-950 sm:text-lg"><time dateTime={offer.moveInDate}>{dayLabel(offer.moveInDate)}</time></dd>
        </div>
        <div className="flex items-center gap-1.5 text-[#215b50] sm:gap-2">
          <span aria-hidden className="hidden h-px w-6 bg-[#9abdb2] sm:block md:w-10" />
          <div className="rounded border border-solid border-[#c9ded7] bg-white px-2 py-1 text-center">
            <dt className="sr-only">Lease length</dt>
            <dd className="m-0 whitespace-nowrap text-xs font-semibold">{offer.termMonths} {offer.termMonths === 1 ? "month" : "months"}</dd>
          </div>
          <span aria-hidden className="hidden h-px w-6 bg-[#9abdb2] sm:block md:w-10" />
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-xs text-slate-600">Lease ends</dt>
          <dd className="m-0 mt-0.5 text-sm font-bold leading-snug tabular-nums text-slate-950 sm:text-lg">
            {offer.endDate ? <time dateTime={offer.endDate}>{dayLabel(offer.endDate)}</time> : "Pending"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function OfferReview({ side, view, post, busy }: { side: Side; view: OfferLeaseView; post: Post; busy: string | null }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const offer = view.offer!;
  if (side === "TENANT") {
    const steps = [
      { label: "Request sent", Icon: Check },
      { label: "Landlord response", Icon: Clock3 },
      { label: "Sign lease", Icon: FileSignature },
      { label: "First payment", Icon: CreditCard },
    ];
    return (
      <section aria-label="Your reservation" className="space-y-4">
        <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-md border border-solid border-[#d9e7e2] bg-[#f8fbfa] px-3.5 py-3">
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-900"><Clock3 className="size-4" aria-hidden /></span>
              <div className="min-w-0">
                <h2 className="m-0 text-base font-bold tracking-tight text-slate-950">Waiting for the landlord</h2>
                {view.confirmBy && <p className="m-0 mt-0.5 text-xs font-semibold text-amber-900">Response due <time dateTime={view.confirmBy}>{eatTime(view.confirmBy)}</time></p>}
              </div>
            </div>
            <p className="m-0 mt-2 text-xs leading-5 text-slate-700">Once the landlord confirms, you can review and sign the lease. Payment follows signing.</p>
          </div>
          <ReservationDates offer={offer} />
        </div>
        <ol aria-label="Reservation progress" className="m-0 grid list-none grid-cols-4 gap-1 p-0 sm:gap-2">
          {steps.map(({ label, Icon }, index) => (
            <li key={label} aria-current={index === 1 ? "step" : undefined} className="min-w-0">
              <div className="mb-1.5 flex items-center gap-1 sm:gap-2" aria-hidden>
                <span className={`grid size-7 shrink-0 place-items-center rounded-full sm:size-8 ${index === 0 ? "bg-[#02665e] text-white" : index === 1 ? "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300" : "bg-slate-100 text-slate-600"}`}><Icon className="size-3.5" /></span>
                {index < steps.length - 1 && <span className={`h-px flex-1 ${index === 0 ? "bg-[#8eb6a8]" : "bg-slate-200"}`} />}
              </div>
              <span className={`block text-[11px] font-semibold leading-snug sm:text-xs ${index === 1 ? "text-amber-900" : index === 0 ? "text-[#215b50]" : "text-slate-600"}`}>{label}{index === 0 && <span className="sr-only">, complete</span>}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <section aria-label="Review reservation" className="space-y-3">
      <ReservationDates offer={offer} />
      <div className="rounded-md border border-solid border-slate-200 px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-base font-semibold tracking-tight text-slate-950">Review the request</h2>
          {view.confirmBy && <p className="m-0 inline-flex flex-wrap items-center gap-1.5 rounded bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900"><Clock3 className="size-3.5" aria-hidden />Respond by <time dateTime={view.confirmBy}>{eatTime(view.confirmBy)}</time></p>}
        </div>
        {declining ? (
          <div className="mt-3">
            <label htmlFor="decline-reason" className="block text-xs font-semibold text-slate-700">Why? The tenant sees this.</label>
            <input id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} autoFocus placeholder="The home is no longer free on these dates"
              className="mt-1 h-9 w-full min-w-0 rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={reason.trim().length < 5 || busy !== null} onClick={async () => { if (await post("decline", "offer/decline", { reason: reason.trim() })) setDeclining(false); }} className={`${btn} border-0 bg-red-600 text-white hover:bg-red-700`}>{busy === "decline" ? "Declining…" : "Decline reservation"}</button>
              <button type="button" disabled={busy !== null} onClick={() => setDeclining(false)} className={outline}>Back</button>
            </div>
          </div>
        ) : (
          <>
            <p className="m-0 mt-2 text-sm leading-5 text-slate-600">Confirm to prepare the lease at the listed terms. NoLSAF checks the tenant’s ID before signing, and payment follows signing.{view.confirmBy ? " Unanswered requests expire at the deadline." : ""}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy !== null} onClick={() => post("accept", "offer/accept")} className={primary}>
                {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Confirm and prepare lease
              </button>
              <button type="button" disabled={busy !== null} onClick={() => setDeclining(true)} className={outline}>Decline</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function LeaseBlock({ side, view, base, post, busy }: { side: Side; view: OfferLeaseView; base: string; post: Post; busy: string | null }) {
  const [open, setOpen] = useState(false);
  const [lease, setLease] = useState<{ hash: string; text: string; version: string } | null>(null);
  const [read, setRead] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [leaseError, setLeaseError] = useState("");
  const m = view.money!;
  const mine = side === "TENANT" ? view.lease!.tenantAcceptedAt : view.lease!.landlordAcceptedAt;
  const theirs = side === "TENANT" ? view.lease!.landlordAcceptedAt : view.lease!.tenantAcceptedAt;

  useEffect(() => {
    if ((!open && !docOpen) || lease) return;
    setLeaseError("");
    apiClient.get(`${base}/tenancies/${encodeURIComponent(view.ref)}/lease`)
      .then((response) => setLease(response.data))
      .catch((error) => { setLease(null); setLeaseError(error?.response?.data?.error || "Could not load the lease."); });
  }, [open, docOpen, lease, base, view.ref]);

  const leaseHtml = useMemo(() => (lease ? leaseDocumentHtml({
    text: lease.text,
    version: lease.version,
    reference: view.ref,
    fingerprint: lease.hash,
    landlordAcceptedAt: view.lease!.landlordAcceptedAt,
    tenantAcceptedAt: view.lease!.tenantAcceptedAt,
  }) : ""), [lease, view.ref, view.lease]);

  return (
    <div>
      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-slate-800"><FileSignature className="h-4 w-4 text-[#02665e]" />Lease</p>
      {view.offer ? <p className="m-0 mt-1 text-[13px] text-slate-600">{view.offer.termMonths} months, {dayLabel(view.offer.moveInDate)} to {dayLabel(view.offer.endDate)} · {money(m.monthlyRent, m.currency)} a month</p> : null}

      <dl className="m-0 mt-3 grid gap-1.5 rounded-md bg-slate-50 p-3 text-[13px]">
        {side === "TENANT" ? (
          <>
            <Row label="You pay NoLSAF by card (first month + fee)" value={money(m.bookingAmount, m.currency)} strong />
            <Row label="You pay the landlord at move-in" value={money(m.balanceDue, m.currency)} />
          </>
        ) : (
          <>
            <Row label="Tenant pays you at move-in" value={money(m.balanceDue, m.currency)} />
            <Row label="First month, held by NoLSAF until move-in" value={money(m.firstMonth, m.currency)} />
            <Row label="NoLSAF commission (from the first month)" value={money(m.landlordCommission, m.currency)} muted />
            <Row label="NoLSAF sends you after move-in" value={money(m.landlordPayout, m.currency)} strong />
          </>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
        <Signed label={side === "TENANT" ? "You" : "Tenant"} at={side === "TENANT" ? view.lease!.tenantAcceptedAt : view.lease!.tenantAcceptedAt} />
        <Signed label={side === "LANDLORD" ? "You" : "Landlord"} at={view.lease!.landlordAcceptedAt} />
        <button type="button" onClick={() => setDocOpen(true)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e] [font-family:inherit]">
          <Printer className="h-3.5 w-3.5" />View, print or save
        </button>
      </div>
      {docOpen ? (
        <DocumentViewer
          open
          title="Residential tenancy agreement"
          subtitle={`${view.ref}${lease ? ` · version ${lease.version}` : ""}`}
          html={leaseHtml}
          loading={!lease && !leaseError}
          error={leaseError || null}
          filename={`NoLSAF lease ${view.ref}.pdf`}
          pdfFormat="a4"
          pdfFlow={LEASE_PDF_FLOW}
          onClose={() => setDocOpen(false)}
        />
      ) : null}

      {view.status === "AWAITING_PAYMENT" ? (
        side === "TENANT" ? <PayBox view={view} /> : (
          <p className="m-0 mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
            Lease signed by both. The tenant pays the first month next{view.paymentDueAt ? `, by ${dueLabel(view.paymentDueAt)}` : ""}.
          </p>
        )
      ) : mine ? (
        <p className="m-0 mt-3 text-[13px] text-slate-600">You accepted. {theirs ? "" : `Waiting for the ${side === "TENANT" ? "landlord" : "tenant"}.`}</p>
      ) : (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />{open ? "Hide the lease" : "Read the lease"}
          </button>
          {open ? (
            lease ? (
              <>
                <pre className="m-0 mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-solid border-slate-200 bg-white p-3 text-[12.5px] leading-5 text-slate-700 [font-family:inherit]">{lease.text}</pre>
                <p className="m-0 mt-1 text-[11px] text-slate-400">Version {lease.version} · fingerprint {lease.hash.slice(0, 12)}</p>
                <label className="mt-2 flex items-start gap-2 text-[13px] text-slate-700">
                  <input type="checkbox" checked={read} onChange={(event) => setRead(event.target.checked)} className="mt-0.5 h-4 w-4" />
                  I have read this lease and accept it.
                </label>
                <button type="button" disabled={!read || busy === "lease"} onClick={() => post("lease", "lease/accept", { leaseHash: lease.hash })} className={`${primary} mt-2`}>
                  {busy === "lease" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Accept the lease
                </button>
                {side === "TENANT" ? <p className="m-0 mt-2 text-[12px] text-slate-500">You need a verified <Link href="/account/long-stay-id" className="font-semibold text-[#02665e] no-underline hover:underline">Long-stay ID</Link> to accept.</p> : null}
              </>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading the lease</div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Paid and held by NoLSAF; what happens on move-in day. */
function ReservedBlock({ side, view }: { side: Side; view: OfferLeaseView }) {
  const m = view.money!;
  const moveInDay = view.status === "MOVE_IN";
  return (
    <div>
      <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />{moveInDay ? "Move-in day" : "Reserved"}</p>
      <p className="m-0 mt-1 text-[13px] text-slate-700">
        {view.offer ? `${view.offer.termMonths} months from ${dayLabel(view.offer.moveInDate)}. ` : ""}
        {side === "TENANT" ? `First month paid${view.paidAt ? ` on ${dayLabel(view.paidAt)}` : ""}; NoLSAF holds it until you confirm move-in.` : "The tenant paid the first month; NoLSAF holds it until move-in is confirmed."}
      </p>
      <ol className="m-0 mt-3 list-none space-y-1.5 p-0 text-[13px] text-slate-700">
        <li className="flex gap-2"><span className="font-semibold text-slate-400">1</span>Walk through the home together and take condition photos.</li>
        <li className="flex gap-2"><span className="font-semibold text-slate-400">2</span>{side === "TENANT" ? `Then pay the landlord the balance (${money(m.balanceDue, m.currency)}).` : `The tenant then pays you the balance (${money(m.balanceDue, m.currency)}).`}</li>
        <li className="flex gap-2"><span className="font-semibold text-slate-400">3</span>Keys are handed over, and both of you confirm here.</li>
      </ol>
      {side === "TENANT" ? <p className="m-0 mt-2 text-[12px] text-slate-500">Do not pay the balance before you have inspected the home.</p> : null}
    </div>
  );
}

function dueLabel(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

/** The tenant's card payment: the frozen amount, the deadline, and one button to the secure checkout. */
function PayBox({ view }: { view: OfferLeaseView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const m = view.money!;
  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await apiClient.post<{ checkoutUrl: string }>("/api/payments/coralcommerce/card/tenancy/initiate", { ref: view.ref });
      if (!response.data?.checkoutUrl) throw new Error("no_checkout");
      window.location.assign(response.data.checkoutUrl);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || "Could not open the card payment. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-md border border-solid border-[#02665e]/30 bg-[#02665e]/[0.04] p-3">
      <p className="m-0 text-[13px] font-semibold text-slate-900">Lease signed. Pay the first month to reserve the home.</p>
      <p className="m-0 mt-0.5 text-[12.5px] text-slate-600">{view.paymentDueAt ? `Pay by ${dueLabel(view.paymentDueAt)}, or the lease closes.` : "Pay within 48 hours, or the lease closes."}</p>
      <button type="button" disabled={busy} onClick={pay} className={`${primary} mt-2.5 w-full sm:w-auto`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Pay {money(m.bookingAmount, m.currency)} by card
      </button>
      <p className="m-0 mt-2 text-[11.5px] text-slate-500">Secure card checkout. NoLSAF holds this until you confirm move-in. The rest ({money(m.balanceDue, m.currency)}) goes to the landlord on move-in day, after you inspect the home.</p>
      {error ? <p className="m-0 mt-2 text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}

function Signed({ label, at }: { label: string; at: string | null }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold ${at ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
      {at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{label}: {at ? "accepted" : "not yet"}
    </span>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "text-slate-400" : "text-slate-600"}>{label}</dt>
      <dd className={`m-0 whitespace-nowrap tabular-nums ${strong ? "font-bold text-slate-900" : muted ? "text-slate-500" : "font-semibold text-slate-800"}`}>{value}</dd>
    </div>
  );
}
