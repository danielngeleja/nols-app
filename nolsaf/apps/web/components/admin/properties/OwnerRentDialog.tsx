"use client";

/**
 * Shown when an admin approves a partner-listed long stay whose owner has not
 * yet confirmed the rent (docs/LONG_STAY_RENTALS.md 15.1): the terms, the SMS
 * timeline (sent, opened, confirmed), the owner's number to call, a resend,
 * and approve once the owner agreed by phone.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Clock3, Eye, Loader2, MessageSquareText, Phone, RefreshCw, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type OwnerRentBlock = {
  summary: string;
  lines: Array<{ label: string; value: string }>;
  sentAt: string | null;
  openedAt: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  partnerName: string | null;
};

function eat(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${when} EAT`;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type StepTone = "done" | "wait" | "fail";

function Step({ tone, icon: Icon, title, detail, last }: { tone: StepTone; icon: typeof Check; title: string; detail: string; last?: boolean }) {
  const dot = tone === "done" ? "bg-[#02665e] text-white" : tone === "fail" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last ? <span className={`absolute left-[13px] top-7 bottom-0 w-px ${tone === "done" ? "bg-[#02665e]/40" : "bg-slate-200"}`} aria-hidden /> : null}
      <span className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${dot}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={`m-0 text-[13px] font-semibold ${tone === "fail" ? "text-rose-700" : tone === "done" ? "text-slate-900" : "text-slate-500"}`}>{title}</p>
        <p className="m-0 text-[12px] text-slate-500">{detail}</p>
      </div>
    </li>
  );
}

export default function OwnerRentDialog({
  propertyId,
  block,
  busy,
  onClose,
  onApproveByPhone,
}: {
  propertyId: number;
  block: OwnerRentBlock;
  busy: boolean;
  onClose: () => void;
  onApproveByPhone: () => void;
}) {
  const [state, setState] = useState(block);
  const [agreed, setAgreed] = useState(false);
  const [resending, setResending] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const owner = state.ownerName || "The owner";
  const [rent, ...rest] = state.lines;

  const resend = async () => {
    setResending(true);
    setNote(null);
    try {
      const { data } = await apiClient.post(`/api/admin/properties/${propertyId}/owner-rent/resend`);
      if (data?.alreadyConfirmed) {
        setNote({ tone: "ok", text: "The owner has just confirmed. Approve again." });
      } else {
        setState((s) => ({ ...s, sentAt: data?.sentAt ?? new Date().toISOString(), openedAt: null }));
        setNote({ tone: "ok", text: "A new SMS is on its way. The old link no longer works." });
      }
    } catch (error: any) {
      setNote({ tone: "error", text: error?.response?.data?.error || "Could not resend the SMS." });
    } finally {
      setResending(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div id="owner-rent-dialog" role="dialog" aria-modal="true" aria-labelledby="owner-rent-title" className="relative max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <style>{`#owner-rent-dialog, #owner-rent-dialog * { box-sizing: border-box; }`}</style>

        <div className="flex items-start gap-3 border-0 border-b border-solid border-slate-100 px-5 pb-4 pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Clock3 className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 id="owner-rent-title" className="m-0 text-[16px] font-semibold text-slate-900">Waiting for the owner</h2>
            <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{owner} must agree the rent {state.partnerName || "the partner"} set before this goes live.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* The terms */}
          {rent ? (
            <div className="rounded-lg border border-solid border-slate-200">
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-3">
                <span className="text-[12px] font-medium uppercase tracking-wide text-slate-400">{rent.label}</span>
                <span className="text-[20px] font-bold tabular-nums text-slate-900">{rent.value}</span>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-slate-100 bg-slate-100">
                {rest.map((line) => (
                  <div key={line.label} className="bg-white px-3.5 py-2">
                    <dt className="text-[11px] text-slate-400">{line.label}</dt>
                    <dd className="m-0 text-[12.5px] font-semibold text-slate-800">{line.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* SMS timeline */}
          <ol className="m-0 list-none p-0">
            <Step
              tone={state.sentAt ? "done" : "fail"}
              icon={MessageSquareText}
              title={state.sentAt ? "SMS sent" : "SMS not sent"}
              detail={state.sentAt ? `${eat(state.sentAt)}, ${ago(state.sentAt)}` : "The text could not be delivered. Resend it or call."}
            />
            <Step
              tone={state.openedAt ? "done" : "wait"}
              icon={Eye}
              title={state.openedAt ? "Link opened" : "Not opened yet"}
              detail={state.openedAt ? `${eat(state.openedAt)}, ${ago(state.openedAt)}` : state.sentAt ? "The owner has not tapped the link." : "Nothing to open yet."}
            />
            <Step tone="wait" icon={Check} title="Rent not confirmed" detail="Waiting for the owner to tap Yes, or for your call." last />
          </ol>

          {/* Who to call */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3.5 py-3">
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] font-semibold text-slate-900">{owner}</p>
              <p className="m-0 font-mono text-[12.5px] text-slate-500">{state.ownerPhone || "No phone on file"}</p>
            </div>
            {state.ownerPhone ? (
              <a href={`tel:${state.ownerPhone.replace(/\s/g, "")}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 no-underline hover:border-[#02665e]/40 hover:text-[#02665e]">
                <Phone className="h-3.5 w-3.5" aria-hidden /> Call
              </a>
            ) : null}
          </div>

          {note ? <p className={`m-0 text-[12.5px] ${note.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{note.text}</p> : null}

          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-5 text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#02665e]" />
            I called {owner} and they agreed to these terms.
          </label>
        </div>

        <div className="flex flex-wrap gap-2 border-0 border-t border-solid border-slate-100 px-5 py-4">
          <button type="button" onClick={resend} disabled={resending || busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-solid border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Resend SMS
          </button>
          <button
            type="button"
            onClick={() => { if (!agreed) { setNote({ tone: "error", text: "Tick the box once the owner agreed on the phone." }); return; } onApproveByPhone(); }}
            disabled={busy}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-[13px] font-semibold text-white hover:bg-[#014e47] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
