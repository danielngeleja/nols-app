"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Calculator, Info, Tag } from "lucide-react";
import { eventWindowMinutes, MAX_EVENT_DAYS, tsh } from "@/components/events/eventHireTypes";
import { eventVenueCheckoutTotal, type EventVenueMultiDayEstimate, type PublicEventHire, type PublicEventVenue } from "@/lib/publicEventVenue";
import styles from "./event-venue-details.module.css";

type Offer = Pick<PublicEventHire, "packages" | "cleaningFee" | "earliestStart" | "latestEnd">;
type DurationUnit = "hours" | "days";
type Duration = { unit: DurationUnit; amount: number };
const packageNames = { HALF_DAY: "Half day", FULL_DAY: "Full day", EVENING: "Evening" };

function durationLabel(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return [hours > 0 ? `${hours} hr` : "", minutes > 0 ? `${minutes} min` : ""].filter(Boolean).join(" ");
}

function parseDuration(input: string, unit: DurationUnit): Duration | null {
  const value = input.trim().toLowerCase().replace(",", ".");
  const days = value.match(/^(\d+)\s*(?:d|days?)$/);
  if (days) return { unit: "days", amount: Number(days[1]) };

  const clock = value.match(/^(\d+):([0-5]\d)$/);
  if (clock) return { unit: "hours", amount: Number(clock[1]) * 60 + Number(clock[2]) };

  const time = value.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s*(\d{1,2})\s*(?:minutes?|mins?|m))?$/);
  if (time) {
    const minutes = Number(time[2] ?? 0);
    if (minutes >= 60 || (time[2] && time[1].includes("."))) return null;
    return { unit: "hours", amount: Math.round(Number(time[1]) * 60) + minutes };
  }

  const minutes = value.match(/^(\d+)\s*(?:minutes?|mins?|m)$/);
  if (minutes) return { unit: "hours", amount: Number(minutes[1]) };
  if (unit === "days" && /^\d+$/.test(value)) return { unit, amount: Number(value) };
  if (unit === "hours" && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return { unit, amount: Math.round(Number(value) * 60) };
  return null;
}

function hourlyPackages({ earliestStart, latestEnd, packages }: Offer) {
  if (!earliestStart || !latestEnd) return [];
  const windowMinutes = eventWindowMinutes(earliestStart, latestEnd);
  const [hours, minutes] = earliestStart.split(":").map(Number);
  const opening = hours * 60 + minutes;
  const eveningMinutes = opening + windowMinutes - Math.max(opening, 17 * 60);
  const limits = {
    HALF_DAY: Math.min(windowMinutes, 5 * 60),
    FULL_DAY: Math.min(windowMinutes, 18 * 60),
    EVENING: Math.min(eveningMinutes, 6 * 60),
  };
  return packages.map(option => ({ ...option, maxMinutes: limits[option.key] }))
    .filter(option => option.maxMinutes > 0)
    .sort((a, b) => a.clientPrice - b.clientPrice);
}

function rateBands(estimates: EventVenueMultiDayEstimate[]) {
  const bands: Array<{ first: number; last: number; discount: number }> = [];
  for (const { days, discountPercent } of estimates) {
    const band = bands.at(-1);
    if (band && band.last + 1 === days && band.discount === discountPercent) band.last = days;
    else bands.push({ first: days, last: days, discount: discountPercent });
  }
  return bands;
}

