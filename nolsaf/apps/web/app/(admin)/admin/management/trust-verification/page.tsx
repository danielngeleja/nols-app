"use client";

/**
 * Trust and verification workspace.
 *
 * Approving evidence and publishing are deliberately two separate actions. The
 * moment someone checks a document and the moment a claim becomes public are
 * different facts, and an incident review needs to see both.
 *
 * Unpublish is always available on a published record, with no confirmation
 * step. A disputed corporate claim has to come down in one click.
 */

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  ShieldCheck,
  Loader2,
  CheckCircle,
  Eye,
  EyeOff,
  Archive,
  Plus,
  AlertTriangle,
  Link2,
  X,
} from "lucide-react";

const api = apiClient;

type VerificationRecord = {
  id: number;
  key: string;
  category: string;
  displayName: string;
  authorityName: string | null;
  jurisdiction: string | null;
  registrationNumber: string | null;
  publicSummary: string | null;
  status: string;
  visibility: string;
  externalVerificationUrl: string | null;
  expiresAt: string | null;
  evidenceApprovedAt: string | null;
  evidenceNote: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  evidenceApprovedBy?: { id: number; name: string | null; email: string | null } | null;
  publishedBy?: { id: number; name: string | null; email: string | null } | null;
};

type Channel = {
  id: number;
  channelType: string;
  label: string;
  value: string;
  href: string | null;
  confirmedAt: string | null;
  visibility: string;
  publishedAt: string | null;
  archivedAt: string | null;
  confirmedBy?: { id: number; name: string | null; email: string | null } | null;
};

const CATEGORIES = ["IDENTITY", "REGISTRATION", "COMPLIANCE"];
const STATUSES = ["DRAFT", "PENDING", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "EXPIRED", "WITHDRAWN"];
const CHANNEL_TYPES = ["WEBSITE", "EMAIL", "PHONE", "ADDRESS", "SOCIAL"];

