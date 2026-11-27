"use client";

import { useState } from "react";
import { CalendarRange, Check, FileText, Wallet } from "lucide-react";
import { longStayTermsFromServer, useLongStayQuote } from "@/app/(owner)/owner/properties/add/_components/LongStayTermsCard";

type LeaseTerms = {
  monthlyRent: number;
  currency: string;
  minTermMonths: number;
  maxTermMonths: number | null;
  upfrontMonths: number;
  securityDepositMonths: number;
  noticePeriodDays: number;
  utilities: Record<string, "INCLUDED" | "TENANT">;
  billEstimates?: Record<string, number | null> | null;
  balanceMethods?: string[];
  residencyRules?: { petsAllowed: boolean; maxOccupants: number } | null;
};

const utilityLabels: Record<string, string> = {
  water: "Water", electricity: "Electricity", internet: "Internet", security: "Security", serviceCharge: "Service charge",
};
const paymentLabels: Record<string, string> = { BANK: "Bank transfer", MOBILE_MONEY: "Mobile money" };
const months = (count: number) => `${count} month${count === 1 ? "" : "s"}`;

export default function OwnerLeaseTerms({ terms, furnishing }: { terms: LeaseTerms; furnishing: string }) {
  const draft = longStayTermsFromServer(terms)!;
  const options = [3, 6, 12].filter((length) => length >= terms.minTermMonths && length <= (terms.maxTermMonths ?? 24));
  const [selected, setSelected] = useState<number | null>(null);
  const term = selected !== null && options.includes(selected) ? selected : options[0] ?? terms.minTermMonths;
  const { quote, error, discount } = useLongStayQuote(draft, term);
  const money = (amount: number) => `${terms.currency === "TZS" ? "TSh" : terms.currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: terms.currency === "TZS" ? 0 : 2 })}`;
  const upfront = Math.min(terms.upfrontMonths, term);
  const deposit = quote ? quote.monthlyRent * terms.securityDepositMonths : 0;
  const dueAtMoveIn = quote ? quote.balanceDue + deposit : 0;
  const paymentMethods = (terms.balanceMethods ?? []).map((method) => paymentLabels[method]).filter(Boolean);
  const utilities = Object.entries(terms.utilities ?? {}).filter(([, status]) => status === "INCLUDED" || status === "TENANT");
  const rules = terms.residencyRules;
  const facts = [
    { label: "Lease length", value: terms.maxTermMonths == null ? `From ${months(terms.minTermMonths)}` : `${terms.minTermMonths}–${terms.maxTermMonths} months`, detail: terms.maxTermMonths == null ? "You haven’t set a maximum in this listing." : "Minimum and maximum term saved for this home." },
    { label: "Furnishing", value: furnishing, detail: "The furnishing level tenants see on your listing." },
    { label: "Notice to end early", value: `${terms.noticePeriodDays} days`, detail: "Notice period recorded in the lease terms." },
    ...(rules ? [{ label: "Occupancy and pets", value: `Up to ${rules.maxOccupants} occupants`, detail: rules.petsAllowed ? "Pets allowed." : "Pets are not allowed." }] : []),
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-labelledby="owner-lease-terms">
      <header className="border-0 border-b border-solid border-slate-200 px-4 py-4 sm:px-6">
        <h2 id="owner-lease-terms" className="m-0 text-lg font-bold text-slate-900">Lease terms</h2>
        <p className="m-0 mt-1 text-sm text-slate-600">How long tenants can stay, what they pay, and what the rent includes.</p>
      </header>

      <div className="space-y-6 p-4 sm:p-6">
        <div className="overflow-hidden rounded-md border border-solid border-[#dcebe4]">
          <div className="flex flex-wrap items-start justify-between gap-3 bg-[#edf6f1] px-4 py-3.5">
            <div>
              <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-[#235b49]"><Wallet className="h-4 w-4" aria-hidden /> Payment breakdown</h3>
              <p className="m-0 mt-1 text-xs text-slate-600">
                First {months(upfront)} paid upfront · {terms.securityDepositMonths > 0 ? `${months(terms.securityDepositMonths)} of rent as deposit` : "No deposit"}
              </p>
            </div>
            {options.length > 1 && (
              <div role="group" aria-label="Lease length to preview" className="flex flex-wrap gap-1">
                {options.map((length) => (
                  <button key={length} type="button" aria-pressed={term === length} onClick={() => setSelected(length)}
                    className={`cursor-pointer rounded border border-solid px-2.5 py-1.5 text-xs font-semibold [font-family:inherit] ${term === length ? "border-[#02665e] bg-[#02665e] text-white" : "border-[#cbded3] bg-white text-[#235b49] hover:border-[#02665e]"}`}>
                    {months(length)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {quote ? (
            <div className="p-4" aria-live="polite">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <p className="m-0 text-xs font-medium text-slate-600">Tenant pays through move-in</p>
                  <p className="m-0 mt-0.5 text-xl font-bold tabular-nums text-slate-950">{money(quote.bookingAmount + dueAtMoveIn)}</p>
                </div>
                <p className="m-0 text-sm text-slate-600"><strong className="text-slate-900">{money(quote.monthlyRent)}</strong> per month{discount > 0 ? ` · ${discount}% lease discount` : ""}</p>
              </div>

              <div className="mt-3 flex h-1.5 overflow-hidden rounded-sm" aria-hidden>
                <span className="bg-[#02665e]" style={{ flexGrow: quote.bookingAmount }} />
                <span className="bg-[#85b8a5]" style={{ flexGrow: dueAtMoveIn }} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded border border-solid border-slate-200 px-3 py-2.5">
                  <h4 className="m-0 text-xs font-bold text-[#02665e]">After signing · Pay NoLSAF</h4>
                  <dl className="m-0 mt-2 space-y-1.5 text-sm">
                    <PaymentRow label="First month’s rent" value={money(quote.monthlyRent)} />
                    <PaymentRow label="Service fee" value={money(quote.tenantFee)} />
                  </dl>
                </div>
                <div className="rounded border border-solid border-slate-200 px-3 py-2.5">
                  <h4 className="m-0 text-xs font-bold text-[#416758]">At move-in · Pay the landlord</h4>
                  <dl className="m-0 mt-2 space-y-1.5 text-sm">
                    <PaymentRow label="Remaining upfront rent" value={money(quote.balanceDue)} />
                    <PaymentRow label="Security deposit" value={deposit > 0 ? money(deposit) : "None"} />
                  </dl>
                  {deposit > 0 && <p className="m-0 mt-1.5 text-xs text-slate-500">{months(terms.securityDepositMonths)} of rent, held separately as a refundable deposit.</p>}
                  {dueAtMoveIn > 0 && paymentMethods.length > 0 && <p className="m-0 mt-1 text-xs text-slate-500">{paymentMethods.join(" or ")}</p>}
                </div>
              </div>
              {term > upfront && <p className="m-0 mt-3 text-xs leading-relaxed text-slate-600">Rent for the remaining {months(term - upfront)} is due after the upfront period, according to the lease.</p>}
            </div>
          ) : (
            <p role="status" className="m-0 px-4 py-3 text-sm text-slate-600">{error ? "The payment breakdown is temporarily unavailable." : Number(terms.monthlyRent) > 0 ? "Calculating the payment breakdown…" : "Set the monthly rent to see a payment breakdown."}</p>
          )}
        </div>

        <div>
          <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><FileText className="h-4 w-4 text-[#02665e]" aria-hidden /> Lease conditions</h3>
          <dl className="m-0 mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {facts.map(({ label, value, detail }) => (
              <div key={label} className="border-0 border-t border-solid border-slate-100 pt-2">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="m-0 mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
                <dd className="m-0 mt-0.5 text-xs leading-relaxed text-slate-600">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        {utilities.length > 0 && (
          <div id="owner-monthly-utilities" className="scroll-mt-24 border-0 border-t border-solid border-slate-200 pt-4">
            <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarRange className="h-4 w-4 text-[#02665e]" aria-hidden /> Monthly utilities</h3>
            <ul className="m-0 mt-2 grid list-none gap-x-4 gap-y-1 p-0 sm:grid-cols-2">
              {utilities.map(([name, status]) => {
                const estimate = terms.billEstimates?.[name];
                return (
                  <li key={name} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-0 border-b border-solid border-slate-100 py-1.5 text-xs">
                    <span className="font-medium text-slate-800">{utilityLabels[name] || name}</span>
                    {status === "INCLUDED" ? <span className="flex items-center gap-1 text-[#02665e]"><Check className="h-3 w-3" aria-hidden /> Included in rent</span> : <span className="text-slate-600">{estimate != null && estimate > 0 ? `Est. ${money(estimate)}/mo` : "Paid by tenant"}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function PaymentRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><dt className="text-slate-600">{label}</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{value}</dd></div>;
}
