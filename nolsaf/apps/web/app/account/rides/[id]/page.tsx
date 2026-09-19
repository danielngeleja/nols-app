"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import {
  ArrowLeft,
  Phone,
  Navigation,
  MessageCircle,
  AlertCircle,
  Car,
  Calendar,
  Clock,
  Banknote,
  CheckCircle,
  XCircle,
  Loader2,
  Plane,
  Bus,
  Train,
  Ship,
  Building2,
  ExternalLink,
  Star,
  BadgeCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import TransportChat from "@/components/TransportChat";

const api = apiClient;

type Ride = {
  id: number;
  rideReference: string;
  status: string;
  vehicleType?: string;
  scheduledDate: string;
  pickupTime?: string;
  dropoffTime?: string;
  fromAddress?: string;
  fromLatitude?: number;
  fromLongitude?: number;
  toAddress?: string;
  toLatitude?: number;
  toLongitude?: number;
  amount?: number;
  currency?: string;
  arrivalType?: string;
  arrivalNumber?: string;
  transportCompany?: string;
  arrivalTime?: string;
  pickupLocation?: string;
  numberOfPassengers?: number;
  notes?: string;
  user?: { id: number; name: string; email?: string; phone?: string };
  driver?: {
    id: number;
    name: string | null;
    email?: string | null;
    phone?: string | null;
    avatarUrl?: string | null;
    plateNumber?: string | null;
    vehiclePlate?: string | null;
    vehicleType?: string | null;
    vehicleMake?: string | null;
    rating?: number | null;
    isVipDriver?: boolean;
    operationArea?: string | null;
    district?: string | null;
    region?: string | null;
  };
  property?: { id: number; title: string; regionName?: string; district?: string };
  paymentStatus?: string;
  createdAt: string;
  updatedAt: string;
};

/* --- helpers --- */
function getStatusMeta(status: string) {
  const s = status.toLowerCase();
  if (s.includes("completed"))
    return { label: "Completed", icon: <CheckCircle className="h-4 w-4" /> };
  if (s.includes("cancel"))
    return { label: "Cancelled", icon: <XCircle className="h-4 w-4" /> };
  if (s.includes("in_progress") || s.includes("assigned"))
    return { label: status.replace(/_/g, " "), icon: <Loader2 className="h-4 w-4 animate-spin" /> };
  if (s.includes("pending"))
    return { label: status.replace(/_/g, " "), icon: <Clock className="h-4 w-4" /> };
  return { label: status.replace(/_/g, " "), icon: <Car className="h-4 w-4" /> };
}

function arrivalIcon(type?: string) {
  if (!type) return <Car className="h-5 w-5" />;
  const t = type.toUpperCase();
  if (t === "FLIGHT") return <Plane className="h-5 w-5" />;
  if (t === "BUS") return <Bus className="h-5 w-5" />;
  if (t === "TRAIN") return <Train className="h-5 w-5" />;
  if (t === "FERRY") return <Ship className="h-5 w-5" />;
  return <Car className="h-5 w-5" />;
}

type DriverBioInput = {
  name?: string | null;
  rating?: number | null;
  isVipDriver?: boolean;
  operationArea?: string | null;
  district?: string | null;
  vehicleMake?: string | null;
};

function pickExtendedBio(d: DriverBioInput): string {
  const first = (d.name ?? "").split(" ")[0] || "Your driver";
  if (d.isVipDriver)
    return `Exclusively trained for executive and long-distance travel, ${first} is one of NoLSAF\u2019s Premium-certified specialists. Clients receive complete discretion, immaculate presentation, and an on-time arrival record that only genuine professionalism builds. Expect first-class service on every journey.`;
  if (d.rating != null && d.rating >= 4.5)
    return `With a near-perfect rating earned across hundreds of journeys, ${first} has built a reputation that only consistent excellence creates. Composed under any condition, communicative when it counts, and unfailingly punctual, ${first} is the standard every NoLSAF driver aspires to.`;
  const area = d.operationArea || d.district;
  if (area)
    return `Nobody reads ${area} the way ${first} does. Every route is mentally mapped before the journey begins: peak-hour shortcuts, alternate roads, and the local instinct to adapt on the spot. Passengers arrive relaxed, on time, and in the best possible hands.`;
  if (d.vehicleMake)
    return `Behind the wheel of a ${d.vehicleMake}, ${first} treats every trip as a VIP assignment. The vehicle is inspected before each journey, kept spotless inside and out, and driven with the steady care that tells a passenger they are exactly where they should be.`;
  return `Background-checked, fully licensed, and trusted by hundreds of NoLSAF passengers across Tanzania. ${first} brings calm conviction to every route. From pickup to drop-off, reliability is not a policy here; it is simply how ${first} works, every single time.`;
}

