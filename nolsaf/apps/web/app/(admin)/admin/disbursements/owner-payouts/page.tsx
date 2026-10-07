"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import apiClient from "@/lib/apiClient";

/**
 * Owner payouts (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md): the payout date lock
 * across all owners. Shows each stay's stage in the same words owners see,
 * why a payout is on hold or waiting, and which lane a withdrawal took
 * (Automatic: sent by the system under the daily limit; Admin: paid through
 * the normal queue). Read only: holds clear through cancellations and
 * security review, money moves through the Queue and Batches.
 */

type Stage = "UNLOCKING" | "WAITING" | "ON_HOLD" | "READY" | "SENDING" | "UNDER_REVIEW" | "PAID" | "SETTLED" | "CANCELLED";

type OwnerPayout = {
  id: number;
  stage: Stage;
  ownerName: string | null;
  propertyTitle: string | null;
  guestName: string | null;
  checkIn: string;
  checkOut: string;
  bookingReference: string;
  claimNumber: string | null;
  amount: string | number | null;
  recoveryDeducted: number;
  rule: string;
  releaseAt: string;
  availableAt: string | null;
  reason: string | null;
  lane: "AUTO" | "MANUAL" | "OFFSET" | null;
  releasedAt: string | null;
  paidAt: string | null;
  updatedAt: string;
};

const STAGES: Record<Stage, { label: string; chip: string }> = {
  UNLOCKING: { label: "Unlocking", chip: "bg-neutral-100 text-neutral-700" },
  WAITING: { label: "Waiting", chip: "bg-neutral-100 text-neutral-700" },
  ON_HOLD: { label: "On hold", chip: "bg-amber-50 text-amber-800" },
  READY: { label: "Ready", chip: "bg-emerald-50 text-emerald-800" },
  SENDING: { label: "Sending", chip: "bg-sky-50 text-sky-800" },
  UNDER_REVIEW: { label: "Under review", chip: "bg-sky-50 text-sky-800" },
  PAID: { label: "Paid", chip: "bg-emerald-50 text-emerald-800" },
  SETTLED: { label: "Settled", chip: "bg-neutral-100 text-neutral-700" },
  CANCELLED: { label: "Cancelled", chip: "bg-rose-50 text-rose-700" },
};

const FILTERS: Array<{ key: string; label: string; stages: Stage[] }> = [
  { key: "active", label: "Active", stages: ["UNLOCKING", "WAITING", "ON_HOLD", "READY", "SENDING", "UNDER_REVIEW"] },
  { key: "hold", label: "On hold", stages: ["ON_HOLD"] },
  { key: "waiting", label: "Waiting", stages: ["WAITING"] },
  { key: "review", label: "Under review", stages: ["UNDER_REVIEW"] },
  { key: "ready", label: "Ready", stages: ["READY"] },
  { key: "unlocking", label: "Unlocking", stages: ["UNLOCKING"] },
  { key: "done", label: "Finished", stages: ["PAID", "SETTLED", "CANCELLED"] },
];

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

function tzs(value: string | number | null) {
  return `TSh ${Math.round(Number(value ?? 0)).toLocaleString("en-US")}`;
}

function eat(iso: string | null, withTime = true) {
  if (!iso) return "";
  return `${new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Africa/Dar_es_Salaam",
  })}${withTime ? " EAT" : ""}`;
}

function detail(p: OwnerPayout): string {
  switch (p.stage) {
    case "UNLOCKING":
      return `Unlocks ${eat(p.releaseAt)}${p.rule === "CARD_CHECKOUT_24H" ? " (card: checkout + 24h)" : ""}`;
    case "WAITING":
    case "ON_HOLD":
      return p.reason ?? "No reason recorded";
    case "READY":
      return `Ready since ${eat(p.availableAt ?? p.releaseAt)}. Owner has not withdrawn yet.`;
    case "SENDING":
      return "Withdrawn; system is sending it";
    case "UNDER_REVIEW":
      return p.reason ? `In the admin queue: ${p.reason}` : "In the admin queue";
    case "PAID":
      return `Paid ${eat(p.paidAt ?? p.releasedAt)}`;
    case "SETTLED":
      return "Used in full to recover an earlier refund";
    case "CANCELLED":
      return p.reason ?? "Booking cancelled or claim rejected";
  }
}

