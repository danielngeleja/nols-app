"use client";

/**
 * Admin view of a sales partner's ID card. Shows the full card the way an
 * owner sees it (photo, name, numbers), the photo check that every new card
 * waits for, how often owners checked it, and an immediate cancel.
 */
import { useState } from "react";
import { CheckCircle2, IdCard, Loader2, ScanFace, ShieldCheck, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type AdminIdCard = {
  id: number;
  cardNumber: string;
  status: string;
  photoUrl?: string | null;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  verifyCount: number;
  lastVerifiedAt: string | null;
};

/** The same rules the partner's ID card page checks, live from the server. */
export type CardReadiness = {
  activePartner: boolean;
  activeContract: boolean;
  profilePhoto: boolean;
  everIssued: boolean;
  photoPending?: boolean;
  /** Latest card was cancelled by NoLSAF: only an admin can issue the next one. */
  cancelledByAdmin?: boolean;
  currentPhotoUrl?: string | null;
};

export type CardHolder = { name: string; agentCode: string; region: string | null; territory: string | null };

const READINESS: Array<["activePartner" | "activeContract" | "profilePhoto", string]> = [
  ["activePartner", "Active partner account"],
  ["activeContract", "Active agreement"],
  ["profilePhoto", "Profile photo"],
];

const ID_FONT = { fontFamily: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", Arial, sans-serif' };

/** Why this partner has no active card, in one line an admin can act on. */
export function cardGapText(r: CardReadiness | null | undefined): { title: string; detail: string } {
  if (!r) return { title: "No ID card yet", detail: "Open the ID card tab to see what is missing." };
  if (r.photoPending) return { title: "ID card photo waiting for your check", detail: "Confirm the photo is a clear face of this person. The card only verifies after you approve it." };
  if (r.cancelledByAdmin) return { title: "ID card cancelled by NoLSAF", detail: "The partner cannot request a new card. Issue one from the ID card tab when you are ready." };
  const missing = READINESS.filter(([key]) => !r[key]).map(([, label]) => label.toLowerCase());
  if (missing.length) {
    return {
      title: `No ID card: ${missing.length === 1 ? "1 requirement" : `${missing.length} requirements`} missing`,
      detail: `Missing: ${missing.join(", ")}. The card request is sent for your photo check once this is done and the partner opens their ID card page.`,
    };
  }
  if (r.everIssued) {
    return { title: "No active ID card", detail: "The last card was cancelled, expired or its photo was not approved. The partner can request a new one from their ID card page." };
  }
  return { title: "Ready, not opened yet", detail: "Every requirement is met. The card request reaches you the moment the partner opens ID card in their portal." };
}

function day(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "";
}

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PENDING_REVIEW: "bg-amber-50 text-amber-800",
  PHOTO_REJECTED: "bg-rose-50 text-rose-700",
  REPLACED: "bg-neutral-100 text-neutral-600",
  REVOKED: "bg-rose-50 text-rose-700",
};
const LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_REVIEW: "Photo check",
  PHOTO_REJECTED: "Photo not approved",
  REPLACED: "Replaced",
  REVOKED: "Cancelled",
};

function areaText(holder: CardHolder) {
  const parts = [holder.territory, holder.region].filter((p): p is string => Boolean(p && p.trim()));
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ") || "Tanzania";
}

