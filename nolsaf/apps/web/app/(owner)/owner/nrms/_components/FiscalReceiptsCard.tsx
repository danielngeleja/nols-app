"use client";

// Owner-activated TRA fiscal receipting. See nolsaf/docs/NRMS_FISCAL_RECEIPTS.md.
//
// This lives in the Tax register tab of Finance & Night Audit. That is where an
// owner already goes for anything tax-related, and the tab carries the same
// OWNER/MANAGER scope the fiscal API enforces. The taxpayer acknowledgement is
// still captured at activation and recorded on the connection; it does not need
// to sit next to the terms to be binding.
//
// Most properties will never switch this on. Guesthouses below the VAT threshold
// are not required to issue fiscal receipts at all, so the card stays quiet and
// explains who it is for rather than nagging everyone to complete it.

import { useCallback, useEffect, useState } from "react";
import DatePickerField from "@/components/DatePickerField";
import { AlertTriangle, Check, CheckCircle2, FileText, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "./NrmsProvider";

type Fiscal = {
  enabled: boolean;
  mode: "OFF" | "ON_REQUEST" | "ALWAYS";
  status: string;
  identity: { tin: string | null; vrn: string | null; businessName: string | null; taxOffice: string | null } | null;
  credential: { version: number; validationStatus: string; expiresAt: string | null } | null;
  staged: { version: number; validationStatus: string; validationError: string | null } | null;
  activatesOnBusinessDate: string | null;
  health: { lastSuccessAt: string | null; lastError: string | null; escalatedAt: string | null; pending: number; failed: number; deadLettered: number } | null;
  acknowledgement: { acceptedAt: string; version: string } | null;
};

const MODE_LABEL: Record<string, string> = {
  OFF: "Off",
  ON_REQUEST: "Only when a guest asks",
  ALWAYS: "On every payment",
};

const FIELD = "box-border h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs outline-none focus:border-emerald-600";
const LABEL = "text-[11px] font-bold text-neutral-700";

export default function FiscalReceiptsCard() {
  const { selectedPropertyId } = useNrms();
  const [fiscal, setFiscal] = useState<Fiscal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const [identity, setIdentity] = useState({ tin: "", vrn: "", businessName: "", taxOffice: "" });
  const [credential, setCredential] = useState({ username: "", password: "", certificate: "", certificatePassphrase: "", expiresAt: "" });
  const [certificateName, setCertificateName] = useState("");
  const [mode, setMode] = useState<"ON_REQUEST" | "ALWAYS">("ON_REQUEST");
  const [accepted, setAccepted] = useState(false);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    try {
      const res = await apiClient.get<{ fiscal: Fiscal }>(`/api/owner/nrms/fiscal/property/${selectedPropertyId}`);
      setFiscal(res.data.fiscal);
      if (res.data.fiscal.identity) {
        setIdentity({
          tin: res.data.fiscal.identity.tin || "",
          vrn: res.data.fiscal.identity.vrn || "",
          businessName: res.data.fiscal.identity.businessName || "",
          taxOffice: res.data.fiscal.identity.taxOffice || "",
        });
      }
      if (res.data.fiscal.mode !== "OFF") setMode(res.data.fiscal.mode as "ON_REQUEST" | "ALWAYS");
    } catch {
      setFiscal(null);
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<{ data: { fiscal: Fiscal } }>, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      setFiscal(res.data.fiscal);
      setMessage({ tone: "ok", text: okText });
    } catch (error: any) {
      const body = error?.response?.data;
      if (body?.fiscal) setFiscal(body.fiscal);
      setMessage({ tone: "error", text: body?.error || "That did not go through. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!selectedPropertyId) return null;

  const live = fiscal?.status === "ACTIVE" && fiscal.mode !== "OFF";
  const scheduled = Boolean(fiscal?.activatesOnBusinessDate);
  const backlog = (fiscal?.health?.pending ?? 0) + (fiscal?.health?.failed ?? 0) + (fiscal?.health?.deadLettered ?? 0);
  // Warn before the signing certificate lapses, not after receipts start
  // failing. Thirty days is enough time to get a replacement from TRA.
  const expiryWarning = (() => {
    const expiresAt = fiscal?.credential?.expiresAt;
    if (!expiresAt) return null;
    const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
    if (days < 0) return "Your TRA certificate has expired. Upload a replacement or receipts will keep failing.";
    if (days <= 30) return `Your TRA certificate expires in ${days} day${days === 1 ? "" : "s"}. Upload a replacement before then.`;
    return null;
  })();

  // Not a card of its own. It is the lower half of the tax register card, so the
  // tab reads as one statutory-records surface: what tax was captured, then how
  // receipts for it reach TRA. A separate card left a visible seam between two
  // things that are the same subject.
  return (
    <div className="mt-6 border-t border-solid border-neutral-200 pt-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold leading-tight text-neutral-950">TRA fiscal receipts</h3>
            {/* One line. The old copy spent a whole clause saying it is fine to
                leave this off, which the OFF pill beside it already says. */}
            <p className="mb-0 mt-1 max-w-xl text-xs leading-5 text-neutral-500">
              For VAT-registered businesses that must issue a TRA receipt. Not required otherwise.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : scheduled ? "border-sky-200 bg-sky-50 text-sky-700" : "border-neutral-200 bg-neutral-50 text-neutral-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : scheduled ? "bg-sky-500" : "bg-neutral-400"}`} />
            {loading ? "Checking" : live ? MODE_LABEL[fiscal!.mode] : scheduled ? "Starts soon" : "Off"}
          </span>
          {!loading && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border-0 px-4 text-xs font-bold transition ${open ? "bg-neutral-100 text-neutral-700 hover:bg-neutral-200" : live || scheduled ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
            >
              {open ? "Close" : live || scheduled ? "Manage" : "Set up"}
            </button>
          )}
        </div>
      </header>

      {live && fiscal?.health ? (
        /* Live: the 260px + fill split matches the tax figures directly above,
           so the two halves of the card line up on one grid. */
        <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
          <Tile label="Receipt status" value={MODE_LABEL[fiscal.mode]} note="Receipts are being sent to TRA under this property's own registration." tone="green" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="Waiting to send" value={String(fiscal.health.pending)} note="Queued for TRA" tone={fiscal.health.pending ? "amber" : "neutral"} />
            <Tile label="Not sent" value={String(fiscal.health.failed + fiscal.health.deadLettered)} note="Needs attention" tone={fiscal.health.failed + fiscal.health.deadLettered ? "red" : "neutral"} />
            <Tile label="Last sent" value={fiscal.health.lastSuccessAt ? new Date(fiscal.health.lastSuccessAt).toLocaleDateString() : "Never"} note={fiscal.health.lastSuccessAt ? new Date(fiscal.health.lastSuccessAt).toLocaleTimeString() : "No receipt has reached TRA yet"} tone="neutral" />
          </div>
        </div>
      ) : (
        /* Nothing at all when it is simply off. The pill in the header is the
           state, and a second line repeating "not set up / no receipts are
           being sent" was the third place on this block saying the same thing.
           Only `scheduled` gets a line, because it carries a date the pill
           cannot fit. */
        scheduled ? (
          <p className="m-0 mt-3 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
            <span>Receipts start {new Date(fiscal!.activatesOnBusinessDate!).toLocaleDateString()}, when your next business day opens.</span>
          </p>
        ) : null
      )}

      {live && fiscal?.health?.escalatedAt && backlog > 0 && (
        <Notice tone="red" icon={AlertTriangle}>
          Receipts are not reaching TRA. Guests can still pay and nothing is blocked, but {backlog} receipt{backlog === 1 ? "" : "s"} {backlog === 1 ? "is" : "are"} waiting.
          {fiscal.health.lastError ? ` Last error: ${fiscal.health.lastError}` : ""}
        </Notice>
      )}

      {scheduled && (
        <Notice tone="sky" icon={CheckCircle2}>
          Set up. Receipts start on {new Date(fiscal!.activatesOnBusinessDate!).toLocaleDateString()}, when your next business day opens. Switching on mid day would leave the day half done.
        </Notice>
      )}

      {expiryWarning && <Notice tone="amber" icon={AlertTriangle}>{expiryWarning}</Notice>}

      {message && (
        <Notice tone={message.tone === "ok" ? "green" : "amber"} icon={message.tone === "ok" ? CheckCircle2 : AlertTriangle}>{message.text}</Notice>
      )}

      {(live || scheduled) && <div className="mt-4"><ReceiptsPanel propertyId={selectedPropertyId} /></div>}

      {open && (
        <div className="mt-4 grid gap-3 rounded-xl border border-solid border-neutral-200 bg-neutral-50/60 p-3 sm:p-4">
          {/* Three facts, each answering a different worry: what it does, what
              happens when TRA is down, who holds the credentials. Shown here
              because this is the moment an owner is deciding. */}
          {!live && (
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3">
              {[
                { icon: FileText, title: "Receipts issue themselves", body: "Every bar, restaurant and folio payment produces a TRA receipt automatically, or only when a guest asks." },
                { icon: RefreshCw, title: "A TRA outage never blocks a sale", body: "Guests keep paying normally. Receipts queue and send once TRA is reachable again." },
                { icon: Lock, title: "Your registration, your keys", body: "You register with TRA and enter your own credentials. NoLSAF only transmits on your behalf." },
              ].map((point) => (
                <li key={point.title} className="flex gap-2.5 rounded-lg border border-solid border-neutral-200 bg-white p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <point.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold leading-4 text-neutral-900">{point.title}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-neutral-500">{point.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Step n={1} title="Your TRA registration" note="Exactly as TRA holds it for this business.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="TIN" value={identity.tin} onChange={(v) => setIdentity((s) => ({ ...s, tin: v }))} />
              <Field label="VRN" value={identity.vrn} onChange={(v) => setIdentity((s) => ({ ...s, vrn: v }))} />
              <Field label="Registered business name" value={identity.businessName} onChange={(v) => setIdentity((s) => ({ ...s, businessName: v }))} />
              <Field label="Tax office (optional)" value={identity.taxOffice} onChange={(v) => setIdentity((s) => ({ ...s, taxOffice: v }))} />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => apiClient.put(`/api/owner/nrms/fiscal/property/${selectedPropertyId}/identity`, { ...identity, taxOffice: identity.taxOffice || null }), "Registration details saved.")}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-neutral-900 px-3 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save details
            </button>
          </Step>

          <Step n={2} title="Your TRA credentials" note="The username, password and certificate file TRA issued to this business.">
            <p className="mb-3 mt-0 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-600">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>These are encrypted and are never shown again, to you or to anyone at NoLSAF. You can replace them at any time.</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Username" value={credential.username} onChange={(v) => setCredential((s) => ({ ...s, username: v }))} />
              <Field label="Password" type="password" value={credential.password} onChange={(v) => setCredential((s) => ({ ...s, password: v }))} />
              <label className="grid min-w-0 gap-1.5">
                <span className={LABEL}>Certificate file</span>
                {/* Read in the browser and sent as base64. Nobody should be asked
                    to paste the contents of a .pfx into a text box. */}
                <input
                  type="file"
                  accept=".p12,.pfx,application/x-pkcs12"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setCertificateName(file.name);
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = String(reader.result || "");
                      setCredential((s) => ({ ...s, certificate: result.slice(result.indexOf(",") + 1) }));
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="box-border w-full rounded-lg border border-solid border-neutral-200 bg-white p-2 text-xs file:mr-2 file:rounded-[0.25rem] file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-xs file:font-bold"
                />
                {certificateName ? <span className="text-[10px] text-neutral-500">{certificateName}</span> : null}
              </label>
              <Field label="Certificate password" type="password" value={credential.certificatePassphrase} onChange={(v) => setCredential((s) => ({ ...s, certificatePassphrase: v }))} />
              {/* The project's own picker, not a native date input. A TRA
                  certificate expiry is always in the future, so the calendar
                  opens forward and past dates are not selectable. */}
              <label className="grid min-w-0 gap-1.5">
                <span className={LABEL}>Certificate expires (optional)</span>
                <DatePickerField
                  label="Certificate expires"
                  value={credential.expiresAt}
                  onChangeAction={(next) => setCredential((s) => ({ ...s, expiresAt: next.slice(0, 10) }))}
                  min={new Date().toISOString().slice(0, 10)}
                  widthClassName="!w-full"
                  size="sm"
                  twoMonths={false}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !credential.certificate}
                onClick={() => void run(() => apiClient.post(`/api/owner/nrms/fiscal/property/${selectedPropertyId}/credentials`, {
                  username: credential.username,
                  password: credential.password,
                  certificate: credential.certificate,
                  certificatePassphrase: credential.certificatePassphrase || null,
                  expiresAt: credential.expiresAt ? new Date(`${credential.expiresAt}T00:00:00.000Z`).toISOString() : null,
                }), "Credentials saved and encrypted.")}
                // Emerald, not neutral-900: this is the primary action of the
                // step and read as a disabled grey slab beside it.
                className="inline-flex h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-700 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save credentials
              </button>
              <button
                type="button"
                disabled={busy || !fiscal?.staged}
                onClick={() => void run(() => apiClient.post(`/api/owner/nrms/fiscal/property/${selectedPropertyId}/credentials/validate`, {}), "Checked.")}
                title={!fiscal?.staged ? "Save your credentials first, then NoLSAF can test them against TRA" : undefined}
                className="inline-flex h-9 appearance-none items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ShieldCheck className="h-3.5 w-3.5" />Check with TRA
              </button>
              {/* A disabled button with no stated reason is a dead end. */}
              {!fiscal?.staged && <span className="self-center text-[11px] text-neutral-400">Save your credentials first.</span>}
            </div>
            {fiscal?.staged?.validationError && (
              <p className="mb-0 mt-2 text-[11px] leading-5 text-amber-800">{fiscal.staged.validationError}</p>
            )}
          </Step>

          <Step n={3} title="Switch it on" note="Takes effect when your next business day opens.">
            <div className="grid gap-2">
              {/* The selected option now reads as selected: an emerald card,
                  not a default blue browser radio on a plain white row. */}
              {(["ON_REQUEST", "ALWAYS"] as const).map((value) => {
                const on = mode === value;
                return (
                  <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border border-solid px-3 py-2.5 text-xs transition ${on ? "border-emerald-400 bg-emerald-50/70" : "border-neutral-200 bg-white hover:bg-neutral-50"}`}>
                    <input type="radio" name="fiscal-mode" checked={on} onChange={() => setMode(value)} className="sr-only" />
                    <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-solid ${on ? "border-emerald-600 bg-emerald-600" : "border-neutral-300 bg-white"}`}>
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className={`block font-bold ${on ? "text-emerald-900" : "text-neutral-900"}`}>{MODE_LABEL[value]}</span>
                      <span className={`block ${on ? "text-emerald-800/80" : "text-neutral-500"}`}>
                        {value === "ON_REQUEST"
                          ? "Your staff press a button on the bill when a guest asks for a receipt."
                          : "Every payment produces a TRA receipt automatically."}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {/* This is the binding taxpayer acknowledgement and it was a bare
                native checkbox against small grey text, easy to miss entirely.
                It is now a card, like the mode options above it, so the thing
                that gates activation looks like a thing you must act on. */}
            <label className={`mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-solid p-3 text-[11px] leading-5 transition ${accepted ? "border-emerald-400 bg-emerald-50/70 text-emerald-900" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="sr-only" />
              <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-solid ${accepted ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white"}`}>
                {accepted && <Check className="h-3 w-3" />}
              </span>
              <span>
                I confirm this business is registered with TRA under the TIN and VRN above, that it is responsible for its own tax compliance, and that NoLSAF only sends receipts on its behalf.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !accepted}
                onClick={() => void run(() => apiClient.post(`/api/owner/nrms/fiscal/property/${selectedPropertyId}/activate`, { mode, acknowledge: true }), "Switched on. It starts when your next business day opens.")}
                // A faded emerald reads as a pale enabled button. Disabled goes
                // grey so on and off are unmistakable.
                className="inline-flex h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-emerald-600 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Switch on
              </button>
              {!accepted && <span className="text-[11px] text-neutral-400">Tick the confirmation above to switch on.</span>}
              {(live || scheduled) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => apiClient.post(`/api/owner/nrms/fiscal/property/${selectedPropertyId}/deactivate`, {}), "Will switch off at the end of today.")}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
                >
                  Switch off
                </button>
              )}
            </div>
          </Step>

        </div>
      )}
    </div>
  );
}

type Receipt = {
  id: number; kind: string; status: string; receiptNumber: number; grossAmount: string | number; currency: string;
  saleOccurredAt: string; fiscalReceiptNumber: string | null; verificationCode: string | null; verificationUrl: string | null; lastError: string | null;
};
type Issuable = { sourceType: string; sourceId: number; amount: number; currency: string; occurredAt: string; label: string };

const RECEIPT_TONE: Record<string, string> = {
  CONFIRMED: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  FAILED: "bg-red-50 text-red-700",
  DEAD_LETTER: "bg-red-100 text-red-800",
  BURNED: "bg-neutral-100 text-neutral-500",
};
const RECEIPT_LABEL: Record<string, string> = {
  CONFIRMED: "Sent",
  PENDING: "Waiting",
  FAILED: "Not sent",
  DEAD_LETTER: "Stopped",
  BURNED: "Cancelled number",
};

/**
 * The working list. In "only when a guest asks" mode this is where staff issue a
 * receipt, including for a sale from days ago, which is the common case: a guest
 * comes back on Wednesday wanting a receipt for Monday.
 */
function ReceiptsPanel({ propertyId }: { propertyId: number }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [issuable, setIssuable] = useState<Issuable[]>([]);
  const [canIssue, setCanIssue] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ receipts: Receipt[]; issuable: Issuable[]; canIssue: boolean }>(`/api/owner/nrms/fiscal/property/${propertyId}/receipts`);
      setReceipts(res.data.receipts);
      setIssuable(res.data.issuable);
      setCanIssue(res.data.canIssue);
    } catch {
      setReceipts([]);
      setIssuable([]);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function act(key: string, action: () => Promise<unknown>, okText: string) {
    setBusyKey(key);
    setNote(null);
    try {
      await action();
      setNote(okText);
      await load();
    } catch (error: any) {
      setNote(error?.response?.data?.error || "That did not go through.");
    } finally {
      setBusyKey(null);
    }
  }

  if (!canIssue && receipts.length === 0) return null;

  return (
    <div className="rounded-xl border border-solid border-neutral-200 p-4">
      <h3 className="m-0 text-[13px] font-bold text-neutral-950">Receipts</h3>
      {note && <p className="mb-0 mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-5 text-neutral-700">{note}</p>}

      {canIssue && issuable.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 mt-0 text-[11px] font-bold text-neutral-700">Sales with no receipt yet</p>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {issuable.map((row) => {
              const key = `${row.sourceType}:${row.sourceId}`;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2">
                  <span className="min-w-0 text-[11px] text-neutral-700">
                    <span className="font-bold text-neutral-900">{row.currency} {row.amount.toLocaleString()}</span>
                    <span className="text-neutral-500"> · {row.label} · {new Date(row.occurredAt).toLocaleDateString()}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busyKey === key}
                    onClick={() => void act(key, () => apiClient.post(`/api/owner/nrms/fiscal/property/${propertyId}/issue`, { sourceType: row.sourceType, sourceId: row.sourceId }), "Receipt requested. It will be sent to TRA shortly.")}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-[11px] font-bold text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {busyKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Issue receipt
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {receipts.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <ul className="m-0 grid min-w-[520px] list-none gap-1.5 p-0">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-solid border-neutral-100 px-3 py-2">
                <span className="min-w-0 text-[11px] text-neutral-700">
                  <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${RECEIPT_TONE[receipt.status] || "bg-neutral-100 text-neutral-600"}`}>
                    {RECEIPT_LABEL[receipt.status] || receipt.status}
                  </span>
                  <span className="font-bold text-neutral-900">#{receipt.fiscalReceiptNumber || receipt.receiptNumber}</span>
                  <span className="text-neutral-500">
                    {" "}· {receipt.currency} {Number(receipt.grossAmount).toLocaleString()} · {new Date(receipt.saleOccurredAt).toLocaleDateString()}
                    {receipt.kind === "CREDIT_NOTE" ? " · credit note" : ""}
                    {receipt.verificationCode ? ` · code ${receipt.verificationCode}` : ""}
                  </span>
                  {receipt.lastError && receipt.status !== "CONFIRMED" ? (
                    <span className="mt-0.5 block text-[10px] leading-4 text-red-700">{receipt.lastError}</span>
                  ) : null}
                </span>
                {(receipt.status === "FAILED" || receipt.status === "DEAD_LETTER") && (
                  <button
                    type="button"
                    disabled={busyKey === `r${receipt.id}`}
                    onClick={() => void act(`r${receipt.id}`, () => apiClient.post(`/api/owner/nrms/fiscal/property/${propertyId}/receipts/${receipt.id}/retry`, {}), "Queued to try again.")}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[11px] font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {busyKey === `r${receipt.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Try again
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-start gap-3 border-b border-solid border-neutral-100 pb-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-neutral-50 text-[11px] font-bold tabular-nums text-neutral-700">{n}</span>
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-bold leading-tight text-neutral-950">{title}</h3>
          <p className="mb-0 mt-1 text-[11px] leading-5 text-neutral-500">{note}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className={LABEL}>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={FIELD} />
    </label>
  );
}

/**
 * Same shape as the Metric tile the finance page already uses above this card,
 * so the two sections read as one column instead of two designs.
 */
function Tile({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "green" | "amber" | "red" | "sky" }) {
  const shell =
    tone === "green" ? "border-emerald-200 bg-emerald-50"
      : tone === "amber" ? "border-amber-200 bg-amber-50"
      : tone === "red" ? "border-red-200 bg-red-50"
      : tone === "sky" ? "border-sky-200 bg-sky-50"
      : "border-neutral-200 bg-white";
  return (
    <div className={`min-w-0 rounded-xl border border-solid p-4 ${shell}`}>
      <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mb-0 mt-1 truncate text-xl font-bold tabular-nums text-neutral-950">{value}</p>
      <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p>
    </div>
  );
}

/** One consistent banner shape for every state this card can be in. */
function Notice({ tone, icon: Icon, children }: { tone: "red" | "amber" | "green" | "sky"; icon: typeof AlertTriangle; children: React.ReactNode }) {
  const shell =
    tone === "red" ? "border-red-200 bg-red-50 text-red-800"
      : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <p className={`mb-0 mt-3 flex items-start gap-2 rounded-xl border border-solid px-3.5 py-2.5 text-xs leading-5 ${shell}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}


