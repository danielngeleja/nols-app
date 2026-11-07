"use client";

/**
 * Partner confirmations: the owner says whether a NoLSAF sales partner really
 * brought them to the platform. Answers are only accepted from the signed-in
 * owner of the property; a link from SMS or email only highlights the request.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, HelpCircle, Loader2, ShieldCheck, UserRound, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Confirmation = {
  id: number;
  status: string;
  requestedAt: string;
  expiresAt: string;
  respondedAt: string | null;
  property: { title: string };
  partner: { name: string; agentCode: string; region: string | null };
};

type Answer = "CONFIRMED" | "DENIED" | "UNKNOWN_PARTNER";

const ANSWER_LABEL: Record<string, { label: string; tone: string }> = {
  CONFIRMED: { label: "You confirmed", tone: "text-emerald-700 bg-emerald-50" },
  DENIED: { label: "You said no", tone: "text-rose-700 bg-rose-50" },
  UNKNOWN_PARTNER: { label: "You don't know them", tone: "text-rose-700 bg-rose-50" },
};

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}

function PartnerConfirmations() {
  const params = useSearchParams();
  const reference = params.get("r");
  const [pending, setPending] = useState<Confirmation[]>([]);
  const [answered, setAnswered] = useState<Confirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get<{ pending: Confirmation[]; answered: Confirmation[] }>("/api/owner/sales-confirmations");
      setPending(data.pending ?? []);
      setAnswered(data.answered ?? []);
    } catch (cause) {
      setError(errorText(cause, "Could not load partner confirmations."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A link reference only points at the owner's own request. It confirms nothing.
  useEffect(() => {
    if (!reference) return;
    apiClient
      .post<{ id: number }>("/api/owner/sales-confirmations/resolve", { reference })
      .then(({ data }) => setHighlight(data.id))
      .catch(() => setHighlight(null))
      .finally(() => {
        // Keep the reference out of history and screenshots once used.
        try {
          window.history.replaceState(null, "", "/owner/partner-confirmations");
        } catch {
          /* ignore */
        }
      });
  }, [reference]);

  const answer = async (item: Confirmation, value: Answer) => {
    setBusy(`${item.id}-${value}`);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post(`/api/owner/sales-confirmations/${item.id}/answer`, { answer: value });
      window.dispatchEvent(new Event("nols:partner-confirmations-changed"));
      setNotice(
        value === "CONFIRMED"
          ? `Thank you. ${item.partner.name} is confirmed as the partner who helped you list ${item.property.title}.`
          : "Thank you. NoLSAF will review this claim. Nobody will be credited for your property until it is resolved.",
      );
      await load();
    } catch (cause) {
      setError(errorText(cause, "Your answer was not saved. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="partner-confirmations" className="mx-auto w-full max-w-3xl space-y-5">
      <style>{`#partner-confirmations, #partner-confirmations * { box-sizing: border-box; }`}</style>

      <header className="rounded-xl border border-solid border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">Partner confirmations</h1>
            <p className="m-0 mt-1 text-sm text-slate-600">
              When a NoLSAF sales partner says they helped you list a property, we ask you to confirm it. Only you can answer, from your own account.
            </p>
          </div>
        </div>
      </header>

      {error && <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {notice && <p className="m-0 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}

      <section aria-labelledby="pending-heading" className="space-y-3">
        <h2 id="pending-heading" className="m-0 text-sm font-semibold text-slate-900">
          Waiting for your answer {pending.length ? <span className="font-normal text-slate-500">({pending.length})</span> : null}
        </h2>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-solid border-slate-200 bg-white p-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-xl border border-solid border-slate-200 bg-white p-5 text-sm text-slate-600">
            Nothing to answer right now.
          </div>
        ) : (
          <ul className="m-0 list-none space-y-3 p-0">
            {pending.map((item) => (
              <li
                key={item.id}
                className={`rounded-xl border border-solid bg-white p-4 sm:p-5 ${highlight === item.id ? "border-[#02665e] ring-2 ring-[#02665e]/15" : "border-slate-200"}`}
              >
                <p className="m-0 text-[15px] font-semibold text-slate-900">
                  Did {item.partner.name} help you list {item.property.title} on NoLSAF?
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    {item.partner.name}
                    {item.partner.agentCode ? <span className="font-mono text-[12px] text-slate-500">{item.partner.agentCode}</span> : null}
                  </span>
                  {item.partner.region ? <span>{item.partner.region}</span> : null}
                  <span className="text-slate-500">Answer by {eat(item.expiresAt)}</span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void answer(item, "CONFIRMED")}
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:opacity-50"
                  >
                    {busy === `${item.id}-CONFIRMED` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Yes, they did
                  </button>
                  <button
                    type="button"
                    onClick={() => void answer(item, "DENIED")}
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 [font-family:inherit] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                  >
                    {busy === `${item.id}-DENIED` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} No, they didn&apos;t
                  </button>
                  <button
                    type="button"
                    onClick={() => void answer(item, "UNKNOWN_PARTNER")}
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 [font-family:inherit] transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === `${item.id}-UNKNOWN_PARTNER` ? <Loader2 className="h-4 w-4 animate-spin" /> : <HelpCircle className="h-4 w-4" />} I don&apos;t know them
                  </button>
                </div>
                <p className="m-0 mt-3 text-[12px] text-slate-500">
                  Your answer cannot be changed here once sent. NoLSAF never shows you or anyone else what a partner earns.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section aria-labelledby="answered-heading" className="space-y-2">
          <h2 id="answered-heading" className="m-0 text-sm font-semibold text-slate-900">Your answers</h2>
          <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-xl border border-solid border-slate-200 bg-white p-0">
            {answered.map((item) => {
              const label = ANSWER_LABEL[item.status] ?? { label: item.status, tone: "text-slate-700 bg-slate-100" };
              return (
                <li key={item.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium text-slate-900">{item.property.title}</p>
                    <p className="m-0 text-[12px] text-slate-500">
                      {item.partner.name}
                      {item.partner.agentCode ? ` · ${item.partner.agentCode}` : ""} · {eat(item.respondedAt)}
                    </p>
                  </div>
                  <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[12px] font-semibold ${label.tone}`}>{label.label}</span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-[12px] text-slate-500">Answered by mistake? Contact NoLSAF support and we can ask you again.</p>
        </section>
      )}
    </div>
  );
}

export default function PartnerConfirmationsPage() {
  return (
    <Suspense fallback={null}>
      <PartnerConfirmations />
    </Suspense>
  );
}
