"use client";

// Sales production: what a person actually did.
//
// A sales executive could see the property's inquiries, its group blocks and
// its agencies, and had no way to see their own work in any of them. This is
// the page that answers "what did I do this month", and for an owner or a
// manager, "what did the team do".
//
// The scope comes from the server, never from this file. A sales executive
// receives scope OWN and one person; an owner or manager receives PROPERTY and
// the roster. The page states which it got rather than inferring it from the
// row count, so it can never imply a league table that was not sent.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Handshake,
  Inbox,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Users,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type Person = {
  userId: number;
  name: string;
  role: string;
  roleLabel: string;
  inbox: { assigned: number; repliesSent: number; answered: number; awaitingFirstReply: number; averageFirstResponseMinutes: number | null };
  conversion: { reachedHold: number; confirmed: number; lost: number };
  groups: { agreed: number; roomsAgreed: number; value: number; currency: string; live: number; pickedUp: number; released: number; cancelled: number; roomsPickedUp: number };
  agencies: { introduced: number; active: number };
};

type Report = {
  propertyId: number;
  scope: "OWN" | "PROPERTY";
  range: { from: string; to: string; days: number };
  currency: string;
  people: Person[];
  totals: {
    assigned: number; repliesSent: number; answered: number; awaitingFirstReply: number; averageFirstResponseMinutes: number | null;
    reachedHold: number; confirmed: number; groupsAgreed: number; roomsAgreed: number; groupValue: number; agenciesIntroduced: number;
  };
  timeline: Array<{ date: string; inquiries: number; replies: number; blocks: number }>;
  property: { id: number; title: string };
  viewer: { userId: number; role: string };
};

const PERIODS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "12 months" },
] as const;

function isoDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