function LaneBadge({ lane }: { lane: OwnerPayout["lane"] }) {
  if (!lane) return <span className="text-xs text-neutral-300">Not withdrawn</span>;
  const map = {
    AUTO: { label: "Automatic", cls: "bg-[#02665e]/10 text-[#02665e]" },
    MANUAL: { label: "Admin", cls: "bg-neutral-100 text-neutral-700" },
    OFFSET: { label: "Recovery offset", cls: "bg-neutral-100 text-neutral-600" },
  } as const;
  const m = map[lane];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function AdminOwnerPayoutsPage() {
  const [payouts, setPayouts] = useState<OwnerPayout[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("active");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get<{ enabled: boolean; payouts: OwnerPayout[]; counts: Record<string, number> }>(
        "/api/admin/disbursements/owner-payouts"
      );
      setEnabled(Boolean(res.data?.enabled));
      setPayouts(res.data?.payouts ?? []);
      setCounts(res.data?.counts ?? {});
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load owner payouts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payouts
      .filter((p) => selected.stages.includes(p.stage))
      .filter((p) =>
        !q ||
        [p.ownerName, p.propertyTitle, p.guestName, p.claimNumber].some((v) => String(v ?? "").toLowerCase().includes(q))
      );
  }, [payouts, selected, query]);

  const count = (stages: Stage[]) => stages.reduce((total, s) => total + (counts[s] ?? 0), 0);
  const total = (stages: Stage[]) =>
    payouts.filter((p) => stages.includes(p.stage)).reduce((t, p) => t + (Number(p.amount) || 0), 0);

  const facts = [
    { label: "On hold", value: loading ? "..." : String(count(["ON_HOLD"])), detail: loading ? "" : `${tzs(total(["ON_HOLD"]))} stopped`, tone: count(["ON_HOLD"]) ? "text-amber-300" : "text-white" },
    { label: "Under review", value: loading ? "..." : String(count(["UNDER_REVIEW"])), detail: "In the admin queue", tone: "text-white" },
    { label: "Ready, not withdrawn", value: loading ? "..." : String(count(["READY"])), detail: loading ? "" : tzs(total(["READY"])), tone: "text-white" },
    { label: "Unlocking", value: loading ? "..." : String(count(["UNLOCKING", "WAITING"])), detail: loading ? "" : tzs(total(["UNLOCKING", "WAITING"])), tone: "text-white" },
  ];

  return (
    <div id="disbursement-owner-payouts" className="w-full min-w-0 space-y-5">
      <style>{`#disbursement-owner-payouts, #disbursement-owner-payouts * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Payout date lock</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Owner payouts</h1>
              <p className="m-0 mt-1 max-w-3xl text-sm text-white/60">
                Every stay from check-in to payment, in the words owners see. Holds clear through Cancellations and Security review;
                money moves through the Queue and Batches.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/management/settings#autopayouts" className={heroButton}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> Automatic payouts
              </Link>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && <p className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">{error}</p>}

      {!enabled ? (
        <p className="m-0 rounded-2xl border border-solid border-neutral-300 bg-white px-5 py-6 text-sm text-neutral-600">
          The payout date lock is off (PAYOUT_RELEASE_ENABLED). Owner claims follow the previous process until it is switched on.
        </p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-0 border-b border-solid border-neutral-200 px-4 pt-2 sm:px-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="-mb-px flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`h-10 shrink-0 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold ${
                    filter === f.key ? "border-[#02665e] text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums text-xs text-neutral-400">{count(f.stages)}</span>
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search owner, property, guest or claim"
              aria-label="Search owner payouts"
              className="mb-2 box-border h-9 w-full rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 lg:w-72"
            />
          </div>

          {loading ? (
            <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Loading owner payouts...</p>
          ) : visible.length === 0 ? (
            <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Nothing here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[120px]" />
                  <col className="w-[18%]" />
                  <col className="w-[22%]" />
                  <col className="w-[130px]" />
                  <col className="w-[120px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50/70">
                    {["Stage", "Owner", "Stay", "Amount", "Lane", "Detail"].map((h, i) => (
                      <th key={h} scope="col" className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500 ${i === 3 ? "text-right" : "text-left"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-0 border-b border-solid border-neutral-100 align-top last:border-b-0 hover:bg-neutral-50/60">
                      <td className="px-4 py-3">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STAGES[p.stage].chip}`}>{STAGES[p.stage].label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="m-0 truncate font-semibold text-neutral-900">{p.ownerName ?? "Owner"}</p>
                        <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-neutral-500">{p.claimNumber ?? "No claim"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/bookings/${encodeURIComponent(p.bookingReference)}`} className="block truncate font-semibold text-neutral-900 no-underline hover:text-[#02665e]">
                          {p.propertyTitle ?? "Property"}
                        </Link>
                        <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">
                          {p.guestName ? `${p.guestName} · ` : ""}
                          {eat(p.checkIn, false)} to {eat(p.checkOut, false)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="m-0 whitespace-nowrap font-bold tabular-nums text-neutral-900">{tzs(p.amount)}</p>
                        {p.recoveryDeducted > 0 && <p className="m-0 mt-0.5 text-[11px] text-neutral-500">less {tzs(p.recoveryDeducted)} recovery</p>}
                      </td>
                      <td className="px-4 py-3">
                        <LaneBadge lane={p.lane} />
                      </td>
                      <td className={`px-4 py-3 text-[13px] leading-5 ${p.stage === "ON_HOLD" ? "text-amber-800" : "text-neutral-600"}`}>{detail(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
