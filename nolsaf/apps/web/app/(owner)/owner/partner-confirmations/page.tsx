"use client";

/**
 * Partner confirmations: the owner says whether a NoLSAF sales partner really
 * brought them to the platform. Answers are only accepted from the signed-in
 * owner of the property; a link from SMS or email only highlights the request.
 *
 * The owner sees who the partner is (name, partner code, region, ID card
 * photo and its live validity, with a link to the public card check), never
 * what they earn. A "yes" also says how the partner reached them.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, CheckCircle2, ExternalLink, HelpCircle, IdCard, Loader2, MapPin, ShieldAlert, ShieldCheck, Star, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type PartnerCard = {
  valid: boolean;
  validity: string;
  message: string;
  cardNumber: string;
  photoUrl: string | null;
  expiresAt: string;
  verifyUrl: string;
};

type Confirmation = {
  id: number;
  status: string;
  requestedAt: string;
  expiresAt: string;
  respondedAt: string | null;
  contactChannel: string | null;
  note: string | null;
  property: { title: string };
  partner: {
    name: string;
    agentCode: string;
    region: string | null;
    territory: string | null;
    partnerSince: string | null;
    teamLead: boolean;
    card: PartnerCard | null;
  };
};

type Answer = "CONFIRMED" | "DENIED" | "UNKNOWN_PARTNER";

const ANSWER_LABEL: Record<string, { label: string; tone: string }> = {
  CONFIRMED: { label: "You confirmed", tone: "text-emerald-700 bg-emerald-50" },
  DENIED: { label: "You said no", tone: "text-rose-700 bg-rose-50" },
  UNKNOWN_PARTNER: { label: "You don't know them", tone: "text-rose-700 bg-rose-50" },
};

/** Same keys as OWNER_CONTACT_CHANNELS on the API. */
const CHANNELS: Array<{ key: string; label: string; past: string }> = [
  { key: "FACE_TO_FACE", label: "In person", past: "in person" },
  { key: "PHONE_CALL", label: "Phone call", past: "by phone call" },
  { key: "WHATSAPP", label: "WhatsApp", past: "on WhatsApp" },
  { key: "INSTAGRAM", label: "Instagram", past: "on Instagram" },
  { key: "FACEBOOK", label: "Facebook", past: "on Facebook" },
  { key: "TIKTOK", label: "TikTok", past: "on TikTok" },
  { key: "REFERRAL", label: "Someone referred them", past: "through a referral" },
  { key: "EVENT", label: "At an event", past: "at an event" },
  { key: "OTHER", label: "Another way", past: "another way" },
];
const CHANNEL_PAST = Object.fromEntries(CHANNELS.map((c) => [c.key, c.past]));

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function monthYear(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "NP";
}

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}