export default function EventVenueCostCalculator({ venueSlug, offer, multiDayEstimates }: {
  venueSlug: string;
  offer: Offer;
  multiDayEstimates?: EventVenueMultiDayEstimate[];
}) {
  const options = hourlyPackages(offer);
  const maxMinutes = Math.max(0, ...options.map(option => option.maxMinutes));
  const [mode, setMode] = useState<DurationUnit>(maxMinutes > 0 ? "hours" : "days");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Duration | null>(null);
  const [rates, setRates] = useState(multiDayEstimates);
  const [dayCleaningFee, setDayCleaningFee] = useState(offer.cleaningFee ?? 0);
  const [checkingRates, setCheckingRates] = useState(false);
  const durationInput = useRef<HTMLInputElement>(null);
  const ratesRequest = useRef<AbortController | null>(null);
  useEffect(() => () => ratesRequest.current?.abort(), []);

  const bands = rateBands(rates ?? []);
  const maxQuotedDays = rates?.at(-1)?.days;
  const hoursMode = mode === "hours";
  const hours = selection?.unit === "hours" ? selection.amount : 0;
  const dayCount = selection?.unit === "days" ? selection.amount : 0;
  const hourly = hours > 0 ? options.find(option => option.maxMinutes >= hours) : undefined;
  const approvedDays = dayCount > 1 ? rates?.find(option => option.days === dayCount) : undefined;
  const fullDay = offer.packages.find(option => option.key === "FULL_DAY");
  const isMultiDay = dayCount > 1;
  const cleaningFee = isMultiDay ? dayCleaningFee : offer.cleaningFee ?? 0;
  const singleDay = hoursMode ? hourly : dayCount === 1 ? fullDay : undefined;
  const estimate = approvedDays ?? singleDay;
  const total = estimate ? eventVenueCheckoutTotal(estimate.clientPrice, cleaningFee, estimate.deposit) : null;
  const undiscounted = approvedDays?.undiscountedClientPrice;
  const savings = undiscounted != null && approvedDays ? undiscounted - approvedDays.clientPrice : 0;

  function clearCalculation() {
    ratesRequest.current?.abort();
    ratesRequest.current = null;
    setCheckingRates(false);
    setSelection(null);
    setError("");
  }

  function changeMode(unit: DurationUnit) {
    if (unit === mode) return;
    clearCalculation();
    setMode(unit);
    setInput("");
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearCalculation();
    const duration = parseDuration(input, mode);
    let message = "";
    if (!duration) message = hoursMode ? "Enter a duration such as 4, 4.5 or 4h 30m." : "Enter a whole number of days, such as 3.";
    else if (!Number.isSafeInteger(duration.amount) || duration.amount <= 0) message = "Enter a duration greater than zero.";
    else if (duration.unit === "hours" && maxMinutes === 0) message = "This venue hasn’t published hours for its hire packages.";
    else if (duration.unit === "hours" && duration.amount > maxMinutes) message = `One event can run for up to ${durationLabel(maxMinutes)}. Use Days to plan a longer event.`;
    else if (duration.unit === "days" && duration.amount === 1 && !fullDay) message = "Choose Hours for a single event at this venue.";
    else if (duration.unit === "days" && duration.amount > MAX_EVENT_DAYS) message = `Enter up to ${MAX_EVENT_DAYS} days.`;

    setError(message);
    if (!duration || message) {
      durationInput.current?.focus();
      return;
    }
    setMode(duration.unit);
    if (duration.unit === "hours" || duration.amount === 1) {
      setSelection(duration);
      return;
    }

    const controller = new AbortController();
    ratesRequest.current = controller;
    setCheckingRates(true);
    try {
      const response = await fetch(`/api/public/properties/event-venues/${encodeURIComponent(venueSlug)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Venue rates unavailable");
      const { venue } = await response.json() as { venue?: PublicEventVenue };
      if (controller.signal.aborted) return;
      if (!venue || !Array.isArray(venue.multiDayEstimates)) throw new Error("Published rates missing from response");
      setRates(venue.multiDayEstimates);
      setDayCleaningFee(venue.offer.cleaningFee ?? 0);
      setSelection(duration);
    } catch {
      if (!controller.signal.aborted) setError("Couldn’t load the venue’s published rates. Try Calculate again.");
    } finally {
      if (ratesRequest.current === controller) {
        ratesRequest.current = null;
        setCheckingRates(false);
      }
    }
  }

  return (
    <section aria-labelledby="venue-calculator-heading" className={styles.calculator}>
      <div className={styles.calculatorBody}>
        <div className="flex items-center gap-2.5">
          <span className={styles.packageIcon}><Calculator className="h-5 w-5" aria-hidden /></span>
          <h2 id="venue-calculator-heading" className="m-0 text-base font-semibold text-slate-900">Event cost calculator</h2>
        </div>

        <div role="group" aria-label="Duration unit" className={styles.calculatorSwitch}>
          <button type="button" aria-pressed={hoursMode} disabled={!maxMinutes} onClick={() => changeMode("hours")}>Hours</button>
          <button type="button" aria-pressed={!hoursMode} onClick={() => changeMode("days")}>Days</button>
        </div>

        {!hoursMode && bands.length > 0 && (
          <div className={styles.calculatorRates}>
            <p className="m-0 text-xs font-semibold text-[#07574f]">Published multi-day rates</p>
            <ul>
              {bands.map(({ first, last, discount }) => (
                <li key={first}>
                  <span>{first === last ? first : `${first}–${last}`} days</span>
                  <strong>{discount > 0 ? `${discount}% off` : "Standard rate"}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={calculate} className={styles.calculatorForm}>
          <label htmlFor="venue-duration" className="text-sm font-semibold text-slate-800">{hoursMode ? "Event duration" : "Number of days"}</label>
          <div className={styles.calculatorEntry}>
            <input ref={durationInput} id="venue-duration" type="text" value={input}
              maxLength={28} autoComplete="off" spellCheck={false} enterKeyHint="done"
              placeholder={hoursMode ? "e.g. 4h 30m" : "e.g. 3 days"}
              aria-describedby={error ? "venue-duration-error" : "venue-duration-hint"} aria-invalid={Boolean(error)}
              onChange={event => { clearCalculation(); setInput(event.target.value); }} />
            <button type="submit" disabled={checkingRates}>{checkingRates ? "Checking…" : "Calculate"}</button>
          </div>
          {error ? (
            <p id="venue-duration-error" role="alert" className="m-0 text-sm leading-5 text-red-700">{error}</p>
          ) : (
            <p id="venue-duration-hint" className="m-0 text-xs leading-5 text-slate-600">
              {hoursMode ? `Up to ${durationLabel(maxMinutes)} per event` : maxQuotedDays ? `Published rates cover up to ${maxQuotedDays} days.` : "Calculate to check the venue’s published rates."}
            </p>
          )}
        </form>
      </div>

      <div aria-live="polite" aria-atomic="true" aria-busy={checkingRates}>
        {selection && (
          <div className={styles.calculatorResult}>
            {estimate ? (
              <>
                <p className="m-0 text-sm font-semibold text-slate-900">
                  {approvedDays ? `${dayCount} consecutive days` : singleDay && <>{hoursMode && `${durationLabel(hours)} · `}{packageNames[singleDay.key]}</>}
                </p>
                <dl className={styles.calculatorCosts}>
                  <div><dt>{approvedDays && savings <= 0 && approvedDays.discountPercent > 0 ? "Discounted hire" : "Venue hire"}</dt><dd>{tsh(savings > 0 ? undiscounted : estimate.clientPrice)}</dd></div>
                  {approvedDays && approvedDays.discountPercent > 0 && (
                    <div className={styles.calculatorSavings}>
                      <dt><Tag className="h-3.5 w-3.5 shrink-0" aria-hidden /> {approvedDays.discountPercent}% multi-day discount</dt>
                      <dd>{savings > 0 ? `−${tsh(savings)}` : "Applied"}</dd>
                    </div>
                  )}
                  {cleaningFee > 0 && <div><dt>Cleaning</dt><dd>{tsh(cleaningFee)}</dd></div>}
                  <div><dt>Refundable deposit</dt><dd>{estimate.deposit == null ? "To confirm" : estimate.deposit === 0 ? "None" : tsh(estimate.deposit)}</dd></div>
                </dl>
                <div className={styles.calculatorTotal}>
                  <span>{isMultiDay ? `Total for ${dayCount} days` : "Total at checkout"}</span>
                  <strong>{total == null ? "To confirm" : tsh(total)}</strong>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-900">{maxQuotedDays ? `No published rate for ${dayCount} days` : "No published multi-day rate"}</p>
                  {maxQuotedDays && <p className="m-0 mt-1 text-sm leading-5 text-slate-600">This venue publishes rates for up to {maxQuotedDays} consecutive days.</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {estimate && <p className={styles.calculatorNote}>
        {isMultiDay ? "Confirm date availability with NoLSAF before booking."
          : hourly?.key === "EVENING" ? "Evening hire starts at 5:00 PM. The owner confirms your slot before payment."
            : "The owner confirms your slot before payment."}
      </p>}
    </section>
  );
}