function sentence(value: string | null | undefined): string {
  const text = String(value || "").replace(/_/g, " ").toLowerCase().trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatWhen(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TrustVerificationWorkspace() {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [showChannelForm, setShowChannelForm] = useState(false);
  // Evidence approval opens a real dialog, not a browser prompt: the note lands
  // in the audit log as the record of why a corporate claim was trusted, so it
  // deserves room to write and a visible reminder of what it is for.
  const [evidenceTarget, setEvidenceTarget] = useState<VerificationRecord | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [publicPageEnabled, setPublicPageEnabled] = useState(false);

  const [recordDraft, setRecordDraft] = useState({
    key: "",
    category: "REGISTRATION",
    displayName: "",
    authorityName: "",
    jurisdiction: "",
    registrationNumber: "",
    publicSummary: "",
    status: "DRAFT",
    externalVerificationUrl: "",
  });
  const [channelDraft, setChannelDraft] = useState({
    channelType: "EMAIL",
    label: "",
    value: "",
    href: "",
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [recordsRes, channelsRes] = await Promise.all([
        api.get<{ data: VerificationRecord[]; meta?: { publicPageEnabled?: boolean } }>("/api/admin/trust-verification/records"),
        api.get<{ data: Channel[] }>("/api/admin/trust-verification/channels"),
      ]);
      setRecords(recordsRes.data.data || []);
      setPublicPageEnabled(Boolean(recordsRes.data.meta?.publicPageEnabled));
      setChannels(channelsRes.data.data || []);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not load verification records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (label: string, run: () => Promise<any>, success: string) => {
      try {
        setBusy(label);
        setError(null);
        await run();
        setNotice(success);
        window.setTimeout(() => setNotice(null), 4000);
        await load();
      } catch (err: any) {
        setError(err?.response?.data?.error || "That action could not be completed.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  // Derived from the lists already loaded, so the header can never disagree
  // with the rows underneath it.
  const liveRecords = records.filter((record) => !record.archivedAt);
  const stats = {
    awaitingEvidence: liveRecords.filter((record) => !record.evidenceApprovedAt).length,
    readyToPublish: liveRecords.filter(
      (record) => record.evidenceApprovedAt && !(record.visibility === "PUBLIC" && record.publishedAt),
    ).length,
    publishedRecords: liveRecords.filter((record) => record.visibility === "PUBLIC" && record.publishedAt).length,
    publishedChannels: channels.filter(
      (channel) => !channel.archivedAt && channel.visibility === "PUBLIC" && channel.publishedAt,
    ).length,
    totalChannels: channels.filter((channel) => !channel.archivedAt).length,
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div id="trust-verification-page" className="box-border w-full min-w-0 space-y-4 px-3 py-3 sm:px-4 lg:px-5 xl:px-6">
      <style>{`#trust-verification-page, #trust-verification-page * { box-sizing: border-box; }`}</style>

      <header className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-lg font-bold text-slate-900">Trust and verification</h1>
              <p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                Corporate records and authorised channels shown on the public verify page. Nothing appears publicly
                until its evidence is approved by a named administrator and it is explicitly published.
              </p>
            </div>
          </div>

          {/* Whether the public page is switched on at all. Without this an
              admin can publish a record, see nothing on /verify, and have no
              way to tell the difference between a bug and a disabled flag. */}
          <span
            className={`inline-flex flex-shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 ${
              publicPageEnabled
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-slate-100 text-slate-600 ring-slate-200"
            }`}
            title={
              publicPageEnabled
                ? "TRUST_VERIFICATION_PUBLIC is on, so published records are reachable at /verify"
                : "TRUST_VERIFICATION_PUBLIC is off, so /verify serves nothing even for published records"
            }
          >
            <span className={`inline-block h-2 w-2 rounded-full ${publicPageEnabled ? "bg-emerald-500" : "bg-slate-400"}`} />
            {publicPageEnabled ? "Public page live" : "Public page off"}
          </span>
        </div>

        {/* The pipeline, left to right in the order work moves through it. */}
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
          {([
            {
              label: "Awaiting evidence",
              value: stats.awaitingEvidence,
              tone: stats.awaitingEvidence > 0 ? "text-amber-700" : "text-slate-400",
              hint: "Recorded but nobody has approved the evidence yet",
            },
            {
              label: "Ready to publish",
              value: stats.readyToPublish,
              tone: stats.readyToPublish > 0 ? "text-sky-700" : "text-slate-400",
              hint: "Evidence approved, not yet public",
            },
            {
              label: "Published",
              value: stats.publishedRecords,
              tone: stats.publishedRecords > 0 ? "text-emerald-700" : "text-slate-400",
              hint: "Live on the public verify page",
            },
            {
              label: "Channels published",
              value: `${stats.publishedChannels}/${stats.totalChannels}`,
              tone: stats.publishedChannels > 0 ? "text-emerald-700" : "text-slate-400",
              hint: "Authorised channels visible publicly",
            },
          ] as { label: string; value: number | string; tone: string; hint: string }[]).map((stat) => (
            <div key={stat.label} className="min-w-0 bg-white px-4 py-3" title={stat.hint}>
              <div className={`text-xl font-bold tabular-nums leading-7 ${stat.tone}`}>{stat.value}</div>
              <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {stats.publishedRecords > 0 && !publicPageEnabled && (
          <p className="m-0 bg-amber-50 px-5 py-2.5 text-[11px] font-medium leading-5 text-amber-900 shadow-[inset_0_1px_0_#fde68a]">
            {stats.publishedRecords} record{stats.publishedRecords === 1 ? " is" : "s are"} published but the public
            page is switched off, so nobody outside can see them yet.
          </p>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800 ring-1 ring-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
          {notice}
        </div>
      )}

      {/* Records */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-bold text-slate-900">Verification records</h2>
          <button
            type="button"
            onClick={() => setShowRecordForm((open) => !open)}
            className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {showRecordForm ? "Cancel" : "New record"}
          </button>
        </div>

        {showRecordForm && (
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-2">
            {/* Each field carries an example of the shape it expects and, where
                the rule is not obvious, a line of help underneath. A blank box
                under a terse label leaves the format to guesswork, which is how
                a registration number ends up entered three different ways. */}
            {([
              {
                field: "key",
                label: "Key",
                placeholder: "BRELA_COMPANY_REGISTRATION",
                help: "Uppercase letters, numbers, and underscores. Cannot be changed later.",
              },
              {
                field: "displayName",
                label: "Display name",
                placeholder: "NoLS AFRICA COMPANY LIMITED",
                help: "Shown as the card heading. Preserve official spelling and capitalisation.",
              },
              {
                field: "authorityName",
                label: "Issuing authority",
                placeholder: "Business Registrations and Licensing Agency (BRELA)",
                help: "The body that issued this record. Never implied to endorse NoLSAF.",
              },
              {
                field: "jurisdiction",
                label: "Jurisdiction",
                placeholder: "United Republic of Tanzania",
              },
              {
                field: "registrationNumber",
                label: "Registration number",
                placeholder: "202655645",
                help: "Entered exactly as it appears on the certificate.",
              },
              {
                field: "externalVerificationUrl",
                label: "Official lookup URL",
                placeholder: "https://registrar.example/lookup",
                help: "Leave blank if no official URL is approved. The card then names the authority without a link.",
              },
            ] as { field: keyof typeof recordDraft; label: string; placeholder: string; help?: string }[]).map(
              ({ field, label, placeholder, help }) => (
                <label key={field} className="block min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                  <input
                    type="text"
                    value={recordDraft[field]}
                    placeholder={placeholder}
                    onChange={(event) => setRecordDraft((current) => ({ ...current, [field]: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-800 ring-1 ring-slate-200 font-sans outline-none transition placeholder:text-xs placeholder:italic placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300"
                  />
                  {help && <span className="mt-1 block text-[11px] leading-4 text-slate-400">{help}</span>}
                </label>
              ),
            )}
            <label className="block min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Category</span>
              <select
                value={recordDraft.category}
                onChange={(event) => setRecordDraft((current) => ({ ...current, category: event.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-800 ring-1 ring-slate-200 font-sans outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{sentence(category)}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Status</span>
              <select
                value={recordDraft.status}
                onChange={(event) => setRecordDraft((current) => ({ ...current, status: event.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-800 ring-1 ring-slate-200 font-sans outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{sentence(status)}</option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 sm:col-span-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Public summary</span>
              <textarea
                rows={3}
                value={recordDraft.publicSummary}
                placeholder="One or two plain sentences a stranger can check."
                onChange={(event) => setRecordDraft((current) => ({ ...current, publicSummary: event.target.value }))}
                className="mt-1 w-full rounded-xl border-0 bg-white p-3 text-sm leading-6 text-slate-800 ring-1 ring-slate-200 font-sans outline-none transition placeholder:text-xs placeholder:italic placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300"
              />
              <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                State facts only. Claims of endorsement, accreditation, or being &quot;verified by&quot; another
                organisation are rejected on save.
              </span>
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={busy === "create-record" || !recordDraft.key || !recordDraft.displayName}
                onClick={() =>
                  act(
                    "create-record",
                    () =>
                      api.post("/api/admin/trust-verification/records", {
                        ...recordDraft,
                        authorityName: recordDraft.authorityName || null,
                        jurisdiction: recordDraft.jurisdiction || null,
                        registrationNumber: recordDraft.registrationNumber || null,
                        publicSummary: recordDraft.publicSummary || null,
                        externalVerificationUrl: recordDraft.externalVerificationUrl || null,
                      }),
                    "Record created as a private draft.",
                  ).then(() => setShowRecordForm(false))
                }
                className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Create record
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {records.length === 0 && (
            <p className="m-0 py-8 text-center text-sm text-slate-500">No verification records yet.</p>
          )}
          {records.map((record) => {
            const isPublic = record.visibility === "PUBLIC" && Boolean(record.publishedAt);
            const approved = Boolean(record.evidenceApprovedAt);
            const facts = [
              ["Authority", record.authorityName],
              ["Jurisdiction", record.jurisdiction],
              ["Number", record.registrationNumber],
            ].filter(([, value]) => Boolean(value)) as [string, string][];

            return (
              <article
                key={record.id}
                className={`overflow-hidden rounded-xl ring-1 ${record.archivedAt ? "bg-slate-50 opacity-70 ring-slate-200" : "bg-white ring-slate-200"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-sm font-bold text-slate-900">{record.displayName}</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {sentence(record.status)}
                      </span>
                      {isPublic ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <Eye className="h-3 w-3" />
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          <EyeOff className="h-3 w-3" />
                          Private
                        </span>
                      )}
                      {record.archivedAt && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">Archived</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{record.key}</div>
                  </div>

                  {!record.archivedAt && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setEvidenceTarget(record);
                          setEvidenceNote(record.evidenceNote || "");
                        }}
                        className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                        {approved ? "Re-approve" : "Approve evidence"}
                      </button>
                      {isPublic ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              `unpublish-${record.id}`,
                              () => api.post(`/api/admin/trust-verification/records/${record.id}/unpublish`, {}),
                              "Record removed from the public page.",
                            )
                          }
                          className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          Unpublish
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null || !approved}
                          title={approved ? "Publish to the public verify page" : "Approve the evidence first"}
                          onClick={() =>
                            act(
                              `publish-${record.id}`,
                              () => api.post(`/api/admin/trust-verification/records/${record.id}/publish`, {}),
                              "Record published.",
                            )
                          }
                          className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Publish
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            `archive-${record.id}`,
                            () => api.post(`/api/admin/trust-verification/records/${record.id}/archive`, {}),
                            "Record archived.",
                          )
                        }
                        aria-label="Archive record"
                        title="Archive"
                        className="inline-flex h-9 w-9 appearance-none items-center justify-center rounded-lg border-0 bg-white text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {facts.length > 0 && (
                  <dl className="m-0 grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-3">
                    {facts.map(([label, value]) => (
                      <div key={label} className="min-w-0 bg-white px-4 py-2.5">
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
                        <dd className="m-0 mt-0.5 break-words text-xs font-semibold text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {/* The two gates, shown as the sequence they actually are. A
                    record cannot reach the public page without clearing both,
                    so the row says which one it is waiting on. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-slate-50 px-4 py-2.5 shadow-[inset_0_1px_0_#e2e8f0]">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${approved ? "bg-emerald-500" : "bg-slate-300"}`}>1</span>
                    <span className={approved ? "text-slate-700" : "text-slate-400"}>
                      {approved
                        ? `Evidence approved ${formatWhen(record.evidenceApprovedAt)} by ${record.evidenceApprovedBy?.name || record.evidenceApprovedBy?.email || "an administrator"}`
                        : "Evidence not approved"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${isPublic ? "bg-emerald-500" : "bg-slate-300"}`}>2</span>
                    <span className={isPublic ? "text-slate-700" : "text-slate-400"}>
                      {isPublic
                        ? `Published ${formatWhen(record.publishedAt)} by ${record.publishedBy?.name || record.publishedBy?.email || "an administrator"}`
                        : "Not published"}
                    </span>
                  </span>
                  {!record.externalVerificationUrl && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                      <Link2 className="h-3 w-3" />
                      No official lookup URL, the card will name the authority without a link
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Channels */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-bold text-slate-900">Authorised channels</h2>
            <p className="m-0 mt-1 text-xs text-slate-500">
              The list people check a suspicious message against. Never publish personal numbers or unofficial accounts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowChannelForm((open) => !open)}
            className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {showChannelForm ? "Cancel" : "New channel"}
          </button>
        </div>

        {showChannelForm && (
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Type</span>
              <select
                value={channelDraft.channelType}
                onChange={(event) => setChannelDraft((current) => ({ ...current, channelType: event.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-800 ring-1 ring-slate-200 font-sans outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {CHANNEL_TYPES.map((type) => (
                  <option key={type} value={type}>{sentence(type)}</option>
                ))}
              </select>
            </label>
            {([
              {
                field: "label",
                label: "Label",
                placeholder: "Official support email",
                help: "How the channel is named on the public page.",
              },
              {
                field: "value",
                label: "Value",
                placeholder: "support@nolsaf.com",
                help: "Shown exactly as typed. This is what people compare a suspicious message against.",
              },
              {
                field: "href",
                label: "Link (optional)",
                placeholder: "mailto:support@nolsaf.com",
                help: "Makes the entry clickable. Leave blank for an address or a phone number.",
              },
            ] as { field: keyof typeof channelDraft; label: string; placeholder: string; help?: string }[]).map(
              ({ field, label, placeholder, help }) => (
                <label key={field} className="block min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                  <input
                    type="text"
                    value={channelDraft[field]}
                    placeholder={placeholder}
                    onChange={(event) => setChannelDraft((current) => ({ ...current, [field]: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-800 ring-1 ring-slate-200 font-sans outline-none transition placeholder:text-xs placeholder:italic placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300"
                  />
                  {help && <span className="mt-1 block text-[11px] leading-4 text-slate-400">{help}</span>}
                </label>
              ),
            )}
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={busy === "create-channel" || !channelDraft.label || !channelDraft.value}
                onClick={() =>
                  act(
                    "create-channel",
                    () =>
                      api.post("/api/admin/trust-verification/channels", {
                        ...channelDraft,
                        href: channelDraft.href || null,
                      }),
                    "Channel created as a private draft.",
                  ).then(() => setShowChannelForm(false))
                }
                className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Create channel
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {channels.length === 0 && (
            <p className="m-0 py-8 text-center text-sm text-slate-500">No channels recorded yet.</p>
          )}
          {channels.map((channel) => {
            const isPublic = channel.visibility === "PUBLIC" && Boolean(channel.publishedAt);
            return (
              <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{channel.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {sentence(channel.channelType)}
                    </span>
                    {isPublic ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        Public
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Private</span>
                    )}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-600">{channel.value}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {channel.confirmedAt
                      ? `Confirmed ${formatWhen(channel.confirmedAt)} by ${channel.confirmedBy?.name || channel.confirmedBy?.email || "an administrator"}`
                      : "Ownership not confirmed"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        `confirm-channel-${channel.id}`,
                        () => api.post(`/api/admin/trust-verification/channels/${channel.id}/confirm`, {}),
                        "Channel ownership confirmed.",
                      )
                    }
                    className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                    {channel.confirmedAt ? "Re-confirm" : "Confirm"}
                  </button>
                  {isPublic ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `unpublish-channel-${channel.id}`,
                          () => api.post(`/api/admin/trust-verification/channels/${channel.id}/unpublish`, {}),
                          "Channel removed from the public page.",
                        )
                      }
                      className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      Unpublish
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `publish-channel-${channel.id}`,
                          () => api.post(`/api/admin/trust-verification/channels/${channel.id}/publish`, {}),
                          "Channel published.",
                        )
                      }
                      className="inline-flex appearance-none items-center gap-1.5 rounded-lg border-0 bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Publish
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Evidence approval. This note is the audit record of why a corporate
          claim was trusted, so it is written in a proper dialog rather than a
          browser prompt, with the claim visible while you write it. */}
      {evidenceTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Approve evidence"
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setEvidenceTarget(null)} />
          <div
            id="evidence-dialog"
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <style>{`#evidence-dialog, #evidence-dialog * { box-sizing: border-box; }`}</style>

            <div className="flex items-start justify-between gap-3 bg-emerald-50 px-6 py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <CheckCircle className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Approve evidence</div>
                  <h3 className="m-0 mt-0.5 truncate text-base font-bold text-slate-900">{evidenceTarget.displayName}</h3>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{evidenceTarget.key}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEvidenceTarget(null)}
                aria-label="Close"
                className="inline-flex h-9 w-9 flex-shrink-0 appearance-none items-center justify-center rounded-lg border-0 bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="m-0 text-sm leading-6 text-slate-600">
                Describe the document you checked and how you confirmed it. This is stored in the audit log against your
                account and is what an investigation reads to understand why this claim was published.
              </p>

              <label className="mt-4 block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Evidence note</span>
                <textarea
                  rows={4}
                  autoFocus
                  value={evidenceNote}
                  onChange={(event) => setEvidenceNote(event.target.value)}
                  placeholder="For example: checked the certified BRELA incorporation certificate dated 12 Mar 2026 against the registrar's public record."
                  className="mt-1 w-full rounded-xl border-0 bg-white p-3 text-sm leading-6 text-slate-800 ring-1 ring-slate-200 font-sans outline-none transition placeholder:text-xs placeholder:italic placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300"
                />
              </label>

              <p className="m-0 mt-3 rounded-xl bg-amber-50 p-3 text-[11px] font-medium leading-5 text-amber-900 ring-1 ring-amber-200">
                Approving evidence does not publish anything. The record stays private until you publish it separately.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 bg-slate-50 px-6 py-4 shadow-[inset_0_1px_0_#e2e8f0]">
              <button
                type="button"
                onClick={() => setEvidenceTarget(null)}
                className="appearance-none rounded-xl border-0 bg-white px-4 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || evidenceNote.trim().length < 10}
                title={evidenceNote.trim().length < 10 ? "Write at least a short sentence" : "Approve the evidence"}
                onClick={() => {
                  const target = evidenceTarget;
                  const note = evidenceNote.trim();
                  act(
                    `approve-${target.id}`,
                    () => api.post(`/api/admin/trust-verification/records/${target.id}/approve-evidence`, { note }),
                    "Evidence approved. The record is still private until you publish it.",
                  ).then(() => {
                    setEvidenceTarget(null);
                    setEvidenceNote("");
                  });
                }}
                className="inline-flex appearance-none items-center gap-2 rounded-xl border-0 bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Approve evidence
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
