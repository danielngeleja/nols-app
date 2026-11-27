/**
 * Where an event hire stands and what happens next, as one timeline:
 * details, owner confirmation, NoLSAF review, approval, then the steps that
 * follow approval (event booking, payout). Shared by the owner and partner pages.
 */
import { AlertTriangle, Check, Lock, PartyPopper } from "lucide-react";
import { STATUS_LABEL, STATUS_TONE, eat, type EventHireView } from "./eventHireTypes";

type StepState = "done" | "current" | "warn" | "upcoming";
type Step = { title: string; text: string; state: StepState };

const DOT: Record<StepState, string> = {
  done: "bg-[#02665e] text-white",
  current: "bg-white text-[#02665e] ring-2 ring-[#02665e]",
  warn: "bg-amber-500 text-white",
  upcoming: "bg-slate-100 text-slate-400",
};
const TITLE: Record<StepState, string> = {
  done: "text-slate-900",
  current: "text-[#02665e]",
  warn: "text-amber-900",
  upcoming: "text-slate-400",
};

function steps(view: EventHireView, audience: "owner" | "partner"): Step[] {
  const s = view.status;
  const sent = ["PENDING", "APPROVED", "PAUSED"].includes(s);
  const ready = view.problems.length === 0;
  const you = audience === "owner";

  const details: Step = sent || ready
    ? { title: "Details and photos", text: sent ? "Complete and sent." : "Complete.", state: "done" }
    : { title: "Details and photos", text: `${view.problems.length} thing${view.problems.length === 1 ? "" : "s"} still needed.`, state: "current" };

  let confirm: Step;
  if (view.consentCurrent && view.ownerConsentAt) {
    confirm = { title: "Owner confirms", text: `Confirmed ${view.ownerConsentVia === "SMS_LINK" ? "by SMS link" : "in the app"}, ${eat(view.ownerConsentAt)}.`, state: "done" };
  } else if (s === "AWAITING_OWNER") {
    confirm = { title: "Owner confirms", text: `SMS sent ${eat(view.confirmSentAt)}. ${view.confirmOpenedAt ? `Opened ${eat(view.confirmOpenedAt)}, not confirmed yet.` : "Not opened yet."}`, state: "current" };
  } else {
    confirm = { title: "Owner confirms", text: you ? "Tick that events are allowed in your space, then send." : "Send it to the owner. They confirm by SMS.", state: ready ? "current" : "upcoming" };
  }
  if (view.ownerObjectionNote && !sent) confirm = { title: "Owner confirms", text: `The owner said something is wrong: "${view.ownerObjectionNote}"`, state: "warn" };

  let review: Step;
  if (s === "PENDING") review = { title: "NoLSAF review", text: `Sent ${eat(view.submittedAt)}. NoLSAF checks the photos, guest numbers and prices.`, state: "current" };
  else if (s === "RETURNED") review = { title: "NoLSAF review", text: `Returned for changes${view.returnReason ? `: ${view.returnReason}` : "."}`, state: "warn" };
  else if (s === "APPROVED" || s === "PAUSED") review = { title: "NoLSAF review", text: `Checked ${eat(view.reviewedAt)}.`, state: "done" };
  else review = { title: "NoLSAF review", text: "NoLSAF checks the photos, guest numbers and prices.", state: "upcoming" };

  let approved: Step;
  if (s === "APPROVED") approved = { title: "Approved", text: `Approved ${eat(view.reviewedAt)}.`, state: "done" };
  else if (s === "PAUSED") approved = { title: "Paused by NoLSAF", text: view.pauseReason || "Not offered for events for now.", state: "warn" };
  else approved = { title: "Approved", text: `${you ? "Your space" : "The space"} is ready to be offered for events.`, state: "upcoming" };

  const live = s === "APPROVED";
  return [
    details,
    confirm,
    review,
    approved,
    { title: "Partners offer it for events", text: `When event booking opens, sales partners offer ${you ? "your" : "the"} space to clients. ${you ? "You get" : "The owner gets"} an SMS for each booking.`, state: live ? "current" : "upcoming" },
    { title: "After each event", text: `NoLSAF pays ${you ? "you" : "the owner"}. The client's deposit comes back unless damage is proven with photos and costs.`, state: "upcoming" },
  ];
}

export default function EventHireStatusCard({ view, audience }: { view: EventHireView; audience: "owner" | "partner" }) {
  const list = steps(view, audience);
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-solid border-slate-300 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><PartyPopper className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-900">{view.propertyTitle || "Event hire"}</p>
            <p className="m-0 text-xs text-slate-500">Hire for events</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${STATUS_TONE[view.status] || STATUS_TONE.NONE}`}>{STATUS_LABEL[view.status] || view.status}</span>
      </div>

      <div className="border-0 border-t border-solid border-slate-200 px-4 py-3">
        <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What happens next</p>
        <ol className="m-0 list-none p-0">
          {list.map((step, i) => (
            <li key={step.title} className="relative flex gap-3 pb-3 last:pb-0">
              {i < list.length - 1 ? (
                <span aria-hidden className={`absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-0.5 ${step.state === "done" ? "bg-[#02665e]/50" : "bg-slate-200"}`} />
              ) : null}
              <span className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${DOT[step.state]}`}>
                {step.state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.state === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={`m-0 text-[13px] font-semibold leading-5 ${TITLE[step.state]}`}>{step.title}</p>
                <p className={`m-0 text-[12px] leading-4 ${step.state === "upcoming" ? "text-slate-400" : "text-slate-600"}`}>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {view.locked ? (
        <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-2.5 text-[12px] leading-4 text-slate-600">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
          {view.status === "PENDING"
            ? "Locked while NoLSAF reviews it. Nothing can be changed. If something needs changing, NoLSAF returns it."
            : "Locked. To change approved event hire, call NoLSAF support."}
        </p>
      ) : view.problems.length > 0 && ["NONE", "DRAFT", "RETURNED", "AWAITING_OWNER"].includes(view.status) ? (
        <div className="border-0 border-t border-solid border-slate-200 bg-amber-50/60 px-4 py-3">
          <p className="m-0 text-xs font-semibold text-amber-900">Still needed</p>
          <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-amber-900">
            {view.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
