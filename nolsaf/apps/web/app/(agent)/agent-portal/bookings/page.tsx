"use client";
// Agent portal — My bookings. The agent's requests and confirmed stays across
// all their hotels.
import { useEffect, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { AlertCircle, CheckCircle2, ClipboardList, Clock, FileText, Loader2, ReceiptText, ShieldCheck, Users, XCircle } from "lucide-react";

type Booking = {
  id: number; status: string; property: { id: number; title: string } | null;
  checkIn: string; checkOut: string; adults: number; children: number; rooms: number;
  currency: string; total: number; holdExpiresAt: string | null;
  receiptNumber: string | null; reservationStatus: string | null;
  payment: { token: string; status: string; amount: number; dueAt: string | null } | null; amountPaid: number; createdAt: string;
  commercial: { status: string; settled: boolean; received: number; invoice: { id: number; number: string; status: string; quotedTotal: number; payerMarkedPaidAt: string | null } | null };
  manifest: { status: string; incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST" | null; requiredGuests: number; guestsAdded: number; documentsUploaded: number; readyForCheckIn: boolean; reviewNote: string | null };
};

const STATUS: Record<string, { cls: string; label: string; Icon: any }> = {
  PENDING: { cls: "bg-amber-50 text-amber-700", label: "Awaiting approval", Icon: Clock },
  CONFIRMED: { cls: "bg-emerald-50 text-emerald-700", label: "Confirmed", Icon: CheckCircle2 },
  DECLINED: { cls: "bg-red-50 text-red-600", label: "Declined", Icon: XCircle },
  EXPIRED: { cls: "bg-neutral-100 text-neutral-500", label: "Expired", Icon: XCircle },
  CANCELLED: { cls: "bg-neutral-100 text-neutral-500", label: "Cancelled", Icon: XCircle },
};

const money = (n: number) => Math.round(n).toLocaleString();
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const initials = (name?: string | null) => String(name || "H").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "H";

const cellTones = { muted: "text-neutral-500", ok: "text-emerald-700", warn: "text-amber-700", info: "text-blue-700" } as const;

// One fact per cell, labelled, so the agent reads down a column instead of
// picking sentences apart. The hairline grid comes from gap-px over a tinted
// parent, which keeps the dividers correct however many cells a row holds.
function Cell({ label, value, detail, tone = "muted", icon }: { label: string; value: string; detail?: string; tone?: keyof typeof cellTones; icon?: any }) {
  const Icon = icon;
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-400">{label}</span>
      <b className="mt-1 flex items-center gap-1.5 break-words text-[12px] font-bold text-neutral-800">{Icon ? <Icon className={`h-3.5 w-3.5 flex-none ${cellTones[tone]}`} /> : null}<span className="min-w-0 break-words">{value}</span></b>
      {detail ? <span className={`mt-0.5 block break-words text-[11px] font-semibold leading-4 ${cellTones[tone]}`}>{detail}</span> : null}
    </div>
  );
}

export default function AgentBookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiClient.get<any>("/api/agent-portal/bookings");
        if (live) setBookings(res.data?.bookings ?? []);
      } catch (e: any) {
        if (live) setError(e?.response?.data?.error || "Failed to load your bookings");
      }
    })();
    return () => { live = false; };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="m-0 flex items-center gap-2 text-lg font-bold text-neutral-900"><ClipboardList className="h-5 w-5 text-emerald-600" /> My bookings</h1>
        <p className="m-0 mt-1 text-[13px] text-neutral-500">Your requests and confirmed stays across every hotel that approved you.</p>
      </div>

      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

      {bookings === null ? (
        <div className="flex items-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-solid border-neutral-200 bg-white p-8 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="m-0 mt-2 text-[15px] font-bold text-neutral-700">No bookings yet</p>
          <p className="m-0 mt-1 text-[13px] text-neutral-500">Your bookings will show here once you make one.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {bookings.map((b) => {
            const s = STATUS[b.status] ?? { cls: "bg-neutral-100 text-neutral-600", label: b.status, Icon: Clock };
            const Icon = s.Icon;
            const workspaceAction = b.commercial.settled ? (b.manifest.status === "NOT_STARTED" ? "Add travellers" : b.manifest.status === "CHANGES_REQUESTED" ? "Correct travellers" : "Open booking") : b.commercial.invoice ? "Open invoice" : "Open booking";
            const nights = nightsBetween(b.checkIn, b.checkOut);
            const invoice = b.commercial.invoice;
            // Emphasise the action only while it is the agent's move: paying
            // the invoice, or adding travellers once the hotel has been paid.
            const primaryAction = (Boolean(invoice) && !b.commercial.settled) || (b.commercial.settled && b.manifest.status !== "VERIFIED");
            const cells = [
              <Cell key="stay" label="Stay" value={`${fmt(b.checkIn)} to ${fmt(b.checkOut)}`} detail={plural(nights, "night")} />,
              <Cell key="party" label="Rooms & guests" value={plural(b.rooms, "room")} detail={`${plural(b.adults, "adult")}${b.children ? `, ${b.children} ${b.children === 1 ? "child" : "children"}` : ""}`} />,
            ];
            if (b.status === "PENDING") {
              cells.push(<Cell key="approval" label="Approval" value="Awaiting the hotel" detail={b.holdExpiresAt ? `Held until ${fmt(b.holdExpiresAt)}` : "No hold on these rooms"} tone="warn" icon={Clock} />);
            }
            if (b.status === "CONFIRMED") {
              cells.push(
                <Cell key="invoice" label="Invoice" value={invoice?.number ?? "Not issued yet"} detail={b.commercial.settled ? "Payment received by hotel" : invoice?.payerMarkedPaidAt ? "Declared, hotel is verifying" : invoice ? invoice.status.toLowerCase() : "Waiting on the hotel"} tone={b.commercial.settled ? "ok" : invoice?.payerMarkedPaidAt ? "warn" : "muted"} icon={ReceiptText} />,
                <Cell key="travellers" label="Travellers" value={`${b.manifest.guestsAdded} of ${b.manifest.requiredGuests} added`} detail={b.manifest.status.replace(/_/g, " ").toLowerCase()} tone={b.manifest.status === "VERIFIED" ? "ok" : b.manifest.status === "CHANGES_REQUESTED" ? "warn" : "info"} icon={b.manifest.status === "VERIFIED" ? ShieldCheck : b.manifest.status === "CHANGES_REQUESTED" ? AlertCircle : Users} />,
                <Cell key="extras" label="Food, drinks & extras" value={b.manifest.incidentalBilling === "AGENCY" ? "Agency pays" : "Guests pay individually"} detail="Declared billing responsibility" />,
              );
            }
            return (
              <li key={b.id} className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-neutral-900 text-[11px] font-extrabold text-white">{initials(b.property?.title)}</span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[15px] font-extrabold tracking-tight text-neutral-950">{b.property?.title ?? "Hotel"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}><Icon className="h-3 w-3" /> {s.label}</span>
                        {b.status === "CONFIRMED" && b.commercial.settled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"><CheckCircle2 className="h-3 w-3" /> Paid</span>
                        )}
                        {b.receiptNumber && <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-500">{b.receiptNumber}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    <div className="sm:text-right">
                      <span className="block text-[17px] font-extrabold tabular-nums tracking-tight text-neutral-950">{b.currency} {money(invoice?.quotedTotal ?? b.total)}</span>
                      <span className="block text-[10px] font-semibold text-neutral-400">booked {fmt(b.createdAt)}</span>
                    </div>
                    {b.status === "CONFIRMED" && (
                      <Link href={`/agent-portal/bookings/${b.id}/guests`} className={`box-border inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid px-3.5 text-[13px] font-bold no-underline transition ${b.manifest.status === "CHANGES_REQUESTED" ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : primaryAction ? "border-neutral-900 bg-neutral-900 text-white shadow-sm hover:bg-neutral-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50"}`}>{invoice && !b.commercial.settled ? <ReceiptText className="h-4 w-4" /> : <Users className="h-4 w-4" />} {workspaceAction}</Link>
                    )}
                    {b.status === "CONFIRMED" && b.commercial.settled && (
                      <Link href={`/api/agent-portal/bookings/${b.id}/voucher`} target="_blank" rel="noreferrer" className="box-border inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-neutral-200 bg-white px-3.5 text-[13px] font-bold text-neutral-700 no-underline transition hover:border-neutral-400 hover:bg-neutral-50"><FileText className="h-4 w-4" /> Voucher</Link>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{cells}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
