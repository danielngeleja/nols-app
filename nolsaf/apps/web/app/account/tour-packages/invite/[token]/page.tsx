"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Compass, Link2Off, Loader2, Lock, MapPin, Route, ShieldCheck, Star, TrendingUp, Users } from "lucide-react";

type Invite = {
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  operatorName?: string | null;
  sharedBy?: string | null;
  isOwner?: boolean;
  alreadyAccepted?: boolean;
  travelerCount?: number;
  joinedCount?: number;
  remainingSlots?: number;
  expiresAt?: string | null;
  timelineUrl?: string;
};

type Screen = "loading" | "auth" | "expired" | "invalid" | "owner" | "joined" | "full" | "ready";

const BRAND = "#02665e";

function fmtDate(value?: string | null): string | null {
  return value ? new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null;
}

export default function TourTimelineInvitePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [screen, setScreen] = useState<Screen>("loading");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invitePath = `/account/tour-packages/invite/${encodeURIComponent(token)}`;
  const registerHref = `/account/register?mode=register&role=traveller&next=${encodeURIComponent(invitePath)}`;
  const loginHref = `/account/register?mode=login&role=traveller&next=${encodeURIComponent(invitePath)}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiClient.get(`/api/customer/tour-bookings/timeline-invites/${encodeURIComponent(token)}`);
        if (!alive) return;
        const data: Invite = res.data || {};
        setInvite(data);
        setScreen(data.isOwner ? "owner" : data.alreadyAccepted ? "joined" : Number(data.remainingSlots || 0) <= 0 ? "full" : "ready");
      } catch (err: any) {
        if (!alive) return;
        const status = err?.response?.status;
        setScreen(status === 401 || status === 403 ? "auth" : status === 410 ? "expired" : "invalid");
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const acceptInvite = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await apiClient.post(`/api/customer/tour-bookings/timeline-invites/${encodeURIComponent(token)}/accept`);
      window.location.href = String(res?.data?.timelineUrl || "") || "/account/tour-packages";
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) setScreen("auth");
      else if (status === 410) setScreen("expired");
      else if (err?.response?.data?.error === "traveller_capacity_full") setScreen("full");
      else setError(err?.response?.data?.message || err?.response?.data?.error || "We could not add you to this trip. Please try again.");
      setAccepting(false);
    }
  };

  const dates = (() => {
    const start = fmtDate(invite?.startDate);
    const end = fmtDate(invite?.endDate);
    if (!start) return null;
    return end && end !== start ? `${start} to ${end}` : start;
  })();
  const travellers = Math.max(1, Number(invite?.travelerCount || 1));
  const joined = Math.min(travellers, Math.max(1, Number(invite?.joinedCount || 1)));
  const expires = fmtDate(invite?.expiresAt);

  return (
    <div id="tour-invite-page" className="w-full min-w-0 py-4 sm:py-8">
      <style>{"#tour-invite-page, #tour-invite-page * { box-sizing: border-box; }"}</style>
      <div className="mx-auto w-full max-w-xl">
        {screen === "loading" ? (
          <div className="h-[28rem] rounded-3xl border border-solid border-slate-200 bg-white" aria-busy="true">
            <span role="status" className="sr-only">Loading invite</span>
          </div>
        ) : screen === "ready" || screen === "joined" || screen === "owner" || screen === "full" ? (
          <article className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_2px_8px_rgba(2,102,94,0.05),0_24px_56px_-28px_rgba(2,102,94,0.3)]">
            {/* Who invited you, and to what */}
            <header className="px-6 pb-5 pt-6 sm:px-8 sm:pt-8">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: BRAND }}>
                <Users className="h-3.5 w-3.5" aria-hidden />
                {screen === "owner" ? "Your trip" : invite?.sharedBy ? `${invite.sharedBy} invited you` : "You are invited"}
              </div>
              <h1 className="m-0 mt-2 break-words text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[30px]">{invite?.title || "Tour itinerary"}</h1>
              <p className="m-0 mt-1.5 text-[13.5px] text-slate-500">
                {screen === "owner"
                  ? "This invite link is for the people travelling with you."
                  : "Join the group itinerary to follow each day of the trip together."}
              </p>
            </header>

            {/* Trip facts */}
            <dl className="m-0 grid grid-cols-1 border-0 border-y border-solid border-slate-200 bg-slate-50/70 sm:grid-cols-2">
              <Fact icon={<CalendarDays className="h-4 w-4" />} label="Dates" value={dates || "To be confirmed"} />
              <Fact icon={<MapPin className="h-4 w-4" />} label="Destination" value={invite?.destination ? `${invite.destination}, Tanzania` : "Tanzania"} divided />
              <Fact icon={<Compass className="h-4 w-4" />} label="Operator" value={invite?.operatorName || "NoLSAF partner"} top />
              <Fact
                icon={<Users className="h-4 w-4" />}
                label="Travellers"
                top
                divided
                value={
                  <span className="flex items-center gap-2">
                    <span className="flex -space-x-1.5" aria-hidden>
                      {Array.from({ length: Math.min(travellers, 6) }).map((_, idx) => (
                        <span
                          key={idx}
                          className="inline-block h-4 w-4 rounded-full ring-2 ring-white"
                          style={{ background: idx < joined ? BRAND : "#dbe5e3" }}
                        />
                      ))}
                    </span>
                    {joined} of {travellers} joined
                  </span>
                }
              />
            </dl>

            <div className="px-6 py-6 sm:px-8">
              {screen === "ready" ? (
                <>
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">When you join</div>
                  <ul className="m-0 mt-3 list-none space-y-3 p-0">
                    {[
                      { icon: <Route className="h-4 w-4" />, title: "Follow each day", text: "See the day-by-day plan, with today highlighted." },
                      { icon: <Star className="h-4 w-4" />, title: "Rate every stop", text: "Your ratings are your own; the group sees the average." },
                      { icon: <TrendingUp className="h-4 w-4" />, title: "See how it is going", text: "Watch the group's mood build across the trip." },
                    ].map((perk) => (
                      <li key={perk.title} className="flex items-start gap-3">
                        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-white" style={{ background: BRAND }}>{perk.icon}</span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-bold text-slate-900">{perk.title}</span>
                          <span className="block text-[12.5px] text-slate-500">{perk.text}</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-slate-50 px-4 py-3 text-[12.5px] leading-relaxed text-slate-600">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: BRAND }} aria-hidden />
                    <span>
                      You will only see the itinerary. {invite?.sharedBy ? `${invite.sharedBy}'s` : "The booking owner's"} payment and personal details stay private.
                    </span>
                  </div>

                  {error ? (
                    <div role="alert" className="mt-4 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>
                  ) : null}

                  <button
                    type="button"
                    onClick={acceptInvite}
                    disabled={accepting}
                    style={{ fontFamily: "inherit", background: BRAND }}
                    className="mt-5 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-0 text-[14.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {accepting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
                    {accepting ? "Joining..." : "Join the trip"}
                  </button>
                  <p className="m-0 mt-3 text-center text-[12px] text-slate-400">
                    {Number(invite?.remainingSlots || 0)} {Number(invite?.remainingSlots || 0) === 1 ? "place" : "places"} left
                    {expires ? ` · invite valid until ${expires}` : ""}
                  </p>
                </>
              ) : screen === "joined" || screen === "owner" ? (
                <>
                  <div className="flex items-start gap-3 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" aria-hidden />
                    <div>
                      <div className="text-[14px] font-bold text-emerald-950">{screen === "owner" ? "You booked this trip" : "You are already on this trip"}</div>
                      <p className="m-0 mt-0.5 text-[12.5px] text-emerald-900/80">
                        {screen === "owner" ? "Share this link with your fellow travellers so they can join." : "Pick up where you left off."}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={invite?.timelineUrl || "/account/tour-packages"}
                    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14.5px] font-bold text-white no-underline transition-opacity hover:opacity-90"
                    style={{ background: BRAND }}
                  >
                    Open itinerary
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3.5">
                    <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden />
                    <div>
                      <div className="text-[14px] font-bold text-amber-950">All places are taken</div>
                      <p className="m-0 mt-0.5 text-[12.5px] leading-relaxed text-amber-900/80">
                        This trip was booked for {travellers} {travellers === 1 ? "traveller" : "travellers"} and everyone has joined. If you are travelling too, ask {invite?.sharedBy || "the person who shared it"} to check the booking.
                      </p>
                    </div>
                  </div>
                  <Link href="/account/tour-packages" className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-solid border-slate-300 bg-white text-[14px] font-semibold text-slate-700 no-underline hover:border-slate-400">
                    Go to my tours
                  </Link>
                </>
              )}
            </div>
          </article>
        ) : (
          <StatusCard screen={screen} registerHref={registerHref} loginHref={loginHref} />
        )}
      </div>
    </div>
  );
}

