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
    /** The ID printed on the driver's own NoLSAF card (HMAC-checked, issued by the server). */
    verificationCode?: string | null;
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

export default function RideDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rideId = String((params as any)?.id ?? "");
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);

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
      <div className="w-full space-y-4" aria-busy="true">
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
      <div className="w-full">
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
    <div className="w-full space-y-4">
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

          {/* ===== Your driver: who, how to recognise the car, how to reach them ===== */}
          {ride.driver && (() => {
            const d = ride.driver;
            // Same ID as the driver's own NoLSAF card; the server issues it, the client cannot derive it
            const driverId = d.verificationCode || null;
            const plate = d.plateNumber || d.vehiclePlate || null;
            const vehicle = [d.vehicleMake, d.vehicleType ? human(d.vehicleType) : null].filter(Boolean).join(" · ") || (ride.vehicleType ? human(ride.vehicleType) : null);
            const area = d.operationArea || [d.district, d.region].filter(Boolean).join(", ") || null;
            const initials = (d.name || "Driver").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
            return (
              <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm" aria-label="Your driver">
                {/* Identity */}
                <div className="relative bg-[#0a1110] px-5 pb-5 pt-4 text-white" style={{ isolation: "isolate" }}>
                  <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 -z-10 h-52 w-52 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.5), rgba(2,102,94,0))" }} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-white/60">Your driver</span>
                    {driverId ? (
                      <span className="rounded-md bg-white/[0.08] px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-wider text-white/80 ring-1 ring-white/10" title="Driver ID">
                        {driverId}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="relative flex-shrink-0">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#02665e] ring-2 ring-white/10">
                        {d.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.avatarUrl} alt={d.name ?? "Driver"} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[22px] font-bold text-white">{initials || "D"}</span>
                        )}
                      </div>
                      <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#02665e] ring-[3px] ring-[#0a1110]" title="Verified by NoLSAF">
                        <BadgeCheck className="h-3.5 w-3.5 text-white" aria-hidden />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[18px] font-bold leading-tight">{d.name || "Your driver"}</div>
                      <div className="mt-0.5 text-[12.5px] font-semibold text-[#5ec8bb]">
                        {d.isVipDriver ? "Premium certified driver" : "Verified NoLSAF driver"}
                      </div>
                      {d.rating != null ? (
                        <div className="mt-1 flex items-center gap-1" aria-label={`Rated ${d.rating.toFixed(1)} of 5`}>
                          {[1, 2, 3, 4, 5].map((i) => (
                            <Star
                              key={i}
                              className={`h-3.5 w-3.5 ${i <= Math.round(d.rating!) ? "fill-amber-400 text-amber-400" : "fill-transparent text-white/20"}`}
                              aria-hidden
                            />
                          ))}
                          <span className="ml-1 text-[12px] font-bold text-white/70">{d.rating.toFixed(1)}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Recognise the car */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-semibold text-slate-500">Plate number</div>
                      {plate ? (
                        <span className="mt-1 inline-flex rounded-md border-2 border-solid border-slate-900 bg-[#fde047] px-2.5 py-0.5 font-mono text-[17px] font-extrabold tracking-[0.12em] text-slate-900">
                          {plate.toUpperCase()}
                        </span>
                      ) : (
                        <div className="mt-1 text-[13.5px] font-semibold text-slate-400">Shared before pickup</div>
                      )}
                    </div>
                    {vehicle ? (
                      <div className="min-w-0 text-right">
                        <div className="text-[11.5px] font-semibold text-slate-500">Vehicle</div>
                        <div className="mt-1 inline-flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
                          <Car className="h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                          <span className="truncate">{vehicle}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {area ? (
                    <div className="mt-3 flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 text-[12.5px]">
                      <span className="text-slate-500">Drives in</span>
                      <span className="truncate font-semibold text-slate-800">{area}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#02665e]/[0.05] px-3 py-2.5 text-[12.5px] leading-snug text-slate-700 ring-1 ring-[#02665e]/15">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                    <span>
                      Before you get in, match the plate and ask the driver to say your name.
                      {driverId ? (
                        <>
                          {" "}
                          <a href={`/verify/driver/${encodeURIComponent(driverId)}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#02665e] underline underline-offset-2">
                            Check this driver ID
                          </a>
                          .
                        </>
                      ) : null}
                    </span>
                  </div>
                </div>

                {/* Reach them */}
                <div className="flex gap-2 border-0 border-t border-solid border-slate-100 px-5 py-4">
                  {d.phone ? (
                    <a
                      href={`tel:${d.phone}`}
                      className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#02665e] text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                    >
                      <Phone className="h-4 w-4" aria-hidden />
                      Call
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowChat(!showChat)}
                    className={`inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
                      showChat
                        ? "border-0 bg-[#0a1110] text-white"
                        : "border border-solid border-slate-200 bg-white text-slate-800 hover:border-[#02665e]/40 hover:text-[#02665e]"
                    }`}
                    style={{ fontFamily: "inherit" }}
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    {showChat ? "Hide chat" : "Message"}
                  </button>
                </div>
              </section>
            );
          })()}

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
