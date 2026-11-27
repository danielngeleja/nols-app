/**
 * Read-only event hire terms, as the owner confirms them and admin reviews them.
 */
import { Check, Clock3, Coins, Users, X } from "lucide-react";
import { ALLOWED, EVENT_TYPES, feesOf, SPACE_TYPES, depositFor, endLabel, tsh, type EventTerms } from "./eventHireTypes";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[13px] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-[13px] font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 border-0 border-t border-solid border-slate-200 px-4 py-3 first:border-t-0">
      <h3 className="m-0 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Icon className="h-3.5 w-3.5" aria-hidden />{title}</h3>
      {children}
    </section>
  );
}

export default function EventTermsSummary({ terms, fees: feeSource }: { terms: EventTerms; fees?: { ownerFeePercent?: number; clientFeePercent?: number } }) {
  const fees = feesOf(feeSource);
  const space = SPACE_TYPES.find((s) => s.key === terms.spaceType)?.label ?? "-";
  const provided = [
    terms.provided.chairs ? `${terms.provided.chairs} chairs` : null,
    terms.provided.tables ? `${terms.provided.tables} tables` : null,
    terms.provided.parkingSpaces ? `${terms.provided.parkingSpaces} parking spaces` : null,
    terms.provided.toilets ? `${terms.provided.toilets} toilets` : null,
    terms.provided.powerBackup ? "Backup power" : null,
    terms.provided.water ? "Water" : null,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <Section icon={Users} title="Space and guests">
        <dl className="m-0">
          <Row label="Space" value={space} />
          <Row label="Seated" value={terms.capacitySeated ? `${terms.capacitySeated} guests` : "-"} />
          <Row label="Standing (most allowed)" value={terms.capacityStanding ? `${terms.capacityStanding} guests` : "-"} />
        </dl>
        {terms.description ? <p className="m-0 mt-1 text-[13px] leading-5 text-slate-600">{terms.description}</p> : null}
        <div className="mt-2">
          <p className="m-0 text-[13px] text-slate-500">Suitable for</p>
          {(terms.eventTypes ?? []).length ? (
            <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
              {EVENT_TYPES.filter((t) => terms.eventTypes.includes(t.key)).map((t) => (
                <li key={t.key} className="rounded-md bg-[#02665e]/[0.07] px-2 py-0.5 text-[12px] font-semibold text-[#02665e]">{t.label}</li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-0.5 text-[13px] font-semibold text-amber-700">Not chosen</p>
          )}
        </div>
      </Section>
      <Section icon={Clock3} title="Hours">
        <dl className="m-0">
          <Row label="Earliest start" value={terms.earliestStart ?? "-"} />
          <Row label="Latest end" value={endLabel(terms.earliestStart, terms.latestEnd)} />
          <Row label="Quiet from" value={terms.noiseCutoff ? endLabel(terms.earliestStart, terms.noiseCutoff) : "No set time"} />
        </dl>
      </Section>
      <Section icon={Coins} title="Prices for the owner">
        <dl className="m-0">
          {([["Half day (up to 5 hours)", terms.halfDayPrice], ["Full day", terms.fullDayPrice], ["Evening", terms.eveningPrice]] as const).map(([label, price]) =>
            price ? <Row key={label} label={label} value={`${tsh(price)}  ·  deposit ${tsh(depositFor(terms, price))}`} /> : null,
          )}
          {terms.multiDay?.enabled ? (
            <Row
              label="Several days in a row"
              value={`Up to ${terms.multiDay.maxDays ?? "-"} days · ${[
                terms.multiDay.off2 ? `2 days ${terms.multiDay.off2}% off` : null,
                terms.multiDay.off3 ? `3+ days ${terms.multiDay.off3}% off` : null,
                terms.multiDay.off5 ? `5+ days ${terms.multiDay.off5}% off` : null,
              ].filter(Boolean).join(", ") || "no discount"}`}
            />
          ) : (
            <Row label="Several days in a row" value="Not offered" />
          )}
          <Row label="Refundable deposit"value={terms.depositMode === "FIXED" ? `${tsh(terms.deposit)} for every booking` : `${terms.depositPercent ?? "-"}% of the price booked`} />
          {terms.cleaningFee ? <Row label="Cleaning fee" value={tsh(terms.cleaningFee)} /> : null}
        </dl>
        <p className="m-0 mt-1.5 rounded-md bg-[#02665e]/[0.06] px-2.5 py-1.5 text-[12px] leading-4 text-[#02665e]">
          NoLSAF keeps {fees.owner}% of each price and adds a {fees.client}% service fee for the client. The deposit and cleaning fee carry no fee.
        </p>
      </Section>
      <Section icon={Check} title="Allowed">
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {ALLOWED.map((a) => {
            const on = terms.allowed?.[a.key];
            return (
              <li key={a.key} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium ${on ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500 line-through"}`}>
                {on ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}{a.label}
              </li>
            );
          })}
        </ul>
        {provided.length ? <p className="m-0 mt-2 text-[13px] text-slate-600"><span className="font-semibold text-slate-800">Provided:</span> {provided.join(", ")}</p> : null}
        {terms.permitNote ? <p className="m-0 mt-1 text-[13px] text-slate-600"><span className="font-semibold text-slate-800">Permit:</span> {terms.permitNote}</p> : null}
      </Section>
    </div>
  );
}
