"use client";

/**
 * Nightly price for a whole place, set in a light popup card.
 *
 * Works on a draft: nothing changes on the listing until "Save price", and
 * Cancel (or closing) leaves the saved price as it was. The guest price and
 * the rate for each group size update live while typing.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Plus, Users, X } from "lucide-react";
import { calculatePriceWithCommission } from "@/lib/priceUtils";

type Mode = "FLAT" | "EXTRA_GUEST";
type Num = number | "";

export type NightlyPriceValue = {
  pricePerNight: Num;
  pricingMode: Mode;
  includedGuests: Num;
  extraGuestFee: Num;
};

const MIN_PRICE = 5000;
const tsh = (n: number) => `TSh ${Math.round(n).toLocaleString("en-US")}`;
const digits = (raw: string): Num => {
  const clean = raw.replace(/[^0-9]/g, "").slice(0, 10);
  return clean ? Number(clean) : "";
};

export function NightlyPriceDialog({
  open,
  onClose,
  onSave,
  value,
  guestCapacity,
  commissionPercent,
  subject = "Entire place",
  priceLabel = "Your price per night",
  note,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (next: NightlyPriceValue) => void;
  value: NightlyPriceValue;
  guestCapacity: number;
  commissionPercent: number | null;
  /** What one booking covers, e.g. "Entire place" or "One Deluxe room". */
  subject?: string;
  priceLabel?: string;
  /** A short extra line under the price, e.g. the total for all rooms. */
  note?: string | null;
}) {
  const [draft, setDraft] = useState<NightlyPriceValue>(value);

  // Start from the saved values each time the card opens.
  useEffect(() => {
    if (open) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const price = Number(draft.pricePerNight) || 0;
  const priceOk = price >= MIN_PRICE;
  const canCharge = guestCapacity >= 2;
  const extra = draft.pricingMode === "EXTRA_GUEST" && canCharge;
  const included = Number(draft.includedGuests) || 0;
  const fee = Number(draft.extraGuestFee) || 0;
  const extraOk = !extra || (included >= 1 && included < guestCapacity && fee > 0);
  const valid = priceOk && extraOk;

  const guestPrice = priceOk && commissionPercent !== null ? calculatePriceWithCommission(price, commissionPercent) : null;

  // Your rate per night for each group size the place can take.
  const ladder = useMemo(() => {
    if (!extra || !priceOk || included < 1 || fee <= 0) return [];
    const rows: Array<{ guests: number; rate: number }> = [];
    for (let g = included; g <= guestCapacity && rows.length < 8; g += 1) rows.push({ guests: g, rate: price + (g - included) * fee });
    return rows;
  }, [extra, priceOk, included, fee, guestCapacity, price]);

  if (!open || typeof document === "undefined") return null;

  const set = (patch: Partial<NightlyPriceValue>) => setDraft((current) => ({ ...current, ...patch }));
  const setIncluded = (n: number) => set({ includedGuests: Math.max(1, Math.min(guestCapacity - 1, n)) });

  return createPortal(
    <div className="np-backdrop" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="np-dialog-title" className="np-card" onMouseDown={(event) => event.stopPropagation()}>
        <header className="np-head">
          <div className="min-w-0">
            <h2 id="np-dialog-title" className="np-title">Nightly price</h2>
            <p className="np-sub">
              {subject}{guestCapacity > 0 ? <><span className="np-dot" aria-hidden />sleeps {guestCapacity}</> : null}
            </p>
          </div>
          <button type="button" className="np-close" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="np-body">
          <section>
            <label className="np-label" htmlFor="np-price">{priceLabel}</label>
            <div className={`np-money is-big${draft.pricePerNight !== "" && !priceOk ? " is-bad" : ""}`}>
              <span>TZS</span>
              <input id="np-price" autoFocus inputMode="numeric" placeholder="150,000" value={draft.pricePerNight === "" ? "" : Number(draft.pricePerNight).toLocaleString("en-US")} onChange={(event) => set({ pricePerNight: digits(event.target.value) })} />
            </div>
            {draft.pricePerNight !== "" && !priceOk ? (
              <p className="np-error">The lowest nightly price is TSh 5,000.</p>
            ) : guestPrice !== null ? (
              <div className="np-earn">
                <div><span>You receive</span><strong>{tsh(price)}</strong></div>
                <div><span>NoLSAF fee {commissionPercent}%</span><strong>{tsh(guestPrice - price)}</strong></div>
                <div className="is-main"><span>Guests pay</span><strong>{tsh(guestPrice)}</strong></div>
              </div>
            ) : null}
            {note && priceOk ? <p className="np-hint mt-2">{note}</p> : null}
          </section>

          <section>
            <p className="np-label">When more guests stay</p>
            <div className="np-options" role="radiogroup" aria-label="When more guests stay">
              <button type="button" role="radio" aria-checked={!extra} className={`np-option${!extra ? " is-on" : ""}`} onClick={() => set({ pricingMode: "FLAT" })}>
                <span className="np-radio" aria-hidden />
                <span className="min-w-0">
                  <strong>Same price</strong>
                  <small>{guestCapacity > 0 ? `Any group up to ${guestCapacity} guests` : "Every group pays the same"}</small>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={extra} disabled={!canCharge} className={`np-option${extra ? " is-on" : ""}`} onClick={() => { set({ pricingMode: "EXTRA_GUEST", includedGuests: draft.includedGuests || Math.max(1, Math.min(2, guestCapacity - 1)) }); }}>
                <span className="np-radio" aria-hidden />
                <span className="min-w-0">
                  <strong>Extra guest fee</strong>
                  <small>{canCharge ? "Price covers some guests, extras pay more" : "Needs a place that sleeps 2 or more"}</small>
                </span>
              </button>
            </div>

            {extra ? (
              <div className="np-extra">
                <div className="np-extra-row">
                  <span className="np-extra-label"><Users className="h-4 w-4" aria-hidden />Price covers</span>
                  <div className="np-stepper">
                    <button type="button" aria-label="Fewer guests" disabled={included <= 1} onClick={() => setIncluded(included - 1)}><Minus className="h-3.5 w-3.5" /></button>
                    <span aria-live="polite">{included || 1} guest{(included || 1) === 1 ? "" : "s"}</span>
                    <button type="button" aria-label="More guests" disabled={included >= guestCapacity - 1} onClick={() => setIncluded(included + 1)}><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="np-extra-row">
                  <label className="np-extra-label" htmlFor="np-fee"><Plus className="h-4 w-4" aria-hidden />Each extra guest</label>
                  <div className="np-money">
                    <span>TZS</span>
                    <input id="np-fee" inputMode="numeric" placeholder="20,000" value={draft.extraGuestFee === "" ? "" : Number(draft.extraGuestFee).toLocaleString("en-US")} onChange={(event) => set({ extraGuestFee: digits(event.target.value) })} />
                  </div>
                </div>
                {ladder.length > 0 ? (
                  <div className="np-ladder" aria-label="Your rate per night by group size">
                    {ladder.map((row) => (
                      <div key={row.guests} className="np-ladder-item">
                        <span>{row.guests} guest{row.guests === 1 ? "" : "s"}</span>
                        <strong>{tsh(row.rate)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="np-hint">Enter the fee to see what each group size pays you per night.</p>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="np-foot">
          <button type="button" className="np-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="np-btn is-primary"
            disabled={!valid}
            onClick={() => {
              onSave({
                pricePerNight: draft.pricePerNight,
                pricingMode: extra ? "EXTRA_GUEST" : "FLAT",
                includedGuests: extra ? included : draft.includedGuests,
                extraGuestFee: extra ? fee : draft.extraGuestFee,
              });
              onClose();
            }}
          >
            <Check className="h-4 w-4" /> Save price
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
