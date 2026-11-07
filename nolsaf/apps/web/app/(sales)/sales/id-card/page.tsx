"use client";

/**
 * The sales partner's digital ID card: show it to a property owner, download
 * it, or send it. The owner scans the QR code (or types the card code) and
 * NoLSAF confirms live that this is a current sales partner.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, IdCard, Loader2, RefreshCw, Share2, ShieldCheck, XCircle } from "lucide-react";
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

type Requirements = { activePartner: boolean; activeContract: boolean; profilePhoto: boolean };

function eat(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}

export default function SalesIdCardPage() {
  const [card, setCard] = useState<Card | null>(null);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/sales/id-card");
      setCard(data.card ?? null);
      setRequirements(data.requirements ?? null);
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

  const issue = async () => {
    setBusy("issue");
    setError("");
    setNotice("");
    try {
      const { data } = await apiClient.post("/api/sales/id-card", {});
      setCard(data.card);
      setConfirmReplace(false);
      setNotice(card ? "New card issued. Your old card no longer verifies." : "Your ID card is ready.");
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

  const ready = requirements && requirements.activePartner && requirements.activeContract && requirements.profilePhoto;

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

              <section className="rounded-lg border border-solid border-slate-200 bg-white p-4">
                {confirmReplace ? (
                  <>
                    <p className="m-0 text-[13px] text-slate-700">Your current card and its code will stop verifying immediately. Your latest profile photo will be used.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void issue()} disabled={busy === "issue"} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border-0 bg-rose-600 px-3 text-sm font-semibold text-white [font-family:inherit] disabled:opacity-50">
                        {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Replace card
                      </button>
                      <button type="button" onClick={() => setConfirmReplace(false)} className="h-10 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 [font-family:inherit]">Cancel</button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmReplace(true)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 [font-family:inherit] hover:bg-slate-50">
                    <RefreshCw className="h-4 w-4" /> Replace card
                  </button>
                )}
              </section>
            </aside>
          </div>
        ) : (
          <section className="mt-5 max-w-xl rounded-lg border border-solid border-slate-200 bg-white p-5">
            <h2 className="m-0 text-base font-bold text-slate-900">Get your ID card</h2>
            <p className="m-0 mt-1 text-sm text-slate-600">Owners can check it live, so they know they are talking to a real NoLSAF representative.</p>
            <ul className="m-0 mt-4 list-none space-y-2 p-0 text-sm">
              {[
                ["Active partner account", requirements?.activePartner],
                ["Active agreement with NoLSAF", requirements?.activeContract],
                ["Clear profile photo of your face", requirements?.profilePhoto],
              ].map(([label, ok]) => (
                <li key={String(label)} className="flex items-center gap-2">
                  {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                  <span className={ok ? "text-slate-800" : "text-slate-600"}>{label}</span>
                  {!ok && label === "Clear profile photo of your face" && (
                    <Link href="/account" className="ml-auto text-[13px] font-semibold text-[#02665e] no-underline hover:underline">Add photo</Link>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void issue()}
              disabled={!ready || busy === "issue"}
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:opacity-45"
            >
              {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />} Issue my ID card
            </button>
          </section>
        )}
      </div>
    </SalesShell>
  );
}
