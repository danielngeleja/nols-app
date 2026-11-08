"use client";

/**
 * The sales partner's digital ID card: show it to a property owner, download
 * it, or send it. The owner scans the QR code (or types the card code) and
 * NoLSAF confirms live that this is a current sales partner.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Copy, Download, ExternalLink, IdCard, Loader2, RefreshCw, ScanFace, Share2, ShieldCheck, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import { drawIdCard } from "@/components/sales/idCardCanvas";

type Card = {
  cardNumber: string;
  code: string;
  verifyUrl: string;
  status: string;
  validity: string;
  validityText: string;
  photoUrl: string;
  issuedAt: string;
  expiresAt: string;
  verifyCount: number;
  lastVerifiedAt: string | null;
  holder: { name: string; agentCode: string; level: string; region: string | null; territory: string | null; teamLead?: boolean };
};

type Review = { status: "PENDING" | "REJECTED"; cardNumber: string; photoUrl: string; requestedAt: string; decidedAt: string | null; reason: string | null };
type Requirements = { activePartner: boolean; activeContract: boolean; profilePhoto: boolean };
type Preview = { name: string; agentCode: string; region: string | null; territory: string | null; photoUrl: string | null; teamLead: boolean; expiresAt: string | null };

function eat(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}

export default function SalesIdCardPage() {
  const [card, setCard] = useState<Card | null>(null);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [cancelled, setCancelled] = useState<{ cardNumber: string; at: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/sales/id-card");
      setCard(data.card ?? null);
      setRequirements(data.requirements ?? null);
      setPreview(data.preview ?? null);
      setReview(data.review ?? null);
      setCancelled(data.cancelled ?? null);
    } catch (cause) {
      setError(errorText(cause, "Could not load your ID card."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!card || !canvasRef.current) return;
    void drawIdCard(canvasRef.current, {
      name: card.holder.name,
      agentCode: card.holder.agentCode,
      cardNumber: card.cardNumber,
      code: card.code,
      region: card.holder.region,
      territory: card.holder.territory,
      photoUrl: card.photoUrl,
      expiresAt: card.expiresAt,
      verifyUrl: card.verifyUrl,
      teamLead: Boolean(card.holder.teamLead),
    });
  }, [card]);

  // Before the first card: draw the partner's own card as a preview. No code,
  // and the QR only opens the NoLSAF home page, so it proves nothing.
  useEffect(() => {
    if (card || !preview || !previewRef.current) return;
    void drawIdCard(previewRef.current, {
      name: preview.name,
      agentCode: preview.agentCode,
      cardNumber: "PREVIEW",
      code: "ISSUE TO ACTIVATE",
      region: preview.region,
      territory: preview.territory,
      photoUrl: preview.photoUrl || "data:,",
      expiresAt: preview.expiresAt || new Date().toISOString(),
      verifyUrl: "https://nolsaf.com",
      teamLead: preview.teamLead,
    });
  }, [card, preview]);

  const issue = async () => {
    setBusy("issue");
    setError("");
    setNotice("");
    try {
      const { data } = await apiClient.post("/api/sales/id-card", {});
      setReview(data.review ?? null);
      setConfirmReplace(false);
      setNotice(card
        ? "Sent for a photo check. Your current card keeps working until NoLSAF approves the new one."
        : "Sent for a photo check. You will be notified the moment your card is active.");
    } catch (cause) {
      setError(errorText(cause, "Could not issue your ID card."));
    } finally {
      setBusy(null);
    }
  };

  const pngBlob = () =>
    new Promise<Blob | null>((resolve) => {
      if (!canvasRef.current) return resolve(null);
      try {
        canvasRef.current.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });

  const fileName = () => `NoLSAF-ID-${card?.cardNumber ?? "card"}.png`;

  const download = async () => {
    const blob = await pngBlob();
    if (!blob) return setError("The card image could not be created on this device.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const shareText = () =>
    card ? `My NoLSAF representative ID: ${card.holder.name} (${card.holder.agentCode}). Verify it live with NoLSAF: ${card.verifyUrl}` : "";

  const share = async () => {
    if (!card) return;
    const blob = await pngBlob();
    const file = blob ? new File([blob], fileName(), { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "NoLSAF representative ID", text: shareText() });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "NoLSAF representative ID", text: shareText(), url: card.verifyUrl });
        return;
      }
    } catch {
      return; // the partner closed the share sheet
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText())}`, "_blank", "noopener");
  };

  const copyLink = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.verifyUrl);
      setNotice("Verification link copied.");
    } catch {
      setError("Copying is blocked on this device. Use Share instead.");
    }
  };

  const ready = Boolean(requirements && requirements.activePartner && requirements.activeContract && requirements.profilePhoto);
  const checklist = [
    { ok: !!requirements?.activePartner, label: "Active partner account", help: "Your partner account is paused. Contact NoLSAF support.", href: "/sales/support", action: "Get help" },
    { ok: !!requirements?.activeContract, label: "Active agreement with NoLSAF", help: "Sign or renew your agreement first.", href: "/sales/contract", action: "Open agreement" },
    { ok: !!requirements?.profilePhoto, label: "Clear profile photo of your face", help: "It is printed on the card, so owners can match it to you.", href: "/account", action: "Add photo" },
  ];
  const pending = review?.status === "PENDING";
  const rejected = review?.status === "REJECTED";

  // Where the card request stands. NoLSAF checks every new photo before a card verifies.
  const reviewBanner = review ? (
    <section className={`mt-5 flex flex-col gap-4 rounded-lg border border-solid p-4 sm:flex-row sm:items-center ${pending ? "border-amber-200 bg-amber-50/60" : "border-rose-200 bg-rose-50/60"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={review.photoUrl} alt="The photo on your card request" className="h-20 w-16 shrink-0 rounded-md border border-solid border-white object-cover shadow-sm" />
      <div className="min-w-0 flex-1">
        <p className={`m-0 flex items-center gap-2 text-sm font-semibold ${pending ? "text-amber-900" : "text-rose-800"}`}>
          {pending ? <Clock className="h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0" aria-hidden />}
          {pending ? `Card ${review.cardNumber} is waiting for a photo check` : `The photo on card ${review.cardNumber} was not approved`}
        </p>
        <p className="m-0 mt-1 text-[13px] text-slate-700">
          {pending
            ? card
              ? "NoLSAF checks that the photo is a clear face of you. Your current card keeps working until then."
              : "NoLSAF checks that the photo is a clear face of you. The card verifies the moment it is approved."
            : `${review.reason ? `Reason: ${review.reason}. ` : ""}Upload a clear, recent photo of your face, then request your card again.`}
        </p>
        {pending ? <p className="m-0 mt-1 text-[12px] text-slate-500">Requested {eat(review.requestedAt)}</p> : null}
      </div>
      {rejected ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/account" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 no-underline hover:bg-slate-50">
            <ScanFace className="h-4 w-4" aria-hidden /> Change photo
          </Link>
          <button type="button" onClick={() => void issue()} disabled={busy === "issue" || !ready} className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 text-sm font-semibold text-white [font-family:inherit] disabled:opacity-50">
            {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Request again
          </button>
        </div>
      ) : null}
    </section>
  ) : null;

  const photoRules = (
    <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><ScanFace className="h-4 w-4 text-slate-500" aria-hidden /> Photo that gets approved</p>
      <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12.5px] text-slate-600">
        {["A real, recent photo of your face", "Only you, facing the camera", "No sunglasses, mask, hat or heavy filter", "Plain background, good light"].map((rule) => (
          <li key={rule} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />{rule}</li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-[12px] text-slate-500">Logos, drawings, objects or someone else are rejected. Owners must be able to match the face to you.</p>
    </section>
  );

  return (
    <SalesShell>
      <div id="sales-id-card">
        <style>{`#sales-id-card, #sales-id-card * { box-sizing: border-box; }`}</style>
        <SalesPageHeader
          icon={IdCard}
          title="My ID card"
          description="Show it or send it to property owners. They scan the code and NoLSAF confirms, live, that you are an authorised NoLSAF representative."
        />

        {error && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        {notice && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

        {!loading ? reviewBanner : null}

        {loading ? null : cancelled && !card ? (
          <section className="mt-5 overflow-hidden rounded-lg border border-solid border-rose-200 bg-white">
            <div className="flex items-start gap-3 border-0 border-b border-solid border-rose-100 bg-rose-50 px-5 py-4">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-semibold text-rose-900">Your ID card was cancelled by NoLSAF</p>
                <p className="m-0 mt-0.5 text-[13px] text-rose-900/80">
                  Card {cancelled.cardNumber}{cancelled.at ? `, ${eat(cancelled.at)}` : ""}. It no longer verifies, so do not show it to owners.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-[13px] text-slate-600">Only NoLSAF can issue your next card. Contact support to talk about it.</p>
              <Link href="/sales/support" className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014d47]">
                Contact support
              </Link>
            </div>
          </section>
        ) : null}

        {loading ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : card ? (
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="rounded-lg border border-solid border-slate-200 bg-white p-3 sm:p-5">
              <canvas ref={canvasRef} className="block h-auto w-full rounded-xl shadow-[0_18px_40px_-26px_rgba(2,102,94,0.55)]" aria-label={`ID card for ${card.holder.name}`} />
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => void share()} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47]">
                  <Share2 className="h-4 w-4" /> Share
                </button>
                <button type="button" onClick={() => void download()} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 [font-family:inherit] hover:bg-slate-50">
                  <Download className="h-4 w-4" /> Download
                </button>
                <button type="button" onClick={() => void copyLink()} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 [font-family:inherit] hover:bg-slate-50">
                  <Copy className="h-4 w-4" /> Copy link
                </button>
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
                <p className={`m-0 flex items-start gap-2 text-sm font-semibold ${card.validity === "VALID" ? "text-emerald-700" : "text-rose-700"}`}>
                  {card.validity === "VALID" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {card.validity === "VALID" ? "Valid now" : "Not valid"}
                </p>
                <p className="m-0 mt-1 text-[13px] text-slate-600">{card.validityText}</p>
                <dl className="m-0 mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Card</dt><dd className="m-0 font-mono text-slate-800">{card.cardNumber}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Valid until</dt><dd className="m-0 text-slate-800">{eat(card.expiresAt)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Checked by owners</dt><dd className="m-0 text-slate-800">{card.verifyCount} {card.verifyCount === 1 ? "time" : "times"}</dd></div>
                  {card.lastVerifiedAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">Last check</dt><dd className="m-0 text-slate-800">{eat(card.lastVerifiedAt)}</dd></div>}
                </dl>
                <a href={card.verifyUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#02665e] no-underline hover:underline">
                  See what owners see <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </section>

              <section className="rounded-lg border border-solid border-slate-200 bg-white p-4 text-[13px] text-slate-600">
                <p className="m-0 font-semibold text-slate-900">Using your card well</p>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-4">
                  <li>Let the owner scan the code themselves, on their own phone.</li>
                  <li>Never ask an owner for cash or a payment. Payments only go through NoLSAF.</li>
                  <li>Lost your phone, or changed your photo? Replace the card below.</li>
                </ul>
              </section>

              {photoRules}

              <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
                {confirmReplace ? (
                  <>
                    <p className="m-0 text-[13px] text-slate-700">Your latest profile photo goes to NoLSAF for a quick check. Your current card keeps working until the new one is approved, then the old one stops verifying.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void issue()} disabled={busy === "issue"} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border-0 bg-rose-600 px-3 text-sm font-semibold text-white [font-family:inherit] disabled:opacity-50">
                        {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Request new card
                      </button>
                      <button type="button" onClick={() => setConfirmReplace(false)} className="h-10 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 [font-family:inherit]">Cancel</button>
                    </div>
                  </>
                ) : pending ? (
                  <p className="m-0 flex items-center gap-2 text-[13px] text-amber-900"><Clock className="h-4 w-4 shrink-0" aria-hidden /> A new card is waiting for its photo check.</p>
                ) : (
                  <button type="button" onClick={() => setConfirmReplace(true)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 [font-family:inherit] hover:bg-slate-50">
                    <RefreshCw className="h-4 w-4" /> Replace card
                  </button>
                )}
              </section>
            </aside>
          </div>
        ) : cancelled ? null : (
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* What the card will look like */}
            <section className="rounded-lg border border-solid border-slate-200 bg-white p-3 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="m-0 text-sm font-semibold text-slate-900">Your card</p>
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{pending ? "Photo check in progress" : "Preview, not active yet"}</span>
              </div>
              <div className="relative">
                <canvas ref={previewRef} className="block h-auto w-full rounded-xl opacity-60" aria-label="Preview of your ID card" />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="rotate-[-8deg] rounded-md border-2 border-solid border-white bg-slate-900/60 px-5 py-2 text-lg font-bold text-white sm:text-2xl">Not active</span>
                </div>
              </div>
              <p className="m-0 mt-3 text-[12px] text-slate-500">The real card gets its own verification code and QR. Scanning this preview proves nothing.</p>
            </section>

            {/* Issue it */}
            <aside className="space-y-4">
              <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                <div className="border-0 border-b border-solid border-slate-100 px-4 py-3">
                  <p className={`m-0 flex items-center gap-2 text-sm font-semibold ${ready ? "text-emerald-700" : "text-slate-900"}`}>
                    {ready ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <IdCard className="h-4 w-4 text-slate-500" aria-hidden />}
                    {pending ? "Waiting for NoLSAF to check your photo" : ready ? "You are ready for your card" : `${checklist.filter((c) => c.ok).length} of ${checklist.length} done`}
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] text-slate-500">{pending ? "You will be notified the moment it is active." : ready ? "Request it now. NoLSAF checks the photo, then it is live." : "Finish the steps below, then request your card."}</p>
                </div>
                <ul className="m-0 list-none p-0">
                  {checklist.map((item) => (
                    <li key={item.label} className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-2.5 first:border-t-0">
                      {item.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0 text-rose-500" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] ${item.ok ? "text-slate-800" : "font-medium text-slate-900"}`}>{item.label}</span>
                        {!item.ok ? <span className="block text-[12px] text-slate-500">{item.help}</span> : null}
                      </span>
                      {!item.ok ? <Link href={item.href} className="shrink-0 text-[12px] font-semibold text-[#02665e] no-underline hover:underline">{item.action}</Link> : null}
                    </li>
                  ))}
                </ul>
                <div className="border-0 border-t border-solid border-slate-100 p-4">
                  <button
                    type="button"
                    onClick={() => void issue()}
                    disabled={!ready || pending || busy === "issue"}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-5 text-sm font-semibold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : pending ? <Clock className="h-4 w-4" aria-hidden /> : <IdCard className="h-4 w-4" aria-hidden />} {pending ? "Photo check in progress" : rejected ? "Request my card again" : "Request my ID card"}
                  </button>
                  {preview?.expiresAt ? <p className="m-0 mt-2 text-center text-[11px] text-slate-500">Valid until {eat(preview.expiresAt)}, or until your agreement ends</p> : null}
                </div>
              </section>

              {photoRules}

              <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
                <p className="m-0 text-sm font-semibold text-slate-900">How owners check it</p>
                <ol className="m-0 mt-3 list-none space-y-3 p-0">
                  {[
                    ["Show or send it", "On your phone, or shared to WhatsApp as an image."],
                    ["The owner scans the QR", "With their own phone camera, or types the card code."],
                    ["NoLSAF confirms live", "Your name, photo and that you are authorised today."],
                  ].map(([title, text], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[12px] font-bold text-[#02665e]">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-slate-800">{title}</span>
                        <span className="block text-[12px] text-slate-500">{text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </div>
    </SalesShell>
  );
}
