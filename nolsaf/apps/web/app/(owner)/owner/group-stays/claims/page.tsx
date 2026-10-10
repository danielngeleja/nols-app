"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { DateTile, GroupStaysBand, fmtDay, humanize, placeName, tzs } from "@/components/owner-groups/GroupStaysChrome";
import { ArrowLeft, ArrowRight, Building2, Check, CircleAlert, Clock3, FileText, Filter, HandHeart, Loader2, MapPin, Percent, Star, TrendingDown, X, XCircle } from "lucide-react";

const api = apiClient;

type AvailableGroupStay = {
  id: number;
  groupType: string;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  toRegion: string;
  toDistrict?: string | null;
  toLocation?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  totalAmount: number | null;
  currency: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  existingClaimsCount: number;
  ownerClaims?: Array<{
    id: number;
    ownerId: number;
    offeredPricePerNight: number;
    discountPercent: number | null;
    status: string;
  }>;
  otherClaims?: Array<{
    id: number;
    ownerId: number;
    offeredPricePerNight: number;
    discountPercent: number | null;
    status: string;
  }>;
  hasOwnerClaim?: boolean;
  existingClaims: Array<{
    id: number;
    ownerId: number;
    offeredPricePerNight: number;
    discountPercent: number | null;
    status: string;
  }>;
  openedForClaimsAt: string | null;
  submissionDeadline: string | null;
  minDiscountPercent: number | null;
  minHotelStar?: number | null;
  createdAt: string;
};

type Property = {
  id: number;
  title: string;
  type: string;
  regionName: string;
  district?: string | null;
  services?: any;
  hotelStar?: string | null;
  basePrice: number | null;
  currency: string;
};

function normalizeText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

