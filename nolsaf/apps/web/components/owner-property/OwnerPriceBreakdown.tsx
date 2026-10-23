import { calculatePriceWithCommission } from "@/lib/priceUtils";

function formatAmount(amount: number, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Math.round(amount).toLocaleString("en-US")}`;
}

export function OwnerPriceBreakdown({ rate, commissionPercent, currency = "TZS", dark = false }: {
  rate: number;
  commissionPercent: number | null;
  currency?: string;
  dark?: boolean;
}) {
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const guestPrice = commissionPercent === null ? null : calculatePriceWithCommission(rate, commissionPercent);
  const fee = guestPrice === null ? null : guestPrice - rate;

  return <div className={`mt-3 rounded-xl border border-solid p-3 text-xs ${dark ? "border-white/15 bg-white/[0.04] text-white/70" : "border-slate-200 bg-white text-slate-600"}`}>
    <div className="flex items-center justify-between gap-3"><span>Your nightly rate</span><strong className={dark ? "text-white" : "text-slate-900"}>{formatAmount(rate, currency)}</strong></div>
    {guestPrice === null ? (
      <p className="m-0 mt-2">Guest price preview is unavailable right now.</p>
    ) : (
      <>
        <div className="mt-1.5 flex items-center justify-between gap-3"><span>NoLSAF fee ({commissionPercent}%)</span><strong className={dark ? "text-white" : "text-slate-900"}>{formatAmount(fee!, currency)}</strong></div>
        <div className={`mt-2 flex items-center justify-between gap-3 border-0 border-t border-solid pt-2 font-semibold ${dark ? "border-white/15 text-white" : "border-slate-200 text-slate-900"}`}><span>Guest price per night</span><strong>{formatAmount(guestPrice, currency)}</strong></div>
      </>
    )}
    <p className="m-0 mt-2 text-[11px] leading-4 opacity-75">Base price for one night, before discounts or extra guest charges.</p>
  </div>;
}