/** Who the partner is: ID card photo, code, region and whether the card holds up today. */
function PartnerPanel({ partner }: { partner: Confirmation["partner"] }) {
  const card = partner.card;
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-solid border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {card?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photoUrl} alt={`ID card photo of ${partner.name}`} className="h-14 w-14 flex-shrink-0 rounded-lg border border-solid border-slate-200 object-cover" />
        ) : (
          <span className="inline-flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-base font-semibold text-[#02665e]" aria-hidden>
            {initials(partner.name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-900">
            <span className="truncate">{partner.name}</span>
            {partner.teamLead ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                <Star className="h-3 w-3" aria-hidden /> Team lead
              </span>
            ) : null}
          </p>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-600">
            {partner.agentCode ? <span className="font-mono text-slate-700">{partner.agentCode}</span> : null}
            {partner.region || partner.territory ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400" aria-hidden />
                {[partner.territory, partner.region].filter(Boolean).join(", ")}
              </span>
            ) : null}
            {partner.partnerSince ? <span>Partner since {monthYear(partner.partnerSince)}</span> : null}
          </p>
          {card ? (
            <p className={`m-0 mt-1 inline-flex items-center gap-1 text-[12px] font-medium ${card.valid ? "text-emerald-700" : "text-rose-700"}`}>
              {card.valid ? <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> : <ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
              {card.valid ? `ID card ${card.cardNumber} is valid` : card.message}
            </p>
          ) : (
            <p className="m-0 mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500">
              <IdCard className="h-3.5 w-3.5" aria-hidden /> No ID card issued yet
            </p>
          )}
        </div>
      </div>
      {card ? (
        <a
          href={card.verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-800 no-underline transition hover:border-[#02665e] hover:text-[#02665e]"
        >
          <IdCard className="h-4 w-4" aria-hidden /> View ID card <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
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
  // The "yes" step: which request is open, and what the owner picked.
  const [confirming, setConfirming] = useState<number | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [note, setNote] = useState("");

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

  const openConfirm = (item: Confirmation) => {
    setConfirming(item.id);
    setChannel(null);
    setNote("");
    setError(null);
  };

  const answer = async (item: Confirmation, value: Answer) => {
    if (value === "CONFIRMED" && !channel) {
      setError("Choose how this partner reached you.");
      return;
    }
    setBusy(`${item.id}-${value}`);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post(`/api/owner/sales-confirmations/${item.id}/answer`, {
        answer: value,
        ...(value === "CONFIRMED" ? { contactChannel: channel } : {}),
        ...(value === "CONFIRMED" && note.trim() ? { note: note.trim() } : {}),
      });
      window.dispatchEvent(new Event("nols:partner-confirmations-changed"));
      setNotice(
        value === "CONFIRMED"
          ? `Thank you. ${item.partner.name} is confirmed as the partner who helped you list ${item.property.title}.`
          : "Thank you. NoLSAF will review this claim. Nobody will be credited for your property until it is resolved.",
      );
      setConfirming(null);
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
            {pending.map((item) => {
              const open = confirming === item.id;
              return (
                <li
                  key={item.id}
                  className={`rounded-xl border border-solid bg-white p-4 sm:p-5 ${highlight === item.id ? "border-[#02665e] ring-2 ring-[#02665e]/15" : "border-slate-200"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="m-0 min-w-0 text-[15px] font-semibold text-slate-900">
                      Did {item.partner.name} help you list {item.property.title} on NoLSAF?
                    </p>
                    <span className="text-[12px] text-slate-500">Answer by {eat(item.expiresAt)}</span>
                  </div>

                  <PartnerPanel partner={item.partner} />

                  {open ? (
                    <div className="mt-4 rounded-lg border border-solid border-[#02665e]/30 bg-[#02665e]/[0.03] p-3 sm:p-4">
                      <fieldset className="m-0 border-0 p-0">
                        <legend className="p-0 text-sm font-semibold text-slate-900">How did {item.partner.name} reach you?</legend>
                        <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup">
                          {CHANNELS.map((c) => {
                            const picked = channel === c.key;
                            return (
                              <button
                                key={c.key}
                                type="button"
                                role="radio"
                                aria-checked={picked}
                                onClick={() => setChannel(c.key)}
                                className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-solid px-3.5 text-[13px] font-medium [font-family:inherit] transition ${picked ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[#02665e] hover:text-[#02665e]"}`}
                              >
                                {picked ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                      <label className="mt-4 block text-sm font-semibold text-slate-900" htmlFor={`note-${item.id}`}>
                        Anything to add <span className="font-normal text-slate-500">(optional)</span>
                      </label>
                      <textarea
                        id={`note-${item.id}`}
                        value={note}
                        onChange={(e) => setNote(e.target.value.slice(0, 300))}
                        rows={2}
                        placeholder="For example, how they helped you set up your listing"
                        className="mt-1.5 w-full resize-y rounded-lg border border-solid border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 [font-family:inherit] outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                      />
                      <p className="m-0 mt-1 text-right text-[11px] text-slate-400">{note.length}/300</p>
                      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          disabled={Boolean(busy)}
                          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 [font-family:inherit] transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
                        </button>
                        <button
                          type="button"
                          onClick={() => void answer(item, "CONFIRMED")}
                          disabled={Boolean(busy) || !channel}
                          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:opacity-50"
                        >
                          {busy === `${item.id}-CONFIRMED` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm {item.partner.name.split(" ")[0]}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => openConfirm(item)}
                        disabled={Boolean(busy)}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Yes, they did
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
                  )}
                  <p className="m-0 mt-3 text-[12px] text-slate-500">
                    Your answer cannot be changed here once sent. NoLSAF never shows you or anyone else what a partner earns.
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section aria-labelledby="answered-heading" className="space-y-2">
          <h2 id="answered-heading" className="m-0 text-sm font-semibold text-slate-900">Your answers</h2>
          <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-xl border border-solid border-slate-200 bg-white p-0">
            {answered.map((item) => {
              const label = ANSWER_LABEL[item.status] ?? { label: item.status, tone: "text-slate-700 bg-slate-100" };
              const met = item.contactChannel ? CHANNEL_PAST[item.contactChannel] : null;
              return (
                <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium text-slate-900">{item.property.title}</p>
                    <p className="m-0 text-[12px] text-slate-500">
                      {item.partner.name}
                      {item.partner.agentCode ? ` · ${item.partner.agentCode}` : ""}
                      {met ? ` · met ${met}` : ""} · {eat(item.respondedAt)}
                    </p>
                    {item.note ? <p className="m-0 mt-0.5 text-[12px] text-slate-600">&ldquo;{item.note}&rdquo;</p> : null}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {item.partner.card ? (
                      <a href={item.partner.card.verifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">
                        <IdCard className="h-3.5 w-3.5" aria-hidden /> ID card
                      </a>
                    ) : null}
                    <span className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[12px] font-semibold ${label.tone}`}>{label.label}</span>
                  </div>
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