export default function RideDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rideId = String((params as any)?.id ?? "");
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [cardFlipped, setCardFlipped] = useState(false);

  useEffect(() => {
    fetchAccountSession().then((res) => setCurrentUserId(res.data?.id || null)).catch(() => {});
    if (!rideId) {
      setError("This ride link is invalid.");
      setLoading(false);
      return;
    }

    api.get(`/api/transport-bookings/${encodeURIComponent(rideId)}`)
      .then((res) => {
        const next = res.data as Ride;
        setRide(next);
        if (/^\d+$/.test(rideId) && next.rideReference) {
          router.replace(`/account/rides/${encodeURIComponent(next.rideReference)}`);
        }
      })
      .catch((err) => setError(err?.response?.data?.error || "Failed to load ride details"))
      .finally(() => setLoading(false));
  }, [rideId, router]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const formatTime = (t?: string) =>
    t ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "N/A";

  /* --- Loading --- */
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading ride</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-4 h-7 w-64 rounded-lg bg-white/15" />
          <div className="mt-3 h-3 w-48 rounded bg-white/10" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-72 rounded-2xl border border-solid border-slate-200 bg-white" />
          <div className="space-y-4">
            <div className="h-60 rounded-2xl bg-[#0a1110]/90" />
            <div className="h-32 rounded-2xl border border-solid border-slate-200 bg-white" />
          </div>
        </div>
      </div>
    );
  }

  /* --- Error --- */
  if (error || !ride) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col items-center rounded-2xl border border-solid border-rose-200 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <AlertCircle className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="m-0 mt-3 text-[17px] font-bold text-slate-900">Ride not found</h2>
          <p className="m-0 mt-1 text-sm text-slate-500">{error || "We could not load this ride."}</p>
          <Link
            href="/account/rides"
            className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to my rides
          </Link>
        </div>
      </div>
    );
  }

  const meta = getStatusMeta(ride.status);
  const statusText = /pending/i.test(ride.status) && !ride.driver ? "Finding your driver" : meta.label.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const human = (v?: string | null) => String(v || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const destination = ride.property?.title || ride.toAddress || "your destination";
  const arrivalWord =
    ride.arrivalType === "FLIGHT" ? "Flight" : ride.arrivalType === "BUS" ? "Bus" : ride.arrivalType === "TRAIN" ? "Train" : ride.arrivalType === "FERRY" ? "Ferry" : "Transport";
  const tripSpecs = [
    { label: "Date", value: formatDate(ride.scheduledDate) },
    { label: "Pickup", value: ride.pickupTime ? formatTime(ride.pickupTime) : null },
    { label: "Drop-off", value: ride.dropoffTime ? formatTime(ride.dropoffTime) : null },
    { label: "Vehicle", value: ride.vehicleType ? human(ride.vehicleType) : null },
    { label: "Passengers", value: ride.numberOfPassengers ? String(ride.numberOfPassengers) : null },
  ].filter((x) => x.value);
  const arrivalSpecs = [
    { label: "Arriving by", value: ride.arrivalType ? human(ride.arrivalType) : null },
    { label: `${arrivalWord} number`, value: ride.arrivalNumber || null },
    {
      label: ride.arrivalType === "FLIGHT" ? "Airline" : ride.arrivalType === "BUS" ? "Bus company" : ride.arrivalType === "TRAIN" ? "Train operator" : ride.arrivalType === "FERRY" ? "Ferry operator" : "Company",
      value: ride.transportCompany || null,
    },
    { label: "Arrival time", value: ride.arrivalTime ? formatTime(ride.arrivalTime) : null },
    { label: "Meeting point", value: ride.pickupLocation || null },
  ].filter((x) => x.value);
  const paid = ride.paymentStatus === "PAID";

  const SpecStrip = ({ items }: { items: Array<{ label: string; value: string | null }> }) => (
    <div className="grid grid-cols-2 border-0 border-t border-solid border-slate-100 sm:grid-cols-3">
      {items.map((sp, i) => (
        <div
          key={sp.label}
          className={[
            "min-w-0 px-5 py-3",
            i % 2 === 1 ? "border-0 border-l border-solid border-slate-100 sm:border-l-0" : "",
            i % 3 !== 0 ? "sm:border-0 sm:border-l sm:border-solid sm:border-slate-100" : "",
            i >= 2 ? "border-0 border-t border-solid border-slate-100" : "",
            i < 3 ? "sm:border-t-0" : "sm:border-t",
          ].join(" ")}
        >
          <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">{sp.label}</div>
          <div className="mt-0.5 truncate text-[13.5px] font-semibold text-slate-900" title={String(sp.value)}>{sp.value}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {/* --- Header band --- */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <Link href="/account/rides" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white/60 no-underline transition-colors hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden /> My rides
          </Link>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 min-w-0 break-words text-[24px] font-bold leading-tight text-white sm:text-[28px]">Ride to {destination}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-bold text-white ring-1 ring-inset ring-white/15">
                  {meta.icon}
                  {statusText}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-white/60">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#5ec8bb]" aria-hidden />
                  {formatDate(ride.scheduledDate)}
                </span>
                {ride.pickupTime ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#5ec8bb]" aria-hidden />
                    Pickup {formatTime(ride.pickupTime)}
                  </span>
                ) : null}
                <span className="text-white/40">Ride #{ride.id}</span>
              </div>
            </div>
            {ride.vehicleType || ride.numberOfPassengers ? (
              <div className="flex-shrink-0 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-4 py-2.5 text-right">
                <div className="text-[16px] font-bold leading-none text-white">{ride.vehicleType ? human(ride.vehicleType) : "Ride"}</div>
                {ride.numberOfPassengers ? (
                  <div className="mt-1 text-[12px] text-white/60">
                    {ride.numberOfPassengers} {ride.numberOfPassengers === 1 ? "passenger" : "passengers"}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* --- Body --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left */}
        <div className="min-w-0 space-y-4">
          {/* Trip */}
          <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
            <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                <Navigation className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="m-0 text-[15px] font-bold text-slate-900">Trip</h2>
            </header>
            <div className="px-5 py-5">
              <div className="relative pl-7">
                <span aria-hidden className="absolute bottom-4 left-[7px] top-4 w-px bg-slate-200" />
                <div className="relative">
                  <span aria-hidden className="absolute -left-7 top-1 h-3.5 w-3.5 rounded-full bg-[#02665e] ring-4 ring-[#02665e]/15" />
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Pickup</div>
                  <div className="mt-0.5 text-[15px] font-bold text-slate-900">{ride.fromAddress || "Not specified"}</div>
                  {ride.fromLatitude != null && ride.fromLongitude != null ? (
                    <a
                      href={`https://www.google.com/maps?q=${ride.fromLatitude},${ride.fromLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in maps
                    </a>
                  ) : null}
                </div>
                <div className="relative mt-5">
                  <span aria-hidden className="absolute -left-7 top-1 h-3.5 w-3.5 rounded-full border-2 border-solid border-[#02665e] bg-white" />
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Drop-off</div>
                  <div className="mt-0.5 text-[15px] font-bold text-slate-900">{ride.property?.title || ride.toAddress || "Not specified"}</div>
                  {ride.toLatitude != null && ride.toLongitude != null ? (
                    <a
                      href={`https://www.google.com/maps?q=${ride.toLatitude},${ride.toLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in maps
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
            {tripSpecs.length ? <SpecStrip items={tripSpecs} /> : null}
          </section>

          {/* Arrival */}
          {arrivalSpecs.length ? (
            <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
              <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e] [&>svg]:h-4 [&>svg]:w-4">
                  {arrivalIcon(ride.arrivalType)}
                </span>
                <div>
                  <h2 className="m-0 text-[15px] font-bold text-slate-900">Your arrival</h2>
                  <p className="m-0 text-[12px] text-slate-500">The driver meets you based on these details.</p>
                </div>
              </header>
              <SpecStrip items={arrivalSpecs} />
            </section>
          ) : null}

        </div>

        {/* Right */}
        <div className="min-w-0 space-y-4">
          {!ride.driver ? (
            <section className="relative overflow-hidden rounded-2xl bg-[#0a1110] p-5 text-white" style={{ isolation: "isolate" }}>
              <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 -z-10 h-48 w-48 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.55), rgba(2,102,94,0))" }} />
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#02665e]">
                <Car className="h-5 w-5" aria-hidden />
              </span>
              <div className="mt-3 text-[16px] font-bold">Finding your driver</div>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-white/65">
                A NoLSAF driver will be assigned before your pickup. Their name, photo, vehicle and a way to reach them will appear here.
              </p>
            </section>
          ) : null}

          {/* ===== Driver Physical ID Card ===== */}
          {ride.driver && (<>
            {/* Perspective wrapper — 3D flip card LANDSCAPE */}
            <div style={{ perspective: "1200px" }}>
              <div
                className="h-[360px] sm:h-[300px] motion-reduce:[transform:none!important]"
                style={{
                  position: "relative",
                  transformStyle: "preserve-3d",
                  transition: "transform 0.7s cubic-bezier(0.4,0,0.2,1)",
                  transform: cardFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >

                {/* ── FRONT FACE — LANDSCAPE ── */}
                <div
                  style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}
                  className="rounded-[20px] overflow-hidden shadow-2xl cursor-default select-none"
                >
                  {/* bg */}
                  <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0a1110 0%, #0f1c1b 55%, #0f3a35 100%)" }} />
                  {/* left photo strip — always visible */}
                  <div className="absolute top-0 left-0 bottom-0 w-[110px] sm:w-[140px]" style={{ background: "linear-gradient(180deg, rgba(2,102,94,0.22) 0%, rgba(2,102,94,0.12) 100%)", borderRight: "1px solid rgba(5,150,105,0.18)" }} />
                  {/* decorative SVG */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 500 300" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden>
                    {/* concentric arcs top-right */}
                    <circle cx="480" cy="40" r="110" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
                    <circle cx="480" cy="40" r="78"  stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
                    <circle cx="480" cy="40" r="48"  stroke="white" strokeOpacity="0.035" strokeWidth="1" fill="none" />
                    {/* road path behind photo strip */}
                    <path d="M60 300 Q70 200 90 150 Q105 110 110 0" stroke="white" strokeOpacity="0.06" strokeWidth="24" fill="none" strokeLinecap="round" />
                    <path d="M60 300 Q70 200 90 150 Q105 110 110 0" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" strokeDasharray="10 8" fill="none" strokeLinecap="round" />
                    {/* fingerprint — centred on the right detail column ~(330,170) */}
                    <g transform="translate(310,90)" opacity="0.055">
                      {/* core loops */}
                      <ellipse cx="40" cy="80" rx="6"  ry="9"  stroke="white" strokeWidth="1.3" fill="none"/>
                      <ellipse cx="40" cy="80" rx="13" ry="17" stroke="white" strokeWidth="1.3" fill="none"/>
                      <ellipse cx="40" cy="80" rx="21" ry="27" stroke="white" strokeWidth="1.2" fill="none"/>
                      <ellipse cx="40" cy="80" rx="30" ry="38" stroke="white" strokeWidth="1.2" fill="none"/>
                      <ellipse cx="40" cy="80" rx="39" ry="49" stroke="white" strokeWidth="1.1" fill="none"/>
                      <ellipse cx="40" cy="80" rx="49" ry="60" stroke="white" strokeWidth="1.1" fill="none"/>
                      <ellipse cx="40" cy="80" rx="59" ry="71" stroke="white" strokeWidth="1.0" fill="none"/>
                      {/* open bottom arcs to give fingerprint feel */}
                      <path d="M10 130 Q40 150 70 130" stroke="white" strokeWidth="1.1" fill="none" strokeLinecap="round"/>
                      <path d="M2  118 Q40 142 78 118" stroke="white" strokeWidth="1.0" fill="none" strokeLinecap="round"/>
                      {/* centre dot */}
                      <circle cx="40" cy="80" r="2.5" fill="white"/>
                    </g>
                  </svg>
                  {/* top sheen */}
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />
                  {/* left green accent line */}
                  <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: "#02665e" }} />
                  {/* bottom green stripe */}
                  <div className="absolute bottom-0 left-[110px] sm:left-[140px] right-0 h-[3px]" style={{ background: "#02665e" }} />

                  {/* FRONT CONTENT — side-by-side on all sizes */}
                  <div className="relative flex flex-row h-full">

                    {/* LEFT — photo column */}
                    <div className="w-[110px] sm:w-[140px] flex-shrink-0 flex flex-col items-center justify-center gap-2 px-2 sm:px-3">
                      <div
                        className="h-[88px] w-[88px] rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
                        style={{
                          border: "2.5px solid rgba(5,150,105,0.7)",
                          boxShadow: "0 0 0 4px rgba(5,150,105,0.13), 0 8px 28px rgba(0,0,0,0.5)",
                          background: "rgba(2,102,94,0.3)",
                        }}
                      >
                        {ride.driver.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={ride.driver.avatarUrl} alt={ride.driver.name ?? "Driver"} className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-black text-white" style={{ fontSize: "2rem" }}>
                            {(ride.driver.name ?? "?")[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                      {/* verified pill */}
                      <div
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                        style={{ background: "#02665e", border: "1.5px solid #0a1110" }}
                      >
                        <BadgeCheck className="h-3 w-3 flex-shrink-0 text-white" aria-hidden />
                        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-white">Verified</span>
                      </div>
                    </div>

                    {/* RIGHT — details column */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-3 pr-4 pl-3">

                      {/* top: branding + route icon + flip */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/40">NoLSAF</p>
                          <p className="text-[10px] font-black text-white/55 tracking-widest">DRIVER ID CARD</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCardFlipped(true)}
                            type="button"
                            className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-emerald-500/20"
                            style={{ border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }}
                            aria-label="View driver profile"
                          >
                            <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none" aria-hidden>
                              <path d="M3.5 2L6.5 5L3.5 8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          {/* Route / navigation icon replacing chip */}
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: "rgba(5,150,105,0.18)", border: "1px solid rgba(5,150,105,0.35)" }}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                              {/* steering wheel */}
                              <circle cx="12" cy="12" r="9" stroke="#10b981" strokeWidth="1.6" />
                              <circle cx="12" cy="12" r="2.5" stroke="#10b981" strokeWidth="1.4" />
                              <line x1="12" y1="9.5" x2="12" y2="3" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" />
                              <line x1="14.5" y1="13.5" x2="20.2" y2="16.8" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" />
                              <line x1="9.5" y1="13.5" x2="3.8" y2="16.8" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* name + title + stars */}
                      <div>
                        <p
                          className="font-black text-white uppercase leading-tight"
                          style={{ fontSize: "clamp(1.05rem, 4vw, 1.3rem)", letterSpacing: "-0.01em", textShadow: "0 2px 10px rgba(0,0,0,0.4)" }}
                        >
                          {ride.driver.name}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-400">
                          <BadgeCheck className="h-3 w-3" aria-hidden />
                          {ride.driver.isVipDriver ? "Premium certified" : "NoLSAF certified driver"}
                        </p>
                        {ride.driver.rating != null && (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {[1,2,3,4,5].map((i) => (
                              <Star key={i} className="h-2.5 w-2.5"
                                style={{
                                  fill: i <= Math.round(ride.driver!.rating!) ? "#fbbf24" : "transparent",
                                  color: i <= Math.round(ride.driver!.rating!) ? "#fbbf24" : "rgba(255,255,255,0.18)",
                                }}
                              />
                            ))}
                            <span className="ml-1 text-[9px] font-black text-white/45">{ride.driver.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>

                      {/* info grid */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">ID No.</p>
                          <p className="text-[10px] font-black text-white tracking-wider mt-0.5">
                            NLS-{String(ride.driver.id).padStart(4,"0")}-{new Date(ride.createdAt).getFullYear()}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">Plate No.</p>
                          <p className="text-[10px] font-black text-white tracking-wider mt-0.5">
                            {ride.driver.plateNumber || ride.driver.vehiclePlate || "Not set"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">Vehicle</p>
                          <p className="text-[10px] font-black text-white mt-0.5 truncate">
                            {[ride.driver.vehicleMake, ride.driver.vehicleType].filter(Boolean).join(" · ") || ride.vehicleType || "Not set"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">Region / District</p>
                          <p className="text-[10px] font-black text-white mt-0.5 truncate">
                            {ride.driver.operationArea || ride.driver.district || ride.driver.region || "Tanzania"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">Languages</p>
                          <p className="text-[10px] font-black text-white mt-0.5">English · Kiswahili</p>
                        </div>
                        {/* barcode + active dot — shares last row with Languages */}
                        <div className="flex flex-col justify-center gap-1">
                          <svg width="100" height="20" viewBox="0 0 100 20" aria-hidden>
                            {(() => {
                              const bars: { x: number; w: number }[] = [];
                              let x = 0;
                              let s = Math.abs((ride.driver!.id * 6364136223846793005 + 1442695040888963407) | 0) >>> 0;
                              const next = () => { s = ((s * 1664525) + 1013904223) >>> 0; return s; };
                              while (x < 100) {
                                const barW = (next() % 3) + 1;
                                const gapW = (next() % 3) + 2;
                                bars.push({ x, w: barW });
                                x += barW + gapW;
                              }
                              return bars.map(({ x, w }) => (
                                <rect key={x} x={x} y={1} width={w} height={18} rx="0.5" fill="rgba(255,255,255,0.72)" />
                              ));
                            })()}
                          </svg>
                          <div className="inline-flex items-center gap-1">
                            <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-white/40">Active</span>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
                {/* END FRONT FACE */}

                {/* ── BACK FACE — LANDSCAPE ── */}
                <div
                  style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  className="rounded-[20px] overflow-hidden shadow-2xl cursor-default select-none"
                >
                  {/* bg */}
                  <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #0a1110 0%, #0f1c1b 55%, #0f3a35 100%)" }} />
                  {/* top stripe */}
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#02665e]" />
                  <div className="absolute top-[3px] left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent pointer-events-none" />
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 500 230" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden>
                    <circle cx="460" cy="200" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
                    <circle cx="460" cy="200" r="90"  stroke="white" strokeOpacity="0.03" strokeWidth="1" fill="none" />
                    <circle cx="40"  cy="40"  r="80"  stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
                  </svg>

                  {/* BACK CONTENT — side-by-side on all sizes */}
                  <div className="relative flex flex-row h-full">

                    {/* LEFT — quote stripe */}
                    <div className="w-[5px] flex-shrink-0" style={{ background: "#02665e" }} />
                    <div className="hidden sm:flex w-[110px] sm:w-[140px] flex-shrink-0 flex-col justify-center items-center gap-3 px-3 border-r border-white/8">
                      {/* big quote mark */}
                      <span className="font-black leading-none select-none" style={{ fontSize: "5rem", color: "rgba(16,185,129,0.18)", lineHeight: 1 }}>&ldquo;</span>
                      <div className="text-center">
                        <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-emerald-400" aria-hidden />
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-400">About</p>
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-400">Driver</p>
                      </div>
                      {/* pulsing dot */}
                      <div className="inline-flex items-center gap-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                        </span>
                      </div>
                    </div>

                    {/* RIGHT — bio + commitments */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-3 sm:py-3.5 pr-4 pl-4 sm:pl-3">
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/50">NoLSAF · Driver Profile</p>
                        <button
                          onClick={() => setCardFlipped(false)}
                          type="button"
                          className="ml-2 flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-emerald-500/20"
                          style={{ border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }}
                          aria-label="Back to ID card"
                        >
                          <svg viewBox="0 0 10 10" className="h-3 w-3" fill="none" aria-hidden>
                            <path d="M6.5 2L3.5 5L6.5 8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>

                      {/* bio */}
                      <p className="text-[11px] leading-[1.7] text-white/75 mb-3">
                        {pickExtendedBio(ride.driver)}
                      </p>

                      {/* commitment pills — 2 columns */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        {[
                          "Safety-first on every road",
                          "On-time, every time",
                          "Licensed & NoLSAF-verified",
                          "Clean vehicle, smooth ride",
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-2 min-w-0">
                            <span
                              className="flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center"
                              style={{ background: "rgba(5,150,105,0.25)", border: "1.5px solid rgba(5,150,105,0.5)" }}
                            >
                              <svg viewBox="0 0 6 6" className="h-2 w-2">
                                <path d="M1 3L2.5 4.5L5 1.5" stroke="#10b981" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                              </svg>
                            </span>
                            <p className="text-[10.5px] font-semibold text-white/65 leading-tight truncate">{item}</p>
                          </div>
                        ))}
                      </div>

                      {/* footer */}
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-white/30">NoLSAF © {new Date().getFullYear()}</p>
                        <p className="text-[8px] font-black tracking-widest text-white/30">
                          NLS-{String(ride.driver.id).padStart(4,"0")}
                        </p>
                      </div>
                    </div>

                  </div>
                </div>
                {/* END BACK FACE */}

              </div>
            </div>
            {/* end 3D flip wrapper */}
            {/* Action buttons below the ID card */}
            <div className="flex gap-2 mt-1">
              {ride.driver.phone && (
                <a
                  href={`tel:${ride.driver.phone}`}
                  className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold bg-[#02665e] text-white hover:bg-[#014e47] transition-colors no-underline"
                >
                  <Phone className="h-4 w-4" />
                  Call driver
                </a>
              )}
              <button
                onClick={() => setShowChat(!showChat)}
                className={`${
                  ride.driver.phone ? "flex-1" : "w-full"
                } inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
                  showChat
                    ? "border-0 bg-[#0a1110] text-white"
                    : "border border-solid border-slate-200 bg-white text-slate-800 hover:border-[#02665e]/40 hover:text-[#02665e]"
                }`}
                style={{ fontFamily: "inherit" }}
              >
                <MessageCircle className="h-4 w-4" />
                {showChat ? "Hide chat" : "Chat with driver"}
              </button>
            </div>
          </>)}

          {/* Payment */}
          <section className="rounded-2xl border border-solid border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <Banknote className="h-4 w-4 text-[#02665e]" aria-hidden />
                Payment
              </div>
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold",
                  paid ? "bg-[#02665e]/10 text-[#02665e]" : "bg-amber-50 text-amber-700",
                ].join(" ")}
              >
                {paid ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                {paid ? "Paid" : human(ride.paymentStatus) || "Pending"}
              </span>
            </div>
            {ride.amount != null ? (
              <div className="mt-2 text-[24px] font-extrabold leading-tight tabular-nums text-slate-900">
                <span className="mr-1 text-[13px] font-semibold text-slate-500">{ride.currency || "TZS"}</span>
                {Number(ride.amount).toLocaleString("en-US")}
              </div>
            ) : null}
          </section>

          {/* Destination */}
          {ride.property ? (
            <section className="rounded-2xl border border-solid border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Destination</div>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
                  <Building2 className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-bold text-slate-900">{ride.property.title}</div>
                  {ride.property.district || ride.property.regionName ? (
                    <div className="truncate text-[12.5px] text-slate-500">{[ride.property.district, ride.property.regionName].filter(Boolean).map((p) => human(p)).join(", ")}</div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* --- Chat --- */}
      {showChat && ride.driver && currentUserId ? (
        <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
          <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
              <MessageCircle className="h-4 w-4" aria-hidden />
            </span>
            <h2 className="m-0 text-[15px] font-bold text-slate-900">Chat with {ride.driver.name}</h2>
          </header>
          <div className="p-4">
            <TransportChat
              bookingId={ride.id}
              currentUserId={currentUserId}
              currentUserType="PASSENGER"
              otherUserName={ride.driver.name ?? undefined}
              otherUserPhone={ride.driver.phone ?? undefined}
              className="h-[500px]"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