/** The card as an owner would see it, so admin judges exactly what is shown. */
function FullCard({ card, holder, tone }: { card: AdminIdCard; holder?: CardHolder; tone: "review" | "active" | "muted" }) {
  const ring = tone === "review" ? "border-amber-300" : tone === "active" ? "border-emerald-200" : "border-neutral-200";
  return (
    <div className={`flex flex-col gap-4 rounded-lg border border-solid ${ring} bg-white p-4 sm:flex-row`} style={ID_FONT}>
      <div className="mx-auto shrink-0 rounded-md border border-solid border-neutral-200 p-1 sm:mx-0">
        {card.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photoUrl} alt={`Card photo for ${holder?.name || card.cardNumber}`} className={`block h-44 w-36 rounded object-cover ${tone === "muted" ? "grayscale" : ""}`} />
        ) : (
          <div className="grid h-44 w-36 place-items-center rounded bg-neutral-100 text-[11px] text-neutral-400">No photo</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[17px] font-bold text-neutral-900">{holder?.name || "Sales partner"}</p>
        <p className="m-0 mt-0.5 text-[12px] font-semibold text-[#02665e]">Sales representative</p>
        <dl className="m-0 mt-3 grid grid-cols-2 overflow-hidden rounded-md border border-solid border-neutral-200 text-[12px]">
          {[
            { k: "ID number", v: holder?.agentCode || "", mono: true },
            { k: "Card", v: card.cardNumber, mono: true },
            { k: "Area", v: holder ? areaText(holder) : "Tanzania" },
            { k: "Valid until", v: card.status === "PREVIEW" ? "Agreement end, up to 1 year" : day(card.expiresAt) },
          ].map((cell, index) => (
            <div key={cell.k} className={`min-w-0 border-0 border-solid border-neutral-200 px-2.5 py-2 ${index % 2 === 1 ? "border-l" : ""} ${index >= 2 ? "border-t" : ""}`}>
              <dt className="text-[10px] text-neutral-500">{cell.k}</dt>
              <dd className={`m-0 mt-0.5 break-words font-semibold text-neutral-900 ${cell.mono ? "font-mono text-[11.5px]" : ""}`}>{cell.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function PartnerIdCardAdmin({ partnerId, cards, readiness, holder, onChanged }: { partnerId: number; cards?: AdminIdCard[]; readiness?: CardReadiness | null; holder?: CardHolder; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [photoChecked, setPhotoChecked] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const list = cards ?? [];
  const active = list.find((card) => card.status === "ACTIVE" && new Date(card.expiresAt).getTime() > Date.now());
  const pending = list.find((card) => card.status === "PENDING_REVIEW");

  const post = async (key: string, path: string, body: object, fallback: string) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`/api/admin/sales/partners/${partnerId}/card/${path}`, body);
      setOpen(false);
      setRejecting(false);
      setReason("");
      setRejectReason("");
      setPhotoChecked(false);
      onChanged();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || fallback);
    } finally {
      setBusy("");
    }
  };

  const revoke = () => {
    if (reason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    void post("revoke", "revoke", { reason: reason.trim() }, "Could not cancel the card.");
  };
  const reject = () => {
    if (rejectReason.trim().length < 5) return setError("Tell the partner what to fix, at least 5 characters.");
    void post("reject", "reject", { reason: rejectReason.trim() }, "Could not reject the photo.");
  };

  return (
    <div className="space-y-4">
      <h3 className="m-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500"><IdCard className="h-3.5 w-3.5" /> ID card</h3>

      {/* Photo check: the one decision a new card waits for */}
      {pending ? (
        <section className="overflow-hidden rounded-lg border border-solid border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-2.5 border-0 border-b border-solid border-amber-200 px-4 py-3">
            <ScanFace className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold text-neutral-900">Photo check for card {pending.cardNumber}</p>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-600">
                Requested {day(pending.issuedAt)}.{active ? " Their current card keeps working until you approve this one." : " The card does not verify until you approve it."}
              </p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <FullCard card={pending} holder={holder} tone="review" />
            <ul className="m-0 grid list-none gap-1 p-0 text-[12px] text-neutral-700 sm:grid-cols-2">
              {["A real photo of a face, not a logo, object or drawing", "One person, facing the camera, face clearly visible", "No sunglasses, mask or heavy filter", "Matches the person you know as this partner"].map((rule) => (
                <li key={rule} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />{rule}</li>
              ))}
            </ul>
            {!rejecting ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void post("approve", "approve", {}, "Could not approve the card.")} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-[13px] font-semibold text-white [font-family:inherit] hover:bg-[#014d47] disabled:opacity-50">
                  {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve photo
                </button>
                <button type="button" onClick={() => { setRejecting(true); setError(""); }} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-rose-200 bg-white px-3.5 text-[13px] font-semibold text-rose-700 [font-family:inherit] hover:bg-rose-50 disabled:opacity-50">
                  <XCircle className="h-4 w-4" /> Reject photo
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <input
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="What to fix, shown to the partner (e.g. the photo is not a face)"
                  className="h-9 min-w-0 flex-1 rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-[13px] outline-none focus:border-rose-300"
                />
                <button type="button" onClick={reject} disabled={busy === "reject"} className="inline-flex h-9 items-center gap-1 rounded-md border-0 bg-rose-600 px-3 text-[13px] font-semibold text-white [font-family:inherit] disabled:opacity-50">
                  {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Reject
                </button>
                <button type="button" onClick={() => setRejecting(false)} className="h-9 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700 [font-family:inherit]">Back</button>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* After a cancellation only NoLSAF issues the next card: admin sees the photo first. */}
      {readiness?.cancelledByAdmin && !active && !pending ? (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200">
          <div className="flex items-start gap-2.5 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-3">
            <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold text-neutral-900">Issue a new card</p>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-600">The last card was cancelled by NoLSAF, so the partner cannot request one. Check the photo below; issuing makes the card live at once.</p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <FullCard
              card={{ id: 0, cardNumber: "New card", status: "PREVIEW", photoUrl: readiness.currentPhotoUrl, issuedAt: new Date().toISOString(), expiresAt: list[0]?.expiresAt || new Date().toISOString(), revokedAt: null, revokeReason: null, verifyCount: 0, lastVerifiedAt: null }}
              holder={holder}
              tone="review"
            />
            {!readiness.activePartner || !readiness.activeContract || !readiness.profilePhoto ? (
              <p className="m-0 text-[12px] font-semibold text-rose-700">
                Not possible yet: {READINESS.filter(([key]) => !readiness[key]).map(([, label]) => label.toLowerCase()).join(", ")} missing.
              </p>
            ) : (
              <label className="flex items-start gap-2 text-[12px] text-neutral-700">
                <input type="checkbox" checked={photoChecked} onChange={(event) => setPhotoChecked(event.target.checked)} className="mt-0.5" />
                I checked the photo: a clear, real face of this partner.
              </label>
            )}
            <button
              type="button"
              onClick={() => void post("issue", "issue", { photoChecked: true }, "Could not issue the card.")}
              disabled={!photoChecked || Boolean(busy) || !readiness.activePartner || !readiness.activeContract || !readiness.profilePhoto}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-[13px] font-semibold text-white [font-family:inherit] hover:bg-[#014d47] disabled:opacity-50"
            >
              {busy === "issue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Issue new card
            </button>
          </div>
        </section>
      ) : null}

      {active ? (
        <section className="space-y-2">
          <p className="m-0 text-[12px] font-semibold text-neutral-700">Current card, as owners see it</p>
          <FullCard card={active} holder={holder} tone="active" />
        </section>
      ) : null}

      <div className="rounded-lg border border-solid border-neutral-200 p-3 text-xs">
        {list.length === 0 ? (
          <div>
            <p className="m-0 font-semibold text-neutral-800">{cardGapText(readiness).title}</p>
            <p className="m-0 mt-0.5 text-neutral-500">{cardGapText(readiness).detail}</p>
            {readiness ? (
              <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
                {READINESS.map(([key, label]) => (
                  <li key={key} className="inline-flex items-center gap-1.5">
                    {readiness[key] ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <XCircle className="h-3.5 w-3.5 text-rose-500" aria-hidden />}
                    <span className={readiness[key] ? "text-neutral-700" : "font-semibold text-rose-700"}>{label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {list.map((card) => (
              <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono font-semibold text-neutral-900">{card.cardNumber}</span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${TONE[card.status] ?? TONE.REPLACED}`}>{card.status === "ACTIVE" && new Date(card.expiresAt).getTime() <= Date.now() ? "Expired" : LABEL[card.status] ?? card.status}</span>
                <span className="text-neutral-500">Requested {day(card.issuedAt)} · until {day(card.expiresAt)}</span>
                {card.status === "ACTIVE" || card.verifyCount > 0 ? (
                  <span className="text-neutral-500">Checked {card.verifyCount} {card.verifyCount === 1 ? "time" : "times"}{card.lastVerifiedAt ? `, last ${day(card.lastVerifiedAt)}` : ""}</span>
                ) : null}
                {card.revokeReason && card.status === "REVOKED" && <span className="w-full text-rose-700">Cancelled: {card.revokeReason}</span>}
                {card.revokeReason && card.status === "PHOTO_REJECTED" && <span className="w-full text-rose-700">Photo not approved: {card.revokeReason}</span>}
              </li>
            ))}
          </ul>
        )}

        {active && !open && (
          <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex h-8 items-center rounded-md border border-solid border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 [font-family:inherit] hover:bg-rose-50">
            Cancel this card now
          </button>
        )}
        {active && open && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (kept on the record, not shown to the partner)"
              className="h-8 min-w-0 flex-1 rounded-md border border-solid border-neutral-200 px-2 text-xs outline-none focus:border-rose-300"
            />
            <button type="button" onClick={revoke} disabled={busy === "revoke"} className="inline-flex h-8 items-center gap-1 rounded-md border-0 bg-rose-600 px-2.5 text-xs font-semibold text-white [font-family:inherit] disabled:opacity-50">
              {busy === "revoke" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Cancel card
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 [font-family:inherit]">Keep</button>
          </div>
        )}
        {error && <p className="m-0 mt-2 text-rose-700">{error}</p>}
      </div>
    </div>
  );
}