function normalizeKey(v: unknown): string {
  return normalizeText(v).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeDistrictName(v: unknown): string {
  return normalizeText(v)
    .replace(/\bdistrict\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getServicesTags(services: any): string[] {
  if (!services) return [];
  if (Array.isArray(services)) {
    return services.filter((s) => typeof s === "string");
  }
  if (typeof services === "object") {
    const tags = (services as any)?.tags;
    if (Array.isArray(tags)) {
      return tags.filter((s) => typeof s === "string");
    }
  }
  return [];
}

function propertyAllowsGroupStay(property: Property): boolean {
  const tags = getServicesTags(property.services);
  return tags.some((t) => normalizeText(t) === "group stay");
}

function propertyTypeToAccommodationKey(propertyType: unknown): string {
  const k = normalizeKey(propertyType);
  // UI uses human labels like "Hotel", "Guest House", etc.
  if (k === "guest_house" || k === "guesthouse") return "guest_house";
  if (k === "hotel") return "hotel";
  if (k === "apartment") return "apartment";
  if (k === "villa") return "villa";
  if (k === "lodge") return "lodge";
  if (k === "resort") return "resort";
  if (k === "camp" || k === "campsite") return "camp";
  if (k === "hostel") return "hostel";
  return k;
}

function bookingAccommodationKey(accommodationType: unknown): string {
  const k = normalizeKey(accommodationType);
  if (k === "guest_house" || k === "guesthouse") return "guesthouse";
  return k;
}

function isAccommodationCompatible(requestedAccommodationType: unknown, propertyType: unknown): boolean {
  const requested = bookingAccommodationKey(requestedAccommodationType);
  const propertyKey = propertyTypeToAccommodationKey(propertyType);

  if (!requested || !propertyKey) return true;
  if (requested === propertyKey) return true;

  // Current system does not reliably model "Hostel" as a distinct property type.
  // Best-effort compatibility: allow hotel/guest_house for hostel requests.
  if (requested === "hostel") {
    return propertyKey === "hotel" || propertyKey === "guest_house";
  }

  if (requested === "guesthouse") {
    return propertyKey === "guest_house";
  }

  return false;
}

function hotelStarLabelToNumber(v: unknown): number | null {
  const s = normalizeText(v);
  if (!s) return null;
  const map: Record<string, number> = {
    basic: 1,
    simple: 2,
    moderate: 3,
    high: 4,
    luxury: 5,
  };
  if (map[s]) return map[s];
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.trunc(n);
  return null;
}

function describeAccommodationType(v: unknown): string {
  const s = normalizeText(v);
  if (!s) return "any";
  return s.replace(/_/g, " ");
}

const ACTIVE_CLAIM = ["PENDING", "REVIEWING", "ACCEPTED"];
const EXTRAS = [
  "Free breakfast",
  "Airport pickup",
  "Late checkout",
  "Early check-in",
  "Free Wi-Fi",
  "Room upgrade",
  "Welcome drinks",
  "Spa discount",
  "Free parking",
  "Laundry service",
  "Tour guide assistance",
  "Complimentary dinner",
];
const DISCOUNT_CHIPS = [0, 5, 10, 15, 20];
const MAX_EXTRAS = 500;
const MAX_NOTES = 1000;

/** Same night count the server uses when it prices the claim. */
function nightsFor(gs: AvailableGroupStay): number {
  if (!gs.checkIn || !gs.checkOut) return 1;
  return Math.max(1, Math.ceil((new Date(gs.checkOut).getTime() - new Date(gs.checkIn).getTime()) / 86_400_000));
}

const money = (n: number) => Math.round(n * 100) / 100;
/** Nightly price after the group discount, rounded like the server. */
const afterDiscount = (price: number, discount: number) => money(Math.max(0, price - money(price * (discount / 100))));

function hasMyClaim(gs: AvailableGroupStay): boolean {
  return gs.hasOwnerClaim ?? Boolean(gs.ownerClaims?.some((c) => ACTIVE_CLAIM.includes(c.status)));
}

/** What other owners have offered so far, as the nightly price the guest would pay. */
function marketOf(gs: AvailableGroupStay) {
  const others = (gs.otherClaims ?? gs.existingClaims ?? []).filter((c) => ["PENDING", "REVIEWING"].includes(c.status));
  const prices = others.map((c) => afterDiscount(Number(c.offeredPricePerNight) || 0, Number(c.discountPercent) || 0)).filter((p) => p > 0).sort((a, b) => a - b);
  return { count: others.length, lowest: prices[0] ?? null, prices };
}

function placeOf(gs: AvailableGroupStay): string {
  return [gs.toLocation, gs.toDistrict, gs.toRegion].filter(Boolean).map((p) => placeName(p as string)).slice(0, 2).join(", ") || placeName(gs.toRegion);
}

/** Plain reasons a property cannot host this group. Mirrors the server checks. */
function reasonsFor(property: Property, gs: AvailableGroupStay): string[] {
  const reasons: string[] = [];
  if (!propertyAllowsGroupStay(property)) reasons.push("Group stays are not switched on for this property");
  if (!isAccommodationCompatible(gs.accommodationType, property.type)) reasons.push(`It is a ${describeAccommodationType(property.type)}; the group asked for a ${describeAccommodationType(gs.accommodationType)}`);
  const region = normalizeText(gs.toRegion);
  if (region && normalizeText(property.regionName) !== region) reasons.push(`It is in ${property.regionName || "another region"}; the group is going to ${placeName(gs.toRegion)}`);
  const district = normalizeDistrictName(gs.toDistrict);
  if (district) {
    const own = normalizeDistrictName(property.district);
    if (!own) reasons.push("The property has no district on record");
    else if (own !== district) reasons.push(`It is not in ${placeName(gs.toDistrict)} district`);
  }
  const minStar = typeof gs.minHotelStar === "number" ? gs.minHotelStar : null;
  if (minStar) {
    const star = hotelStarLabelToNumber(property.hotelStar);
    if (!star) reasons.push(`The group needs ${minStar} stars or more; this property has no star rating`);
    else if (star < minStar) reasons.push(`The group needs ${minStar} stars or more; this property is ${star}`);
  }
  return reasons;
}

function timeLeft(deadline: string | null, now: number) {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { ms: 0, text: "Closed", tone: "bg-slate-100 text-slate-500 ring-slate-200" };
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const text = d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m ${String(s).padStart(2, "0")}s left`;
  const tone = ms < 86_400_000 ? "bg-rose-50 text-rose-700 ring-rose-200" : ms < 3 * 86_400_000 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-600 ring-slate-200";
  return { ms, text, tone };
}

export default function OwnerClaimBookingPage() {
  const [groupStays, setGroupStays] = useState<AvailableGroupStay[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedAccommodation, setSelectedAccommodation] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [offerFor, setOfferFor] = useState<AvailableGroupStay | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [groupStaysRes, propertiesRes] = await Promise.all([
        api.get("/api/owner/group-stays/claims/available"),
        api.get("/api/owner/properties/mine", { params: { status: "APPROVED" } }),
      ]);
      setGroupStays(groupStaysRes.data.items || []);
      const props = Array.isArray(propertiesRes.data) ? propertiesRes.data : propertiesRes.data?.items || [];
      setProperties(props as Property[]);
    } catch (err) {
      console.error("Failed to load data:", err);
      setGroupStays([]);
      setProperties([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const regions = useMemo(() => Array.from(new Set(groupStays.map((gs) => gs.toRegion).filter(Boolean))).sort(), [groupStays]);
  const accommodationTypes = useMemo(() => Array.from(new Set(groupStays.map((gs) => gs.accommodationType).filter(Boolean))).sort(), [groupStays]);

  const open = groupStays.filter((gs) => !hasMyClaim(gs) && (timeLeft(gs.submissionDeadline, now)?.ms ?? 1) > 0);
  const shown = open
    .filter((gs) => (!selectedRegion || gs.toRegion === selectedRegion) && (!selectedAccommodation || gs.accommodationType === selectedAccommodation))
    .sort((a, b) => (a.submissionDeadline ? new Date(a.submissionDeadline).getTime() : Infinity) - (b.submissionDeadline ? new Date(b.submissionDeadline).getTime() : Infinity));
  const offered = groupStays.length - groupStays.filter((gs) => !hasMyClaim(gs)).length;
  const closingSoon = open.filter((gs) => (timeLeft(gs.submissionDeadline, now)?.ms ?? Infinity) < 86_400_000).length;
  const filterField = "h-10 min-w-0 flex-1 cursor-pointer rounded-xl border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#02665e] sm:max-w-[240px]";

  return (
    <div className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <GroupStaysBand
        title="Open to claim"
        subtitle="Groups looking for a place to stay. Send a price from one of your properties; NoLSAF chooses the best offer."
        actions={
          <Link href="/owner/group-stays/claims/my-claims" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white no-underline hover:bg-white/[0.12]">
            <FileText className="h-4 w-4" aria-hidden /> My claims <ArrowRight className="h-4 w-4 opacity-70" aria-hidden />
          </Link>
        }
        stats={[
          { label: "Open to you", value: loading ? "…" : open.length, hint: "you have not offered yet", tone: "text-[#5eead4]" },
          { label: "Closing within 24h", value: loading ? "…" : closingSoon, hint: "send your offer soon", tone: closingSoon ? "text-rose-300" : "text-white/50" },
          { label: "Already offered", value: loading ? "…" : offered, hint: "see My claims" },
        ]}
      />

      <section aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-2xl border border-solid border-slate-200 bg-white p-3">
        <span className="inline-flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-400"><Filter className="h-3.5 w-3.5" aria-hidden /> Filter</span>
        <label className="sr-only" htmlFor="gs-region">Region</label>
        <select id="gs-region" value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)} className={filterField}>
          <option value="">All regions</option>
          {regions.map((region) => <option key={region} value={region}>{placeName(region)}</option>)}
        </select>
        <label className="sr-only" htmlFor="gs-accommodation">Accommodation</label>
        <select id="gs-accommodation" value={selectedAccommodation} onChange={(e) => setSelectedAccommodation(e.target.value)} className={filterField}>
          <option value="">All accommodation</option>
          {accommodationTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
        </select>
        {(selectedRegion || selectedAccommodation) && (
          <button type="button" onClick={() => { setSelectedRegion(""); setSelectedAccommodation(""); }} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-transparent px-2 text-xs font-bold text-[#02665e] hover:bg-emerald-50">
            <XCircle className="h-4 w-4" aria-hidden /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">{loading ? "Loading" : `${shown.length} of ${open.length} shown`}</span>
      </section>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-72 rounded-2xl border border-solid border-slate-200 bg-white" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-solid border-slate-200 bg-white px-6 py-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-[#02665e]"><HandHeart className="h-7 w-7" aria-hidden /></span>
          <p className="m-0 mt-4 text-base font-bold text-slate-900">{open.length === 0 ? "No groups are looking right now" : "No group matches these filters"}</p>
          <p className="m-0 mt-1 max-w-md text-sm leading-6 text-slate-500">
            {open.length === 0 ? "New group requests appear here as soon as NoLSAF opens them for offers." : "Try another region or accommodation type, or clear the filters."}
          </p>
          {open.length === 0 ? (
            <Link href="/owner/group-stays/claims/my-claims" className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50">
              <FileText className="h-4 w-4" aria-hidden /> Check my claims
            </Link>
          ) : (
            <button type="button" onClick={() => { setSelectedRegion(""); setSelectedAccommodation(""); }} className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-bold text-white hover:bg-[#014d47]">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shown.map((gs) => {
            const left = timeLeft(gs.submissionDeadline, now);
            const market = marketOf(gs);
            const nights = nightsFor(gs);
            const fits = properties.filter((p) => reasonsFor(p, gs).length === 0).length;
            return (
              <article key={gs.id} className="flex flex-col overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_12px_32px_-28px_rgba(15,23,42,0.6)]">
                <div className="flex-1 p-5">
                  <div className="flex items-start gap-3.5">
                    <DateTile iso={gs.checkIn} />
                    <div className="min-w-0 flex-1">
                      <h3 className="m-0 text-lg font-bold leading-snug text-slate-900">Group of {gs.headcount}{gs.groupType ? <span className="font-semibold text-slate-400"> · {humanize(gs.groupType)}</span> : null}</h3>
                      <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{placeOf(gs)}</p>
                    </div>
                    {left && <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ring-1 ring-inset ${left.tone}`}><Clock3 className="h-3.5 w-3.5" aria-hidden />{left.text}</span>}
                  </div>

                  <dl className="m-0 mt-4 grid grid-cols-4 overflow-hidden rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200">
                    {[
                      { label: "Guests", value: gs.headcount },
                      { label: "Rooms", value: gs.roomsNeeded },
                      { label: "Nights", value: nights },
                      { label: "Room nights", value: gs.roomsNeeded * nights },
                    ].map((fact, index) => (
                      <div key={fact.label} className={`min-w-0 px-3 py-2.5 ${index > 0 ? "border-0 border-l border-solid border-slate-200" : ""}`}>
                        <dt className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{fact.label}</dt>
                        <dd className="m-0 mt-0.5 text-lg font-extrabold tabular-nums text-slate-900">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="m-0 mt-3 text-xs text-slate-600">{fmtDay(gs.checkIn)} to {fmtDay(gs.checkOut)}</p>

                  <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
                    <li className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"><Building2 className="h-3 w-3" aria-hidden />{humanize(gs.accommodationType) || "Any stay"}</li>
                    {gs.minHotelStar ? <li className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"><Star className="h-3 w-3" aria-hidden />{gs.minHotelStar} stars or more</li> : null}
                    {gs.minDiscountPercent ? <li className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200"><Percent className="h-3 w-3" aria-hidden />At least {gs.minDiscountPercent}% off</li> : null}
                  </ul>

                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-slate-200 px-3.5 py-2.5">
                    <TrendingDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    {market.lowest !== null ? (
                      <p className="m-0 text-xs text-slate-600">
                        <strong className="text-slate-900">{market.count} offer{market.count === 1 ? "" : "s"}</strong> so far. Lowest is <strong className="tabular-nums text-slate-900">{tzs(market.lowest, gs.currency)}</strong> a room a night.
                      </p>
                    ) : (
                      <p className="m-0 text-xs text-slate-600"><strong className="text-slate-900">No offers yet.</strong> Yours would be the first.</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-3">
                  <span className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold ${fits ? "text-emerald-700" : "text-slate-500"}`}>
                    {fits ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <span className="truncate">{fits ? `${fits} of your properties fit` : "None of your properties fit yet"}</span>
                  </span>
                  <button type="button" onClick={() => setOfferFor(gs)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-bold text-white hover:bg-[#014d47]">
                    {fits ? "Make an offer" : "See why"} <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {offerFor && (
        <OfferBuilder
          gs={offerFor}
          properties={properties}
          now={now}
          onClose={() => setOfferFor(null)}
          onSent={() => {
            setOfferFor(null);
            void loadData();
          }}
        />
      )}
    </div>
  );
}

const STEPS = ["Property", "Price", "Extras and note"];

function OfferBuilder({ gs, properties, now, onClose, onSent }: { gs: AvailableGroupStay; properties: Property[]; now: number; onClose: () => void; onSent: () => void }) {
  const minDiscount = gs.minDiscountPercent && gs.minDiscountPercent > 0 ? gs.minDiscountPercent : 0;
  const [step, setStep] = useState(0);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState(String(minDiscount));
  const [extras, setExtras] = useState<string[]>([]);
  const [customExtras, setCustomExtras] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnfit, setShowUnfit] = useState(false);

  const rated = useMemo(() => properties.map((p) => ({ property: p, reasons: reasonsFor(p, gs) })), [properties, gs]);
  const fit = rated.filter((r) => r.reasons.length === 0);
  const unfit = rated.filter((r) => r.reasons.length > 0);
  const chosen = properties.find((p) => p.id === propertyId) ?? null;

  // Pick the only match straight away.
  useEffect(() => {
    if (propertyId === null && fit.length === 1) choose(fit[0].property);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  function choose(p: Property) {
    setPropertyId(p.id);
    if (p.basePrice && !price) setPrice(String(p.basePrice));
  }

  const nights = nightsFor(gs);
  const rooms = Math.max(1, gs.roomsNeeded || 1);
  const priceNum = Number(price) || 0;
  const discountNum = Number(discount) || 0;
  const nightly = afterDiscount(priceNum, discountNum);
  const total = money(nightly * nights * rooms);
  const market = marketOf(gs);
  const left = timeLeft(gs.submissionDeadline, now);
  const extrasText = [...extras, ...customExtras.split(",").map((x) => x.trim()).filter(Boolean)].join(", ");

  const priceError = !price ? "Enter a price a room a night" : priceNum <= 0 ? "The price must be more than zero" : null;
  const discountError = discountNum < 0 || discountNum > 100 ? "Use a discount between 0 and 100%" : minDiscount && discountNum < minDiscount ? `This group needs at least ${minDiscount}% off` : null;
  const stepError = step === 0 ? (!propertyId ? "Choose the property that will host the group" : null) : step === 1 ? priceError || discountError : extrasText.length > MAX_EXTRAS ? `Extras must stay under ${MAX_EXTRAS} characters` : null;

  const position = market.lowest !== null && nightly > 0
    ? nightly <= market.lowest
      ? { tone: "bg-emerald-50 text-emerald-800 ring-emerald-200", text: nightly < market.lowest ? `You would be the lowest offer, ${tzs(market.lowest - nightly, gs.currency)} under the next one.` : "You would match the lowest offer." }
      : { tone: "bg-amber-50 text-amber-900 ring-amber-200", text: `${tzs(nightly - market.lowest, gs.currency)} (${Math.round(((nightly - market.lowest) / market.lowest) * 100)}%) above the lowest offer.` }
    : null;
  const vsListed = chosen?.basePrice && nightly > 0 ? Math.round(((chosen.basePrice - nightly) / chosen.basePrice) * 100) : null;

  // Set the base price so the guest pays exactly the target nightly price after the discount.
  const priceFor = (target: number) => {
    const base = discountNum > 0 && discountNum < 100 ? target / (1 - discountNum / 100) : target;
    setPrice(String(Math.max(1, Math.round(base))));
  };

  const next = () => {
    if (stepError) { setError(stepError); return; }
    setError(null);
    setStep((s) => Math.min(2, s + 1));
  };

  const send = async () => {
    const problem = (!propertyId && "Choose the property that will host the group") || priceError || discountError || (extrasText.length > MAX_EXTRAS ? `Extras must stay under ${MAX_EXTRAS} characters` : null);
    if (problem) { setError(problem); return; }
    setSending(true);
    setError(null);
    try {
      await api.post("/api/owner/group-stays/claims", {
        groupBookingId: gs.id,
        propertyId,
        offeredPricePerNight: priceNum,
        discountPercent: discountNum > 0 ? discountNum : null,
        specialOffers: extrasText || null,
        notes: notes.trim() || null,
      });
      window.dispatchEvent(new CustomEvent("nols:toast", { detail: { type: "success", title: "Offer sent", message: "NoLSAF will review it with the other offers. Follow it under My claims.", duration: 5000 } }));
      onSent();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Your offer could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const field = "box-border w-full rounded-xl border border-solid border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Make an offer" onClick={() => !sending && onClose()}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="bg-[#012a26] px-5 pb-4 pt-5 text-white sm:px-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Make an offer</p>
              <h2 className="m-0 mt-1 text-xl font-bold leading-tight sm:text-2xl">Group of {gs.headcount} in {placeOf(gs)}</h2>
              <p className="m-0 mt-1 text-xs text-white/60">{fmtDay(gs.checkIn)} to {fmtDay(gs.checkOut)} · {nights} night{nights === 1 ? "" : "s"} · {rooms} room{rooms === 1 ? "" : "s"} · {humanize(gs.accommodationType) || "Any stay"}</p>
            </div>
            {left && <span className="hidden shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-white/85 sm:inline-flex"><Clock3 className="h-3.5 w-3.5" aria-hidden />{left.text}</span>}
            <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border-0 bg-white/10 text-white hover:bg-white/20"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <ol className="m-0 mt-4 flex list-none gap-2 p-0">
            {STEPS.map((label, index) => {
              const done = index < step;
              const current = index === step;
              return (
                <li key={label} className="min-w-0 flex-1">
                  <button type="button" disabled={index > step} onClick={() => { setError(null); setStep(index); }} className="w-full border-0 bg-transparent p-0 text-left disabled:cursor-default">
                    <span className={`block h-1 rounded-full ${done || current ? "bg-[#5eead4]" : "bg-white/15"}`} />
                    <span className={`mt-1.5 flex items-center gap-1.5 truncate text-xs font-semibold ${current ? "text-white" : done ? "text-[#5eead4]" : "text-white/40"}`}>
                      {done ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <span className="tabular-nums">{index + 1}.</span>}{label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-7">
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h3 className="m-0 text-base font-bold text-slate-900">Which property will host them?</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">Only properties that meet everything the group asked for can send an offer.</p>
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {[
                    `A ${describeAccommodationType(gs.accommodationType)}`,
                    `In ${placeOf(gs)}`,
                    gs.minHotelStar ? `${gs.minHotelStar} stars or more` : null,
                    "Group stays switched on",
                  ].filter(Boolean).map((need) => (
                    <li key={need as string} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200"><Check className="h-3 w-3 text-[#02665e]" aria-hidden />{need}</li>
                  ))}
                </ul>

                {fit.length > 0 ? (
                  <div className="space-y-2" role="radiogroup" aria-label="Property">
                    {fit.map(({ property }) => {
                      const on = propertyId === property.id;
                      return (
                        <button key={property.id} type="button" role="radio" aria-checked={on} onClick={() => choose(property)} className={`flex w-full items-center gap-3 rounded-2xl border border-solid p-4 text-left transition ${on ? "border-[#02665e] bg-emerald-50/50 ring-1 ring-[#02665e]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-solid ${on ? "border-[#02665e] bg-[#02665e]" : "border-slate-300 bg-white"}`}>{on ? <span className="h-2 w-2 rounded-full bg-white" /> : null}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-slate-900">{property.title}</span>
                            <span className="block truncate text-xs text-slate-500">{humanize(property.type)} · {[property.district, property.regionName].filter(Boolean).join(", ")}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-bold tabular-nums text-slate-900">{property.basePrice ? tzs(property.basePrice, property.currency) : "No price"}</span>
                            <span className="block text-[11px] text-slate-400">listed a night</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
                    <p className="m-0 flex items-center gap-2 text-sm font-bold text-amber-900"><CircleAlert className="h-4 w-4" aria-hidden />None of your properties can host this group yet</p>
                    <p className="m-0 mt-1 text-xs leading-5 text-amber-900/80">Each property below shows what is missing. Fix it in the listing and come back before the offers close.</p>
                    <Link href="/owner/properties/approved" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold text-amber-900 no-underline ring-1 ring-inset ring-amber-300 hover:bg-amber-100">Open My listings <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
                  </div>
                )}

                {unfit.length > 0 && (
                  <div>
                    {fit.length > 0 && (
                      <button type="button" onClick={() => setShowUnfit((v) => !v)} className="border-0 bg-transparent p-0 text-xs font-bold text-slate-500 hover:text-slate-800">
                        {showUnfit ? "Hide" : "Show"} {unfit.length} propert{unfit.length === 1 ? "y" : "ies"} that do not fit
                      </button>
                    )}
                    {(showUnfit || fit.length === 0) && (
                      <ul className="m-0 mt-2 list-none space-y-2 p-0">
                        {unfit.map(({ property, reasons }) => (
                          <li key={property.id} className="rounded-2xl border border-solid border-slate-200 bg-slate-50/60 p-4">
                            <p className="m-0 truncate text-sm font-semibold text-slate-500">{property.title}</p>
                            <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                              {reasons.map((reason) => <li key={reason} className="flex items-start gap-1.5 text-xs text-slate-600"><XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden />{reason}</li>)}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="m-0 text-base font-bold text-slate-900">Set your price</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">The price is for one room for one night. The total is worked out for {rooms} room{rooms === 1 ? "" : "s"} over {nights} night{nights === 1 ? "" : "s"}.</p>
                </div>

                <div>
                  <label htmlFor="offer-price" className="text-xs font-bold text-slate-700">Price a room a night</label>
                  <div className="relative mt-1.5">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">{gs.currency === "TZS" ? "TSh" : gs.currency}</span>
                    <input id="offer-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={`${field} h-14 pl-14 text-2xl font-extrabold tabular-nums`} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {chosen?.basePrice ? (
                      <button type="button" onClick={() => setPrice(String(chosen.basePrice))} className="rounded-full border border-solid border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:border-[#02665e]/40 hover:text-[#02665e]">Use listed price {tzs(chosen.basePrice, chosen.currency)}</button>
                    ) : null}
                    {market.lowest !== null && (
                      <>
                        <button type="button" onClick={() => priceFor(market.lowest!)} className="rounded-full border border-solid border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:border-[#02665e]/40 hover:text-[#02665e]">Match the lowest offer</button>
                        <button type="button" onClick={() => priceFor(market.lowest! * 0.97)} className="rounded-full border border-solid border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:border-[#02665e]/40 hover:text-[#02665e]">Beat it by 3%</button>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <p className="m-0 text-xs font-bold text-slate-700">Group discount</p>
                  {minDiscount ? <p className="m-0 mt-0.5 text-xs text-violet-700">This group needs at least {minDiscount}% off.</p> : <p className="m-0 mt-0.5 text-xs text-slate-500">Optional. A discount shows the group a saving against your price.</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {DISCOUNT_CHIPS.filter((d) => d >= minDiscount || d === 0).map((d) => {
                      const blocked = d < minDiscount;
                      const on = discountNum === d;
                      return (
                        <button key={d} type="button" disabled={blocked} onClick={() => setDiscount(String(d))} className={`h-9 rounded-xl border border-solid px-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                          {d === 0 ? "None" : `${d}%`}
                        </button>
                      );
                    })}
                    <label className="relative">
                      <span className="sr-only">Other discount</span>
                      <input inputMode="decimal" value={DISCOUNT_CHIPS.includes(discountNum) ? "" : discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other" className={`${field} h-9 w-24 pr-7`} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                    </label>
                  </div>
                  {discountError && price ? <p className="m-0 mt-2 text-xs font-semibold text-rose-600">{discountError}</p> : null}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="m-0 text-xs font-bold text-slate-500">The group pays a room a night</p>
                    <p className="m-0 text-xl font-extrabold tabular-nums text-slate-900">{tzs(nightly, gs.currency)}</p>
                  </div>
                  {vsListed !== null && vsListed !== 0 ? <p className="m-0 mt-1 text-xs text-slate-500">{vsListed > 0 ? `${vsListed}% below` : `${Math.abs(vsListed)}% above`} your listed price.</p> : null}
                  {position ? (
                    <p className={`m-0 mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ring-inset ${position.tone}`}><TrendingDown className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{position.text}</p>
                  ) : market.lowest === null ? (
                    <p className="m-0 mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">No other offers yet. Yours sets the pace.</p>
                  ) : null}
                  {market.prices.length > 0 && nightly > 0 && (
                    <PriceStrip prices={market.prices} mine={nightly} currency={gs.currency} />
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h3 className="m-0 text-base font-bold text-slate-900">What comes with your offer?</h3>
                  <p className="m-0 mt-1 text-xs text-slate-500">Extras can make your offer stand out. Only add what you will really give the group.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EXTRAS.map((extra) => {
                    const on = extras.includes(extra);
                    return (
                      <button key={extra} type="button" aria-pressed={on} onClick={() => setExtras((list) => (on ? list.filter((x) => x !== extra) : [...list, extra]))} className={`flex min-h-10 items-center gap-2 rounded-xl border border-solid px-3 py-2 text-left text-xs font-semibold transition ${on ? "border-[#02665e] bg-emerald-50 text-[#02665e]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border border-solid ${on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white"}`}>{on ? <Check className="h-3 w-3" aria-hidden /> : null}</span>
                        {extra}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label htmlFor="offer-extras" className="text-xs font-bold text-slate-700">Anything else? <span className="font-normal text-slate-400">Separate with commas</span></label>
                  <input id="offer-extras" value={customExtras} onChange={(e) => setCustomExtras(e.target.value)} placeholder="e.g. Conference room for one day" className={`${field} mt-1.5 h-11`} />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="offer-notes" className="text-xs font-bold text-slate-700">Note for the NoLSAF team <span className="font-normal text-slate-400">Optional</span></label>
                    <span className={`text-[11px] tabular-nums ${notes.length > MAX_NOTES * 0.9 ? "text-amber-600" : "text-slate-400"}`}>{notes.length}/{MAX_NOTES}</span>
                  </div>
                  <textarea id="offer-notes" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))} rows={4} placeholder="Room layout, how close you are to their plans, anything that helps them choose you" className={`${field} mt-1.5 resize-none py-3 leading-6`} />
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          <aside className="hidden min-h-0 overflow-y-auto border-0 border-l border-solid border-slate-100 bg-slate-50/70 p-6 lg:block">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Your offer</p>
            <p className="m-0 mt-2 truncate text-sm font-bold text-slate-900">{chosen?.title ?? "No property chosen"}</p>
            <dl className="m-0 mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Price a room a night</dt><dd className="m-0 font-semibold tabular-nums text-slate-800">{priceNum ? tzs(priceNum, gs.currency) : "-"}</dd></div>
              {discountNum > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-500">Discount {discountNum}%</dt><dd className="m-0 font-semibold tabular-nums text-emerald-700">&minus;{tzs(priceNum - nightly, gs.currency)}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Group pays a night</dt><dd className="m-0 font-semibold tabular-nums text-slate-800">{nightly ? tzs(nightly, gs.currency) : "-"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{rooms} room{rooms === 1 ? "" : "s"} × {nights} night{nights === 1 ? "" : "s"}</dt><dd className="m-0 font-semibold tabular-nums text-slate-800">{rooms * nights} room nights</dd></div>
            </dl>
            <div className="mt-4 border-0 border-t border-dashed border-slate-300 pt-4">
              <p className="m-0 text-xs font-bold text-slate-500">Total offer</p>
              <p className="m-0 mt-1 text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-[#02665e]">{tzs(total, gs.currency)}</p>
            </div>
            {(extras.length > 0 || customExtras.trim()) && (
              <div className="mt-5">
                <p className="m-0 text-xs font-bold text-slate-500">Extras</p>
                <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                  {extrasText.split(", ").filter(Boolean).map((x) => <li key={x} className="flex items-center gap-1.5 text-xs text-slate-700"><Check className="h-3 w-3 shrink-0 text-[#02665e]" aria-hidden /><span className="truncate">{x}</span></li>)}
                </ul>
              </div>
            )}
            <p className="m-0 mt-6 text-[11px] leading-5 text-slate-400">NoLSAF checks the total again when you send. You can send one offer for each group.</p>
          </aside>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-200 bg-white px-5 py-3.5 sm:px-7">
          <div className="min-w-0 flex-1">
            {error ? (
              <p className="m-0 flex items-start gap-1.5 text-xs font-semibold text-rose-600"><CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}</p>
            ) : (
              <p className="m-0 text-xs text-slate-500 lg:hidden">Total <strong className="tabular-nums text-slate-900">{tzs(total, gs.currency)}</strong></p>
            )}
          </div>
          {step > 0 && (
            <button type="button" onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={sending} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
          )}
          {step < 2 ? (
            <button type="button" onClick={next} disabled={step === 0 && fit.length === 0} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50">
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button type="button" onClick={() => void send()} disabled={sending} className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-bold text-white hover:bg-[#014d47] disabled:opacity-60">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <HandHeart className="h-4 w-4" aria-hidden />}
              {sending ? "Sending..." : `Send offer of ${tzs(total, gs.currency)}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Where your nightly price lands among the other offers, lowest on the left. */
function PriceStrip({ prices, mine, currency }: { prices: number[]; mine: number; currency: string }) {
  const all = [...prices, mine];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const at = (p: number) => (hi === lo ? 50 : ((p - lo) / (hi - lo)) * 100);
  return (
    <div className="mt-4">
      <div className="relative h-8">
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200" />
        {prices.map((p, index) => (
          <span key={index} title={tzs(p, currency)} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400 ring-2 ring-white" style={{ left: `${at(p)}%` }} />
        ))}
        <span className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#02665e] ring-[3px] ring-white" style={{ left: `${at(mine)}%` }} aria-label="Your price" />
      </div>
      <div className="flex justify-between text-[10.5px] tabular-nums text-slate-400">
        <span>{tzs(lo, currency)}</span>
        <span className="flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" />Other offers</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#02665e]" />You</span></span>
        <span>{tzs(hi, currency)}</span>
      </div>
    </div>
  );
}