function Fact({ icon, label, value, top, divided }: { icon: ReactNode; label: string; value: ReactNode; top?: boolean; divided?: boolean }) {
  return (
    <div
      className={[
        "flex min-w-0 items-start gap-3 px-6 py-3.5 sm:px-8",
        top ? "border-0 border-t border-solid border-slate-200" : "",
        divided ? "border-0 border-t border-solid border-slate-200 sm:border-l sm:border-t-0" : "",
        top && divided ? "sm:border-t" : "",
      ].join(" ")}
    >
      <span className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
        <dd className="m-0 mt-0.5 text-[13.5px] font-semibold text-slate-800">{value}</dd>
      </div>
    </div>
  );
}

/** Screens with no trip details yet: sign in first, or the link no longer works. */
function StatusCard({ screen, registerHref, loginHref }: { screen: Screen; registerHref: string; loginHref: string }) {
  const content = (() => {
    if (screen === "auth") {
      return {
        icon: <Users className="h-6 w-6" />,
        tone: "brand" as const,
        title: "You have been invited to a trip",
        text: "Sign in or create a free traveller account to see the trip and join the group itinerary.",
      };
    }
    if (screen === "expired") {
      return {
        icon: <Clock3 className="h-6 w-6" />,
        tone: "amber" as const,
        title: "This invite has expired",
        text: "Invite links stay valid for a limited time. Ask the person who shared it to send you a fresh link.",
      };
    }
    return {
      icon: <Link2Off className="h-6 w-6" />,
      tone: "slate" as const,
      title: "This invite link does not work",
      text: "It may have been copied incompletely or replaced with a new one. Ask the person who shared it for the current link.",
    };
  })();
  const iconTone = content.tone === "brand" ? "text-white" : content.tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";
  return (
    <article className="rounded-3xl border border-solid border-slate-200 bg-white px-6 py-10 text-center shadow-[0_2px_8px_rgba(2,102,94,0.05),0_24px_56px_-28px_rgba(2,102,94,0.3)] sm:px-10">
      <span
        className={`mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl ${iconTone}`}
        style={content.tone === "brand" ? { background: BRAND } : undefined}
        aria-hidden
      >
        {content.icon}
      </span>
      <h1 className="m-0 mt-4 text-[22px] font-extrabold tracking-tight text-slate-900">{content.title}</h1>
      <p className="m-0 mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-slate-500">{content.text}</p>
      {screen === "auth" ? (
        <div className="mx-auto mt-6 grid max-w-sm gap-2.5">
          <Link href={registerHref} className="inline-flex h-12 items-center justify-center rounded-2xl text-[14.5px] font-bold text-white no-underline hover:opacity-90" style={{ background: BRAND }}>
            Create traveller account
          </Link>
          <Link href={loginHref} className="inline-flex h-12 items-center justify-center rounded-2xl border border-solid border-slate-300 bg-white text-[14px] font-semibold text-slate-700 no-underline hover:border-slate-400">
            I already have an account
          </Link>
          <p className="m-0 mt-1 text-[12px] text-slate-400">You come straight back here after signing in.</p>
        </div>
      ) : (
        <Link href="/account/tour-packages" className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl border border-solid border-slate-300 bg-white px-6 text-[14px] font-semibold text-slate-700 no-underline hover:border-slate-400">
          Go to my tours
        </Link>
      )}
    </article>
  );
}
