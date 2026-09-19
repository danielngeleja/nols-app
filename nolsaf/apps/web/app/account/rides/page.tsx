"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Car, Star, User, CheckCircle, Calendar, ArrowRight, Phone, Eye, Clock, RefreshCw, AlertCircle } from "lucide-react";
import Link from "next/link";

const api = apiClient;

type Ride = {
  id: number;
  scheduledDate: string;
  pickupTime?: string;
  dropoffTime?: string;
  fromRegion?: string;
  fromDistrict?: string;
  fromWard?: string;
  fromAddress?: string;
  toRegion?: string;
  toDistrict?: string;
  toWard?: string;
  toAddress?: string;
  driver?: {
    id: number;
    name: string;
    phone?: string;
  };
  property?: {
    id: number;
    title: string;
  };
  status: string;
  amount?: number;
  rating?: number;
  isValid: boolean;
  createdAt: string;
};

export default function MyRidesPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "scheduled" | "completed" | "expired">("all");
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRides();
  }, []);

  // Gentle mount animation
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  const loadRides = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get("/api/customer/rides");
      setRides(response.data.items || []);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to load rides";
      setError(msg);
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Rides", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const filteredRides = rides.filter((ride) => {
    if (filter === "scheduled") return ride.isValid;
    if (filter === "completed") return !ride.isValid && ride.status === "COMPLETED";
    if (filter === "expired") return !ride.isValid && ride.status !== "COMPLETED";
    return true;
  });

  const scheduledCount = rides.filter((r) => r.isValid).length;
  const completedCount = rides.filter((r) => !r.isValid && r.status === "COMPLETED").length;
  const expiredCount = rides.filter((r) => !r.isValid && r.status !== "COMPLETED").length;

  const formatTime = (timeString?: string) => {
    if (!timeString) return "N/A";
    return new Date(timeString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatLocation = (ride: Ride, type: "from" | "to") => {
    const parts = [];
    if (type === "from") {
      if (ride.fromAddress) parts.push(ride.fromAddress);
      if (ride.fromWard) parts.push(ride.fromWard);
      if (ride.fromDistrict) parts.push(ride.fromDistrict);
      if (ride.fromRegion) parts.push(ride.fromRegion);
    } else {
      if (ride.property?.title) parts.push(ride.property.title);
      if (ride.toAddress) parts.push(ride.toAddress);
      if (ride.toWard) parts.push(ride.toWard);
      if (ride.toDistrict) parts.push(ride.toDistrict);
      if (ride.toRegion) parts.push(ride.toRegion);
    }
    return parts.length > 0 ? parts.join(", ") : "Not specified";
  };

  const getStatusLabel = (ride: Ride) => {
    if (!ride.isValid) {
      return ride.status === "COMPLETED" ? "Completed" : "Expired";
    }
    return ride.status === "CONFIRMED" ? "Confirmed" : "Scheduled";
  };

  // The soonest scheduled ride, for the header
  const nextRide = rides
    .filter((r) => r.isValid)
    .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())[0];
  const nextRideLabel = nextRide
    ? `${new Date(nextRide.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${
        nextRide.pickupTime ? ` · pickup ${formatTime(nextRide.pickupTime)}` : ""
      }`
    : null;

  const tabs = [
    { key: "all" as const, label: "All", count: rides.length },
    { key: "scheduled" as const, label: "Scheduled", count: scheduledCount },
    { key: "completed" as const, label: "Completed", count: completedCount },
    { key: "expired" as const, label: "Expired", count: expiredCount },
  ];

  const DateTile = ({ date, muted }: { date: string; muted?: boolean }) => {
    const d = new Date(date);
    return (
      <div
        className={[
          "flex h-16 w-14 flex-shrink-0 flex-col overflow-hidden rounded-xl border border-solid text-center",
          muted ? "border-slate-200 bg-slate-50" : "border-[#02665e]/25 bg-white",
        ].join(" ")}
      >
        <span className={["py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white", muted ? "bg-slate-400" : "bg-[#02665e]"].join(" ")}>
          {d.toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className={["flex flex-1 items-center justify-center text-[22px] font-extrabold leading-none tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>
          {d.getDate()}
        </span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading rides</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="mt-3 h-7 w-40 rounded-lg bg-white/15" />
          <div className="mt-2 h-3 w-56 rounded bg-white/10" />
          <div className="mt-5 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-24 rounded-lg bg-white/10" />
            ))}
          </div>
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-4">
            <div className="h-16 w-14 rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-56 rounded bg-slate-100" />
              <div className="h-4 w-48 rounded bg-slate-100" />
              <div className="h-3 w-32 rounded bg-slate-100" />
            </div>
            <div className="hidden w-36 space-y-2 sm:block">
              <div className="ml-auto h-5 w-24 rounded bg-slate-100" />
              <div className="ml-auto h-9 w-28 rounded-lg bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col items-center rounded-2xl border border-solid border-rose-200 bg-white px-6 py-12 text-center shadow-sm">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="m-0 mt-3 text-[18px] font-bold text-slate-900">We could not load your rides</h1>
          <p className="m-0 mt-1 max-w-md text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={loadRides}
            className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#014e47]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "mx-auto w-full max-w-5xl space-y-4 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      {/* ── Header band ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#5ec8bb]">
                <Car className="h-3.5 w-3.5" aria-hidden />
                Your transport
              </div>
              <h1 className="m-0 mt-1.5 text-[26px] font-bold leading-tight text-white">
                My rides
                {rides.length > 0 ? <span className="ml-2 align-middle text-[14px] font-semibold text-white/50">{rides.length}</span> : null}
              </h1>
              <p className="m-0 mt-1 text-[13.5px] text-white/60">
                {nextRideLabel ? (
                  <>
                    Next ride: <span className="font-semibold text-white">{nextRideLabel}</span>
                  </>
                ) : (
                  "Rides that come with your bookings, past and upcoming."
                )}
              </p>
            </div>
            <Link
              href="/public/properties"
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 self-start rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#03786f]"
            >
              Book a stay
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div role="tablist" aria-label="Filter rides" className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-solid border-white/10 bg-white/[0.04] p-1 [scrollbar-width:none]">
            {tabs.map((t) => {
              const on = filter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setFilter(t.key)}
                  style={{ fontFamily: "inherit" }}
                  className={[
                    "inline-flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2 text-[13.5px] font-semibold transition-colors",
                    on ? "bg-white text-slate-900" : "bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")}
                >
                  {t.label}
                  <span className={["inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold tabular-nums", on ? "bg-[#02665e] text-white" : "bg-white/10 text-white/80"].join(" ")}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {filteredRides.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
            <Car className="h-6 w-6" aria-hidden />
          </span>
          <div className="mt-3 text-[16px] font-bold text-slate-900">No rides here yet</div>
          <div className="mt-1 max-w-xs text-sm text-slate-500">
            {filter === "scheduled"
              ? "You have no scheduled rides at the moment."
              : filter === "completed"
                ? "Completed rides will appear here."
                : filter === "expired"
                  ? "You have no expired rides."
                  : "Rides appear here when you book a stay that includes transport."}
          </div>
          {filter === "all" ? (
            <Link
              href="/public/properties"
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
            >
              Book a stay
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        /* ── Ride cards ── */
        <div className="space-y-3">
          {filteredRides.map((ride) => {
            const isActive = ride.isValid;
            const isCompleted = !ride.isValid && ride.status === "COMPLETED";
            const muted = !isActive;
            const statusLabel = getStatusLabel(ride);
            return (
              <div
                key={ride.id}
                className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-[#02665e]/30 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <DateTile date={ride.scheduledDate} muted={muted || undefined} />

                    <div className="min-w-0 flex-1">
                      {/* Route */}
                      <div className="relative pl-5">
                        <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200" />
                        <div className="relative flex min-w-0 items-center gap-2">
                          <span aria-hidden className="absolute -left-5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[#02665e] ring-2 ring-white" />
                          <span className="flex-shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">From</span>
                          <span className="truncate text-[14px] font-semibold text-slate-900" title={formatLocation(ride, "from")}>{formatLocation(ride, "from")}</span>
                        </div>
                        <div className="relative mt-1.5 flex min-w-0 items-center gap-2">
                          <span aria-hidden className="absolute -left-5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-solid border-[#02665e] bg-white" />
                          <span className="flex-shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">To</span>
                          <span className="truncate text-[14px] font-semibold text-slate-900" title={formatLocation(ride, "to")}>{formatLocation(ride, "to")}</span>
                        </div>
                      </div>

                      {/* Time and driver */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-600">
                        {ride.pickupTime ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                            Pickup {formatTime(ride.pickupTime)}
                          </span>
                        ) : null}
                        {ride.driver ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                            <span className="truncate font-semibold text-slate-800">{ride.driver.name}</span>
                            {ride.driver.phone ? (
                              <a href={`tel:${ride.driver.phone}`} className="inline-flex items-center gap-1 font-semibold text-[#02665e] no-underline hover:underline">
                                <Phone className="h-3 w-3" aria-hidden />
                                Call
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                        {ride.rating ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                            <span className="font-bold text-slate-800">{ride.rating.toFixed(1)}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-48 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                    <div className="text-right">
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                          isActive ? "bg-[#02665e]/10 text-[#02665e]" : isCompleted ? "bg-slate-100 text-slate-700" : "bg-rose-50 text-rose-700",
                        ].join(" ")}
                      >
                        {isActive || isCompleted ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Calendar className="h-3.5 w-3.5" aria-hidden />}
                        {statusLabel}
                      </span>
                      {ride.amount != null ? (
                        <div className="mt-1 text-[17px] font-extrabold tabular-nums text-slate-900">
                          {Number(ride.amount).toLocaleString("en-US")} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                        </div>
                      ) : null}
                    </div>
                    <Link
                      href={`/account/rides/${ride.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                      View details
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