function responseTime(minutes: number | null): string {
  if (minutes == null) return "No replies yet";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10} hr`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "0%";
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function NrmsSalesPerformancePage() {
  const { selectedPropertyId } = useNrms();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<Report>(`/api/owner/nrms/sales-performance/property/${selectedPropertyId}`, {
        params: { from: isoDay(Number(period) - 1), to: isoDay(0) },
      });
      setReport(response.data);
    } catch (e: any) {
      setReport(null);
      setError(e?.response?.data?.error || "Could not load the sales production report.");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, period]);

  useEffect(() => { void load(); }, [load]);

  const own = report?.scope === "OWN";
  const me = useMemo(
    () => report?.people.find((person) => person.userId === report.viewer.userId) ?? null,
    [report],
  );
  // In OWN scope every headline is the one person's, so the summary reads from
  // them rather than from totals: identical numbers, but it makes the "this is
  // yours" reading impossible to get wrong when a roster arrives later.
  const headline = own && me
    ? {
      assigned: me.inbox.assigned,
      repliesSent: me.inbox.repliesSent,
      answered: me.inbox.answered,
      awaitingFirstReply: me.inbox.awaitingFirstReply,
      averageFirstResponseMinutes: me.inbox.averageFirstResponseMinutes,
      reachedHold: me.conversion.reachedHold,
      confirmed: me.conversion.confirmed,
      groupsAgreed: me.groups.agreed,
      roomsAgreed: me.groups.roomsAgreed,
      groupValue: me.groups.value,
      agenciesIntroduced: me.agencies.introduced,
    }
    : report?.totals ?? null;

  // Every day in the period, not only the days something happened.
  //
  // The API sends a row per active day, which is the honest thing for it to
  // send. Plotting those rows straight would space them evenly and turn a quiet
  // fortnight followed by one busy Friday into two adjacent bars of equal
  // width, which reads as steady activity. The gaps are the information.
  const plottedDays = useMemo(() => {
    if (!report) return [];
    const byDate = new Map(report.timeline.map((day) => [day.date, day]));
    const days: Array<{ date: string; inquiries: number; replies: number; blocks: number }> = [];
    const cursor = new Date(`${report.range.from.slice(0, 10)}T00:00:00Z`);
    const last = new Date(`${report.range.to.slice(0, 10)}T00:00:00Z`);
    // Guard the loop rather than trusting the range: a malformed date would
    // otherwise spin here forever.
    while (cursor.getTime() <= last.getTime() && days.length <= 400) {
      const key = cursor.toISOString().slice(0, 10);
      days.push(byDate.get(key) ?? { date: key, inquiries: 0, replies: 0, blocks: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }, [report]);

  const timelinePeak = useMemo(
    () => Math.max(1, ...plottedDays.map((day) => Math.max(day.inquiries, day.blocks))),
    [plottedDays],
  );

  const nothingHappened = Boolean(report && headline
    && headline.assigned === 0 && headline.repliesSent === 0 && headline.groupsAgreed === 0 && headline.agenciesIntroduced === 0);

  if (!selectedPropertyId) {
    return <p className="py-10 text-center text-sm text-neutral-500">Select a property to see sales production.</p>;
  }

  return (
    <div className="space-y-4 pb-10">
      {/* The header sits in a card like everything below it. Floating on the
          grey page it read as a stray strip, and its long second sentence
          pushed the controls onto a line of their own. The heading keeps one
          short line; what is and is not counted is a footnote on the roster
          table, which is the only place it changes how a number is read. */}
      <header className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-72">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-base font-black leading-tight text-neutral-900 sm:text-lg">
                {own ? "My production" : "Sales production"}
              </h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${own ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                {own ? "Your work" : "Whole roster"}
              </span>
            </div>
            <p className="m-0 mt-1 text-xs leading-5 text-neutral-500">
              {own
                ? "Inquiries you were given, replies you sent, groups you agreed and agencies you brought in."
                : "What each person on the sales roster produced."}
              {report ? <span className="text-neutral-400">{" "}{shortDay(report.range.from.slice(0, 10))} to {shortDay(report.range.to.slice(0, 10))}.</span> : null}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {report && ["OWNER", "MANAGER"].includes(report.viewer.role) ? (
              <nav aria-label="Performance view" className="inline-flex h-8 items-center rounded-lg bg-neutral-100 p-0.5">
                <Link href="/owner/nrms/performance" className="inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-bold text-neutral-500 no-underline transition hover:bg-white hover:text-neutral-900">Outlet team</Link>
                <span aria-current="page" className="inline-flex h-7 items-center rounded-md bg-white px-2.5 text-[11px] font-bold text-emerald-800 shadow-sm">Sales team</span>
              </nav>
            ) : null}
            <div className="inline-flex overflow-hidden rounded-xl bg-neutral-100 p-0.5" role="group" aria-label="Reporting period">
              {PERIODS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setPeriod(option.key)}
                  aria-pressed={period === option.key}
                  // border-0 because preflight is off and a bare button keeps
                  // the user agent border, which would box every segment.
                  className={`h-8 cursor-pointer appearance-none rounded-lg border-0 px-2.5 text-[11px] font-bold transition ${period === option.key ? "bg-white text-emerald-800 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Reload the report"
              title="Reload"
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-xl border-0 bg-neutral-100 p-0 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="m-0 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <div role="status" aria-live="polite" aria-label="Building the sales performance report" className="space-y-3">
          <section className="bg-white px-4 py-4 ring-1 ring-neutral-200 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-emerald-50 text-emerald-700">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-neutral-800">Preparing sales performance</p>
                <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Collecting inquiries, conversions, group business and agency activity.</p>
                <div className="mt-2 h-1.5 overflow-hidden bg-neutral-100">
                  <div className="h-full w-2/3 animate-pulse bg-emerald-500" />
                </div>
              </div>
            </div>
          </section>

          <div aria-hidden="true" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="min-h-28 animate-pulse bg-white p-4 ring-1 ring-neutral-200">
                <div className="h-3 w-24 bg-neutral-200" />
                <div className="mt-5 h-6 w-16 bg-neutral-200" />
                <div className="mt-3 h-2.5 w-3/4 bg-neutral-100" />
              </div>
            ))}
          </div>

          <div aria-hidden="true" className="grid gap-3 xl:grid-cols-2">
            {[0, 1].map((item) => (
              <div key={item} className="min-h-44 animate-pulse bg-white p-4 ring-1 ring-neutral-200">
                <div className="h-3.5 w-40 bg-neutral-200" />
                <div className="mt-2 h-2.5 w-64 max-w-full bg-neutral-100" />
                <div className="mt-6 space-y-3">
                  <div className="h-2 w-full bg-neutral-100" />
                  <div className="h-2 w-5/6 bg-neutral-100" />
                  <div className="h-2 w-2/3 bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
          <span className="sr-only">Building the report…</span>
        </div>
      ) : !report || !headline ? null : nothingHappened ? (
        // The empty state replaces the report rather than sitting on top of
        // one. A page of zeroed cards under "nothing recorded" says the same
        // thing four more times and buries the one useful link.
        <div className="rounded-2xl bg-white px-4 py-12 text-center ring-1 ring-neutral-200">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
            <CalendarRange className="h-5 w-5" />
          </span>
          <p className="m-0 mt-3 text-sm font-bold text-neutral-800">
            Nothing recorded in the last {PERIODS.find((option) => option.key === period)?.label}
          </p>
          <p className="m-0 mx-auto mt-1.5 max-w-md text-xs leading-5 text-neutral-500">
            {own
              ? "Inquiries assigned to you, replies you send, group blocks you agree and agencies you introduce all appear here. Try a longer period."
              : "No inquiries were assigned and no group business was agreed by the sales roster in this period."}
          </p>
          <Link href="/owner/nrms/inquiries" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 no-underline hover:underline">
            Open the inbox <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat
              icon={<Inbox className="h-4 w-4" />}
              label={own ? "Inquiries given to me" : "Inquiries assigned"}
              value={headline.assigned}
              note={headline.awaitingFirstReply > 0 ? `${headline.awaitingFirstReply} still waiting for a first reply` : "All have had a first reply"}
              tone={headline.awaitingFirstReply > 0 ? "warn" : "neutral"}
            />
            <Stat
              icon={<Clock3 className="h-4 w-4" />}
              label="Average first reply"
              value={responseTime(headline.averageFirstResponseMinutes)}
              note={`${headline.answered} of ${headline.assigned} answered`}
              tone="neutral"
            />
            <Stat
              icon={<Layers className="h-4 w-4" />}
              label="Group business agreed"
              value={headline.groupsAgreed}
              note={headline.groupsAgreed > 0 ? `${headline.roomsAgreed} rooms, ${money(headline.groupValue, report.currency)}` : "No blocks agreed"}
              tone="neutral"
            />
            <Stat
              icon={<Handshake className="h-4 w-4" />}
              label="Agencies introduced"
              value={headline.agenciesIntroduced}
              note={headline.agenciesIntroduced > 0 ? "Relationships you started" : "None started in this period"}
              tone="neutral"
            />
          </section>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
              <h2 className="m-0 text-sm font-black text-neutral-900">From inquiry to a stay</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">
                {own
                  ? "What happened to the conversations you were given."
                  : "What happened to the conversations the roster was given."}
              </p>
              <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                {[
                  { key: "assigned", label: "Assigned", value: headline.assigned, cls: "bg-sky-400", note: "Given to a person to work" },
                  { key: "answered", label: "Answered", value: headline.answered, cls: "bg-violet-400", note: "Got a first reply" },
                  { key: "held", label: "Reached a hold", value: headline.reachedHold, cls: "bg-amber-400", note: "Rooms put aside for the guest" },
                  { key: "confirmed", label: "Confirmed", value: headline.confirmed, cls: "bg-emerald-500", note: "Became a real stay" },
                ].map((step, index, all) => (
                  <li key={step.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-neutral-700">{step.label}</span>
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        <b className="text-neutral-900">{step.value.toLocaleString()}</b>
                        {index === 0 ? "" : ` · ${rate(step.value, all[index - 1].value)} carried`}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className={`h-full rounded-full ${step.cls}`} style={{ width: `${Math.max(headline.assigned > 0 && step.value > 0 ? 4 : 0, (step.value / Math.max(1, headline.assigned)) * 100)}%` }} />
                    </div>
                    <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-400">{step.note}</p>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-600 ring-1 ring-neutral-200">
                A hold is credited to whoever worked the conversation, not to whoever pressed the button, because turning an inquiry into a
                reservation is a front desk action today.
              </p>
              <p className="m-0 mt-2 flex items-center gap-1.5 text-[11px] text-neutral-500">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                {headline.repliesSent.toLocaleString()} {headline.repliesSent === 1 ? "reply" : "replies"} sent in this period.
              </p>
            </section>

            <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
              <h2 className="m-0 text-sm font-black text-neutral-900">Day by day</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Inquiries assigned and group blocks agreed.</p>
              {plottedDays.every((day) => day.inquiries === 0 && day.blocks === 0) ? (
                <p className="m-0 py-10 text-center text-xs text-neutral-400">No activity to plot in this period.</p>
              ) : (
                <>
                  <div className="mt-3 flex h-28 items-end gap-px rounded-lg bg-neutral-50 p-1.5 ring-1 ring-neutral-100">
                    {plottedDays.map((day) => (
                      <div
                        key={day.date}
                        className="group relative flex h-full min-w-0 flex-1 flex-col justify-end gap-px"
                        title={`${shortDay(day.date)}: ${day.inquiries} ${day.inquiries === 1 ? "inquiry" : "inquiries"}, ${day.blocks} ${day.blocks === 1 ? "block" : "blocks"}`}
                      >
                        {day.blocks > 0 ? (
                          <div className="w-full rounded-t-sm bg-amber-400" style={{ height: `${(day.blocks / timelinePeak) * 40}%` }} />
                        ) : null}
                        {day.inquiries > 0 ? (
                          <div className="w-full rounded-t-sm bg-sky-400" style={{ height: `${Math.max(6, (day.inquiries / timelinePeak) * 60)}%` }} />
                        ) : (
                          // A day with nothing is drawn as a hairline rather
                          // than skipped. Collapsing empty days would compress
                          // a quiet fortnight into a flat, busy-looking bar.
                          <div className="w-full rounded-t-sm bg-neutral-200" style={{ height: "2px" }} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sky-400" />Inquiries assigned</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" />Group blocks agreed</span>
                    <span className="ml-auto">{shortDay(plottedDays[0].date)} to {shortDay(plottedDays[plottedDays.length - 1].date)}</span>
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
            <h2 className="m-0 text-sm font-black text-neutral-900">Group business outcome</h2>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">
              Agreeing a block is not the same as filling it. These are the blocks agreed in this period and where they ended up.
            </p>
            {(own ? [me].filter(Boolean) as Person[] : report.people).some((person) => person.groups.agreed > 0) ? (
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {(() => {
                  const source = own && me ? [me] : report.people;
                  const sum = (pick: (person: Person) => number) => source.reduce((total, person) => total + pick(person), 0);
                  const agreed = sum((person) => person.groups.agreed);
                  return [
                    { label: "Still holding", value: sum((person) => person.groups.live), cls: "bg-blue-50 text-blue-700", note: "Running towards a cut-off" },
                    { label: "Picked up", value: sum((person) => person.groups.pickedUp), cls: "bg-emerald-50 text-emerald-700", note: "Produced named guests" },
                    { label: "Released", value: sum((person) => person.groups.released), cls: "bg-neutral-100 text-neutral-600", note: "Rooms went back on sale" },
                    { label: "Cancelled", value: sum((person) => person.groups.cancelled), cls: "bg-red-50 text-red-600", note: "The agreement fell through" },
                  ].map((cell) => (
                    <div key={cell.label} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${cell.cls}`}>{cell.label}</span>
                      <p className="m-0 mt-2 text-lg font-black leading-none text-neutral-900">{cell.value}</p>
                      <p className="m-0 mt-1 text-[10px] leading-4 text-neutral-500">{cell.note}</p>
                      <p className="m-0 mt-0.5 text-[10px] font-bold text-neutral-600">{rate(cell.value, agreed)} of blocks agreed</p>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="m-0 mt-3 rounded-xl bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500 ring-1 ring-neutral-200">
                No group blocks were agreed in this period.
              </p>
            )}
          </section>

          {report.scope === "PROPERTY" ? (
            <section className="rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="m-0 text-sm font-black text-neutral-900">By person</h2>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">
                    Everyone on the sales roster, including anyone with nothing recorded.
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-600">
                  <Users className="h-3 w-3" />{report.people.length} on the roster
                </span>
              </div>
              {/* Eight columns stretched across a wide screen put every number
                  an inch from the header naming it, which is why one row of
                  data read as scattered. The name column absorbs the slack and
                  the figures keep fixed widths, so they stay in three tight
                  clusters that match how they are actually read: what came in,
                  what converted, what was agreed. */}
              <div className="mt-3 -mx-3.5 overflow-x-auto px-3.5 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[660px] border-collapse text-xs">
                  <colgroup>
                    <col />
                    <col className="w-[72px]" />
                    <col className="w-[72px]" />
                    <col className="w-[92px]" />
                    <col className="w-[64px]" />
                    <col className="w-[84px]" />
                    <col className="w-[68px]" />
                    <col className="w-[128px]" />
                  </colgroup>
                  <thead>
                    {/* Group band. Preflight is off, so the rules between
                        groups are inset shadows rather than borders. */}
                    <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">
                      <th className="pb-1" />
                      <th className="pb-1 text-center shadow-[inset_1px_0_0_0_rgb(229,229,229)]" colSpan={3}>Inbox</th>
                      <th className="pb-1 text-center shadow-[inset_1px_0_0_0_rgb(229,229,229)]" colSpan={2}>Converted</th>
                      <th className="pb-1 text-center shadow-[inset_1px_0_0_0_rgb(229,229,229)]" colSpan={2}>Group business</th>
                    </tr>
                    <tr className="text-[10px] uppercase tracking-wide text-neutral-500 shadow-[inset_0_-1px_0_0_rgb(212,212,212)]">
                      <th className="pb-2 pr-2 text-left font-bold">Person</th>
                      <th className="pb-2 px-2 text-right font-bold">Assigned</th>
                      <th className="pb-2 px-2 text-right font-bold">Replies</th>
                      <th className="pb-2 px-2 text-right font-bold">First reply</th>
                      <th className="pb-2 px-2 text-right font-bold">Held</th>
                      <th className="pb-2 px-2 text-right font-bold">Confirmed</th>
                      <th className="pb-2 px-2 text-right font-bold">Blocks</th>
                      <th className="pb-2 pl-2 text-right font-bold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.people.map((person) => {
                      const isViewer = person.userId === report.viewer.userId;
                      const idle = person.inbox.assigned === 0 && person.inbox.repliesSent === 0 && person.groups.agreed === 0;
                      return (
                        <tr
                          key={person.userId}
                          className={`shadow-[inset_0_1px_0_0_rgb(240,240,240)] transition ${isViewer ? "bg-emerald-50/40" : "hover:bg-neutral-50"}`}
                        >
                          <td className="py-2.5 pr-2">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-bold text-neutral-900">{person.name}</span>
                              {isViewer ? <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-black text-emerald-800">You</span> : null}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-neutral-500">
                              {person.roleLabel || "Staff"}
                              {idle ? " · nothing recorded" : ""}
                            </span>
                          </td>
                          <Figure value={person.inbox.assigned} groupStart />
                          <Figure value={person.inbox.repliesSent} />
                          <td className="py-2.5 px-2 text-right text-neutral-500">
                            {person.inbox.averageFirstResponseMinutes == null
                              ? <span className="text-neutral-300">not yet</span>
                              : <span className="tabular-nums text-neutral-600">{responseTime(person.inbox.averageFirstResponseMinutes)}</span>}
                          </td>
                          <Figure value={person.conversion.reachedHold} groupStart />
                          <Figure value={person.conversion.confirmed} strong />
                          <Figure value={person.groups.agreed} groupStart />
                          <td className="py-2.5 pl-2 text-right tabular-nums text-neutral-600">
                            {person.groups.value > 0 ? money(person.groups.value, person.groups.currency) : <span className="text-neutral-300">0</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* A roster of one needs no total: it would restate the row
                      directly above it. */}
                  {report.people.length > 1 ? (
                    <tfoot>
                      <tr className="shadow-[inset_0_1px_0_0_rgb(212,212,212)] text-[11px] font-bold text-neutral-700">
                        <td className="py-2.5 pr-2">Roster total</td>
                        <Figure value={report.totals.assigned} groupStart strongNeutral />
                        <Figure value={report.totals.repliesSent} strongNeutral />
                        <td className="py-2.5 px-2 text-right tabular-nums">
                          {report.totals.averageFirstResponseMinutes == null
                            ? <span className="font-normal text-neutral-300">not yet</span>
                            : responseTime(report.totals.averageFirstResponseMinutes)}
                        </td>
                        <Figure value={report.totals.reachedHold} groupStart strongNeutral />
                        <Figure value={report.totals.confirmed} strong />
                        <Figure value={report.totals.groupsAgreed} groupStart strongNeutral />
                        <td className="py-2.5 pl-2 text-right tabular-nums">{money(report.totals.groupValue, report.currency)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] leading-4 text-neutral-400">
                <span>Ordered by confirmed stays, then by the value of group business agreed.</span>
                {/* Belongs here, not in the page heading: it is the roster that
                    raises the question of who is missing from it. */}
                <span>Front desk and outlet staff are not on this roster.</span>
              </div>
            </section>
          ) : (
            <p className="m-0 flex items-start gap-2 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-[11px] leading-5 text-neutral-500 ring-1 ring-neutral-200">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
              This report covers your own work. Comparisons across the team are a management view, so the owner and managers see the whole
              roster and you see yourself.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One number in the roster table.
 *
 * `groupStart` draws the rule that separates Inbox from Converted from Group
 * business. Preflight is off, so it is an inset shadow: a bare `border-l` on a
 * table cell paints nothing here.
 *
 * A zero is greyed rather than printed in full strength. On a roster where most
 * people have a few numbers and several zeroes, equal weight makes the eye stop
 * on every cell; fading the zeroes leaves only what happened.
 */
function Figure({ value, groupStart, strong, strongNeutral }: {
  value: number;
  groupStart?: boolean;
  strong?: boolean;
  strongNeutral?: boolean;
}) {
  const colour = value === 0
    ? "text-neutral-300"
    : strong ? "font-bold text-emerald-800"
      : strongNeutral ? "text-neutral-800"
        : "text-neutral-600";
  return (
    <td className={`py-2.5 px-2 text-right tabular-nums ${colour} ${groupStart ? "shadow-[inset_1px_0_0_0_rgb(240,240,240)]" : ""}`}>
      {value.toLocaleString()}
    </td>
  );
}

function Stat({ icon, label, value, note, tone }: {
  icon: ReactNode;
  label: string;
  value: number | string;
  note: string;
  tone: "neutral" | "warn";
}) {
  const ring = tone === "warn" ? "ring-amber-200" : "ring-neutral-200";
  const chip = tone === "warn" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700";
  // Words are set near label size; a count carries at display size. One size for
  // both turns "No replies yet" into a headline announcing nothing happened.
  const size = typeof value === "number" ? "text-base sm:text-lg" : "text-xs sm:text-sm";
  return (
    <div className={`rounded-2xl bg-white p-3 ring-1 sm:p-3.5 ${ring}`}>
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
      <p className={`m-0 mt-1.5 truncate font-black leading-tight text-neutral-900 ${size}`}>{value}</p>
      <p className="m-0 mt-0.5 text-[11px] font-bold leading-4 text-neutral-700">{label}</p>
      <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{note}</p>
    </div>
  );
}
