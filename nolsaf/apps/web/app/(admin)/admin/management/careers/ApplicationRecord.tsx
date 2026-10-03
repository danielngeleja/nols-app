"use client";

// Company application record, in the admin Sales record language: a quiet white
// dialog with a sticky header, an identity row, a fact strip, uppercase section
// labels over ruled tables, and actions as tinted rows inside the record.

import { useEffect } from "react";
import { BadgeCheck, CheckCircle2, Download, Eye, FileSignature, Languages as LanguagesIcon, Loader2, MapPin, Sparkles, Wrench, X } from "lucide-react";
import { normalizePartnershipProfile } from "@/components/careers/partnershipProfile";

type ContractWorkflow = {
  status: "PENDING_NOLSAF_SIGNATURE" | "PENDING_AGENT_SIGNATURE" | "EXECUTED";
  contractId: string;
  version: string;
  createdAt: string;
  preparedAt?: string;
  nolsafSignedAt?: string;
  nolsafSignatoryName?: string;
  agentSignedAt?: string;
  agentSignerName?: string;
};

type AuditItem = {
  id: number;
  action: string;
  createdAt: string;
  actorName?: string | null;
  actorRole?: string | null;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
};

type Props = {
  application: any;
  displayStatus: (status: string) => string;
  onClose: () => void;
  updating: boolean;
  onChangeStatus: (status: string) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  savingNotes: boolean;
  onSaveNotes: () => void;
  contract: ContractWorkflow | null;
  contractLoading: boolean;
  contractAction: "prepare" | "sign" | null;
  onPrepareContract: () => void;
  onSignContract: () => void;
  audit: AuditItem[];
  auditLoading: boolean;
  formatAuditAction: (action: string) => string;
  summarizeAuditEvent: (entry: AuditItem) => string;
  onViewDocument: () => void;
  onDownloadDocument: () => void;
};

const fieldClass = "min-h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const primaryClass = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45";
const dangerClass = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-solid border-rose-200 bg-white px-3.5 text-xs font-bold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45";

export const APPLICATION_STAGES = [
  { key: "PENDING", label: "Received", hint: "Waiting for a first review", text: "text-amber-700", dot: "bg-amber-500", ring: "ring-amber-400", bar: "bg-amber-400", soft: "bg-amber-50", pill: "border-amber-100 bg-amber-50 text-amber-700" },
  { key: "REVIEWING", label: "In review", hint: "Being checked by the team", text: "text-sky-700", dot: "bg-sky-500", ring: "ring-sky-400", bar: "bg-sky-400", soft: "bg-sky-50", pill: "border-sky-100 bg-sky-50 text-sky-700" },
  { key: "SHORTLISTED", label: "Qualified", hint: "Meets the partnership bar", text: "text-teal-700", dot: "bg-teal-500", ring: "ring-teal-400", bar: "bg-teal-400", soft: "bg-teal-50", pill: "border-teal-100 bg-teal-50 text-teal-700" },
  { key: "HIRED", label: "Approved", hint: "Operator joins the tours workflow", text: "text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50", pill: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  { key: "REJECTED", label: "Rejected", hint: "Not taken forward", text: "text-rose-600", dot: "bg-rose-500", ring: "ring-rose-400", bar: "bg-rose-400", soft: "bg-rose-50", pill: "border-rose-100 bg-rose-50 text-rose-700" },
] as const;

export const stageOf = (status: string) => APPLICATION_STAGES.find((stage) => stage.key === String(status || "").toUpperCase()) || null;

export function applicationReference(id: number) {
  return `NLS-A-${String(id).padStart(4, "0")}`;
}

/** Company name for an application: the declared company, else the contact. */
export function applicationCompany(app: any) {
  const data = app?.agentApplicationData as any;
  const profile = data?.partnershipProfile && typeof data.partnershipProfile === "object" ? data.partnershipProfile : data;
  return String(profile?.companyName || app?.fullName || "Company application").trim();
}

function date(value?: string | null, withTime = false) {
  if (!value) return "Not set";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not set";
  const text = d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Africa/Dar_es_Salaam" });
  return withTime ? `${text} EAT` : text;
}

function relativeAgo(value?: string | null) {
  if (!value) return "";
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-500">{children}</h3>
      {right}
    </div>
  );
}

function Pairs({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="m-0 mt-2 grid grid-cols-1 border-0 border-t border-solid border-neutral-200 sm:grid-cols-2">
      {rows.map(([label, value]) => {
        const empty = value === null || value === undefined || value === "";
        return (
          <div key={label} className="grid min-w-0 grid-cols-[9.5rem_minmax(0,1fr)] gap-3 border-0 border-b border-solid border-neutral-200 px-3 py-2.5 sm:[&:nth-child(odd)]:border-r">

            <dt className="text-[11px] text-neutral-500">{label}</dt>
            <dd className={`m-0 min-w-0 break-words text-xs ${empty ? "text-neutral-400" : "font-semibold text-neutral-800"}`}>{empty ? "Not provided" : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function ApplicationRecord(props: Props) {
  const { application: app, displayStatus, onClose } = props;
  const status = String(app.status || "").toUpperCase();
  const stage = stageOf(status);
  const isFinalized = status === "HIRED" || status === "REJECTED";
  const reference = applicationReference(app.id);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const agentData = (app.agentApplicationData || null) as any;
  const profile = agentData
    ? normalizePartnershipProfile(agentData?.partnershipProfile && typeof agentData.partnershipProfile === "object" ? agentData.partnershipProfile : agentData)
    : null;
  const company = applicationCompany(app);
  const region = agentData?.region ? String(agentData.region) : "";
  const district = agentData?.district ? String(agentData.district) : "";
  const languages: string[] = Array.isArray(agentData?.languages) ? agentData.languages : [];
  const specializations: string[] = Array.isArray(agentData?.specializations) ? agentData.specializations : [];
  const certifications: any[] = Array.isArray(agentData?.certifications) ? agentData.certifications : [];
  const narrative = String(agentData?.bio || app.coverLetter || "").trim();
  const fleet: any[] = profile?.fleet || [];
  const vehicles = fleet.reduce((sum, v) => sum + (Number(v?.count) || 0), 0);
  const compliance = profile
    ? [
        ["Business registration (BRELA)", profile.businessRegistrationNumber],
        ["TIN number", profile.tinNumber],
        ["Business licence", profile.businessLicenseNumber],
        ["Tourism permit", profile.tourismPermitNumber],
        ["Vehicle permit", profile.vehiclePermitNumber],
      ] as Array<[string, string | null | undefined]>
    : [];
  const complianceDone = compliance.filter(([, value]) => String(value || "").trim()).length;
  const hasDocument = Boolean(app.resumeStorageKey || app.resumeUrl);
  const forward = APPLICATION_STAGES.filter((s) => s.key !== "PENDING" && s.key !== status);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-950/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-application-title"
        className="max-h-[calc(100dvh-24px)] w-full max-w-5xl overflow-y-auto rounded-xl border border-solid border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-48px)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-0 border-b border-solid border-neutral-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Tour company application</p>
            <h2 id="tour-application-title" className="mb-0 mt-1 truncate text-lg font-bold text-neutral-950">{company}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900" aria-label="Close application">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Identity */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-emerald-700">{reference}</span>
                <span className={`rounded-full border border-solid px-2.5 py-1 text-[10px] font-bold ${stage?.pill || "border-neutral-200 bg-neutral-100 text-neutral-600"}`}>{displayStatus(app.status)}</span>
                {app.job?.title ? <span className="rounded-full border border-solid border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700">{app.job.title}</span> : null}
              </div>
              <p className="mb-0 mt-2 text-sm font-semibold text-neutral-800">{app.fullName || "Contact not named"}</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">{[app.email, app.phone].filter(Boolean).join(" / ") || "No contact details"}</p>
            </div>
            <div className="text-right text-[11px] text-neutral-500">
              <p className="m-0">Submitted {date(app.submittedAt)}</p>
              <p className="mb-0 mt-1">Reviewed {app.reviewedAt ? date(app.reviewedAt) : "not yet"}{app.reviewedByUser ? ` by ${app.reviewedByUser.name || app.reviewedByUser.email}` : ""}</p>
            </div>
          </div>

          {/* Lifecycle */}
          <ol className="m-0 grid list-none grid-cols-4 gap-1.5 p-0" aria-label="Application lifecycle">
            {(status === "REJECTED" ? ["PENDING", "REVIEWING", "SHORTLISTED", "REJECTED"] : ["PENDING", "REVIEWING", "SHORTLISTED", "HIRED"]).map((key, index, keys) => {
              const s = stageOf(key)!;
              const at = keys.indexOf(status);
              const reached = at >= 0 && index <= at;
              return (
                <li key={key} className="min-w-0">
                  <span className={`block h-1 rounded-full ${reached ? s.bar : "bg-neutral-200/70"}`} />
                  <span className={`mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold ${reached ? s.text : "text-neutral-400"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${reached ? s.dot : "bg-neutral-300"}`} /> {s.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* Fact strip */}
          <dl className="grid grid-cols-2 border-0 border-y border-solid border-neutral-200 md:grid-cols-6">
            {[
              ["Region", region || "Not set"],
              ["District", district || "Not set"],
              ["In operation", profile?.yearsInOperation != null ? `${profile.yearsInOperation} years` : "Not set"],
              ["Team", profile?.teamSize != null ? String(profile.teamSize) : "Not set"],
              ["Fleet", profile ? (profile.hasVehicles ? `${vehicles || fleet.length} vehicles` : "None") : "Not set"],
              ["Compliance", profile ? `${complianceDone} of ${compliance.length}` : "Not set"],
            ].map(([label, value], index) => (
              <div key={label} className={`min-w-0 px-3 py-3 ${index % 2 ? "border-0 border-l border-solid border-neutral-200" : ""} md:border-0 md:border-l md:border-solid md:border-neutral-200 ${index === 0 ? "md:border-l-0" : ""}`}>
                <dt className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</dt>
                <dd className={`mb-0 mt-1 truncate text-xs font-semibold ${label === "Compliance" && profile && complianceDone < compliance.length ? "text-amber-700" : "text-neutral-700"}`}>{value}</dd>
              </div>
            ))}
          </dl>

          {/* Decision */}
          {isFinalized ? (
            <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${stage?.soft || "bg-neutral-50"} ${stage?.text || "text-neutral-700"}`}>
              {status === "HIRED" ? <BadgeCheck className="h-4 w-4" /> : <X className="h-4 w-4" />}
              <span className="font-bold">{status === "HIRED" ? "Approved" : "Rejected"}.</span>
              <span className="opacity-80">This decision is final and the status can no longer change.</span>
            </div>
          ) : (
            <div className="rounded-lg bg-sky-50/60 px-3 py-3">
              <p className="m-0 text-xs font-bold text-sky-900">Move this application forward</p>
              <p className="mb-0 mt-1 text-[10px] text-sky-700">The company is emailed whenever the status changes. Approving creates their operator account.</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {forward.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={props.updating}
                    onClick={() => props.onChangeStatus(s.key)}
                    className={s.key === "HIRED" ? primaryClass : s.key === "REJECTED" ? dangerClass : actionClass}
                  >
                    {s.key === "HIRED" ? <BadgeCheck className="h-4 w-4" /> : null}
                    {s.key === "REVIEWING" ? "Start review" : s.key === "SHORTLISTED" ? "Mark qualified" : s.key === "HIRED" ? "Approve operator" : "Reject"}
                  </button>
                ))}
                {status !== "PENDING" ? (
                  <button type="button" disabled={props.updating} onClick={() => props.onChangeStatus("PENDING")} className="cursor-pointer border-0 bg-transparent px-1 text-[11px] font-semibold text-sky-800 hover:underline disabled:opacity-45">
                    Move back to received
                  </button>
                ) : null}
                {props.updating ? <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-800"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating</span> : null}
              </div>
            </div>
          )}

          {/* Company */}
          <div>
            <SectionLabel>Company and contact</SectionLabel>
            <Pairs
              rows={[
                ["Contact person", app.fullName],
                ["Nationality", agentData?.nationality || app.nationality],
                ["Contact email", app.email],
                ["Contact phone", app.phone],
                ...(profile
                  ? ([
                      ["Company email", profile.companyEmail],
                      ["Company phone", profile.companyPhone],
                      ["Website", profile.companyWebsite],
                      ["Business address", profile.businessAddress],
                    ] as Array<[string, React.ReactNode]>)
                  : ([["Company or contact link", app.linkedIn]] as Array<[string, React.ReactNode]>)),
              ]}
            />
            {narrative ? (
              <p className="mb-0 mt-3 whitespace-pre-wrap border-0 border-l-2 border-solid border-emerald-600 px-3 py-1 text-xs leading-6 text-neutral-700">{narrative}</p>
            ) : null}
          </div>

          {profile ? (
            <>
              {(() => {
                // Each tourism type owns the services listed under it; services that are not
                // tied to one type ("Common Services") run across all tours.
                const classification = (profile.serviceClassification || {}) as Record<string, string[]>;
                const isCommon = (name: string) => /common|general|all tours/i.test(name);
                const typeBlocks = (profile.tourismTypes || []).map((name) => ({ name, items: classification[name] || [] }));
                const extraBlocks = Object.entries(classification)
                  .filter(([name]) => !isCommon(name) && !(profile.tourismTypes || []).includes(name))
                  .map(([name, items]) => ({ name, items }));
                const blocks = [...typeBlocks, ...extraBlocks];
                const common = Object.entries(classification).filter(([name]) => isCommon(name)).flatMap(([, items]) => items);
                const flatServices = Object.keys(classification).length ? [] : profile.services || [];
                const acrossAll = [...common, ...flatServices];
                const serviceCount = blocks.reduce((sum, b) => sum + b.items.length, 0) + acrossAll.length;
                // Pick a column count that fills every row, so the grid never shows a grey hole.
                const cols = blocks.length <= 1 ? 1 : blocks.length % 3 === 0 ? 3 : 2;
                const gridCols = cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";
                const fillers = cols === 2 && blocks.length % 2 === 1 ? 1 : 0;
                const capability = [
                  { label: "Parks and tour sites", icon: MapPin, items: profile.registeredParks || [] },
                  { label: "Languages", icon: LanguagesIcon, items: languages },
                  { label: "Specializations", icon: Sparkles, items: specializations },
                  { label: "Tools and assets", icon: Wrench, items: profile.toolsAndAssets || [] },
                ];
                return (
                  <>
                    <div>
                      <SectionLabel right={<span className="text-[11px] tabular-nums text-neutral-400">{blocks.length} {blocks.length === 1 ? "type" : "types"} · {serviceCount} services</span>}>
                        Services offered
                      </SectionLabel>
                      {blocks.length || acrossAll.length ? (
                        <div className={`mt-2 grid grid-cols-1 gap-px border-0 border-y border-solid border-neutral-200 bg-neutral-200 ${gridCols}`}>
                          {blocks.map((block) => (
                            <div key={block.name} className="min-w-0 bg-white px-3 py-3">
                              <p className="m-0 flex items-center justify-between gap-2">
                                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold text-neutral-900">
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                  <span className="truncate">{block.name}</span>
                                </span>
                                <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">{block.items.length || "No"} {block.items.length === 1 ? "service" : "services"}</span>
                              </p>
                              {block.items.length ? (
                                <ul className="m-0 mt-2 list-none space-y-1 p-0">
                                  {block.items.map((item, idx) => (
                                    <li key={`${item}-${idx}`} className="flex items-start gap-1.5 text-[11.5px] leading-4 text-neutral-700">
                                      <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-emerald-600" />
                                      <span className="min-w-0">{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="m-0 mt-2 text-[11px] text-neutral-400">Listed as a tourism type, with no services named.</p>
                              )}
                            </div>
                          ))}
                          {Array.from({ length: fillers }, (_, i) => (
                            <div key={`filler-${i}`} className="hidden bg-white sm:block" aria-hidden />
                          ))}
                          {acrossAll.length ? (
                            <div className="min-w-0 bg-neutral-50/80 px-3 py-3 sm:col-span-full">
                              <p className="m-0 flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-neutral-900">{flatServices.length ? "Services" : "Across all tours"}</span>
                                <span className="text-[10px] tabular-nums text-neutral-400">{acrossAll.length} {acrossAll.length === 1 ? "service" : "services"}</span>
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {acrossAll.map((item, idx) => (
                                  <span key={`${item}-${idx}`} className="inline-flex rounded-md border border-solid border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700">{item}</span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mb-0 mt-2 border-0 border-y border-solid border-neutral-200 px-3 py-5 text-center text-xs text-neutral-500">No tourism types or services submitted.</p>
                      )}
                    </div>

                    <div>
                      <SectionLabel>Reach and capability</SectionLabel>
                      <div className="mt-2 grid grid-cols-1 gap-px border-0 border-y border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-2">
                        {capability.map(({ label, icon: Icon, items }) => {
                          const list = items.filter(Boolean);
                          return (
                            <div key={label} className="min-w-0 bg-white px-3 py-3">
                              <p className="m-0 flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-2 text-xs font-bold text-neutral-900">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#0b2420] text-emerald-300"><Icon className="h-3.5 w-3.5" /></span>
                                  {label}
                                </span>
                                <span className="text-[10px] tabular-nums text-neutral-400">{list.length}</span>
                              </p>
                              {list.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {list.map((item, idx) => (
                                    <span key={`${item}-${idx}`} className="inline-flex rounded-md border border-solid border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">{item}</span>
                                  ))}
                                </div>
                              ) : (
                                <p className="m-0 mt-2 text-[11px] text-neutral-400">None submitted</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}

              <div>
                <SectionLabel>Fleet</SectionLabel>
                <div className="mt-2 overflow-x-auto border-0 border-y border-solid border-neutral-200">
                  {fleet.length ? (
                    <table className="w-full min-w-[36rem] table-fixed border-collapse text-left">
                      <thead className="bg-neutral-50 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                        <tr><th className="w-[28%] px-3 py-2.5">Vehicle</th><th className="w-[12%] px-3 py-2.5">Count</th><th className="w-[14%] px-3 py-2.5">Seats each</th><th className="w-[18%] px-3 py-2.5">Ownership</th><th className="px-3 py-2.5">Details</th></tr>
                      </thead>
                      <tbody>
                        {fleet.map((v: any, idx: number) => (
                          <tr key={idx} className="border-0 border-t border-solid border-neutral-100 align-top">
                            <td className="px-3 py-2.5 text-[11px] font-bold text-neutral-900">{v?.type || "Not given"}</td>
                            <td className="px-3 py-2.5 text-[11px] tabular-nums text-neutral-600">{v?.count ?? "Not given"}</td>
                            <td className="px-3 py-2.5 text-[11px] tabular-nums text-neutral-600">{v?.capacity ?? "Not given"}</td>
                            <td className="px-3 py-2.5 text-[11px] text-neutral-600">{v?.ownership === "rented" ? "Rented" : v?.ownership === "leased" ? "Leased" : "Company owned"}</td>
                            <td className="px-3 py-2.5 text-[10px] leading-5 text-neutral-500">{[v?.registrationNumber ? `Reg ${v.registrationNumber}` : "", v?.serviceMode, v?.condition].filter(Boolean).join(" / ") || "None"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="m-0 px-3 py-6 text-center text-xs text-neutral-500">{profile.hasVehicles ? "Has vehicles, but no vehicle records were submitted." : "The company does not run its own vehicles."}</p>
                  )}
                </div>
              </div>

              <div>
                <SectionLabel right={<span className={`text-[11px] font-bold tabular-nums ${complianceDone === compliance.length ? "text-emerald-700" : "text-amber-700"}`}>{complianceDone} of {compliance.length} provided</span>}>
                  Compliance
                </SectionLabel>
                <div className="mt-2 border-0 border-y border-solid border-neutral-200">
                  <table className="w-full table-fixed border-collapse text-left">
                    <thead className="bg-neutral-50 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                      <tr><th className="w-[42%] px-3 py-2.5">Registration</th><th className="px-3 py-2.5">Number</th><th className="w-[16%] px-3 py-2.5">Status</th></tr>
                    </thead>
                    <tbody>
                      {compliance.map(([label, value]) => {
                        const ok = Boolean(String(value || "").trim());
                        return (
                          <tr key={label} className="border-0 border-t border-solid border-neutral-100">
                            <td className="px-3 py-2.5 text-[11px] text-neutral-700">{label}</td>
                            <td className={`px-3 py-2.5 text-[11px] ${ok ? "font-mono font-bold text-neutral-900" : "text-neutral-400"}`}>{ok ? value : "Not provided"}</td>
                            <td className="px-3 py-2.5"><span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[9px] font-bold ${ok ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>{ok ? "PROVIDED" : "MISSING"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {certifications.length ? (
                    <table className="w-full table-fixed border-collapse border-0 border-t border-solid border-neutral-200 text-left">
                      <thead className="bg-neutral-50 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                        <tr><th className="w-[42%] px-3 py-2.5">Licence or certification</th><th className="px-3 py-2.5">Issuer</th><th className="w-[12%] px-3 py-2.5">Year</th><th className="w-[16%] px-3 py-2.5">Expires</th></tr>
                      </thead>
                      <tbody>
                        {certifications.map((cert: any, idx: number) => (
                          <tr key={idx} className="border-0 border-t border-solid border-neutral-100">
                            <td className="px-3 py-2.5 text-[11px] font-bold text-neutral-900">{cert.name || "Not named"}</td>
                            <td className="px-3 py-2.5 text-[11px] text-neutral-600">{cert.issuer || "Not given"}</td>
                            <td className="px-3 py-2.5 text-[11px] text-neutral-600">{cert.year || "Not given"}</td>
                            <td className="px-3 py-2.5 text-[11px] text-neutral-600">{cert.expiryDate || "Not given"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-3 text-xs text-neutral-500">No licences or certifications submitted.</p>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {(app.resumeFileName || hasDocument) ? (
            <div>
              <SectionLabel>Supporting document</SectionLabel>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-0 border-y border-solid border-neutral-200 px-3 py-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-xs font-bold text-neutral-900">{app.resumeFileName || "Application document"}</p>
                  <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">{hasDocument ? (app.resumeSize ? `${Math.round(app.resumeSize / 1024)} KB` : "Stored with the application") : "The upload did not complete. The file is not available."}</p>
                </div>
                {hasDocument ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={props.onViewDocument} className={actionClass}><Eye className="h-4 w-4" /> View</button>
                    <button type="button" onClick={props.onDownloadDocument} className={actionClass}><Download className="h-4 w-4" /> Download</button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Contract */}
          {(() => {
            const c = props.contract;
            // 0 nothing yet, 1 draft prepared, 2 NoLSAF signed, 3 operator countersigned.
            const reached = c?.status === "EXECUTED" ? 3 : c?.status === "PENDING_AGENT_SIGNATURE" ? 2 : c ? 1 : 0;
            const state =
              status !== "HIRED"
                ? { label: "Locked", tone: "border-neutral-200 bg-neutral-100 text-neutral-500" }
                : reached === 3
                  ? { label: "Executed", tone: "border-emerald-100 bg-emerald-50 text-emerald-700" }
                  : reached === 2
                    ? { label: "Awaiting operator", tone: "border-sky-100 bg-sky-50 text-sky-700" }
                    : reached === 1
                      ? { label: "Awaiting NoLSAF", tone: "border-amber-100 bg-amber-50 text-amber-700" }
                      : { label: "Not prepared", tone: "border-neutral-200 bg-neutral-100 text-neutral-600" };
            // Past tense once a step is done, the action itself while it is still ahead.
            const steps = [
              { title: "Draft prepared", todo: "Prepare draft", at: c?.preparedAt || c?.createdAt, by: null as string | null | undefined },
              { title: "Signed by NoLSAF", todo: "NoLSAF signs", at: c?.nolsafSignedAt, by: c?.nolsafSignatoryName },
              { title: "Countersigned by operator", todo: "Operator countersigns", at: c?.agentSignedAt, by: c?.agentSignerName },
            ];
            return (
              <div>
                <SectionLabel
                  right={
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {app.agent ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-solid border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Operator account active
                        </span>
                      ) : null}
                      <span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${state.tone}`}>{state.label}</span>
                    </span>
                  }
                >
                  Partnership contract
                </SectionLabel>

                {status !== "HIRED" ? (
                  <p className="mb-0 mt-2 border-0 border-y border-solid border-neutral-200 px-3 py-4 text-xs text-neutral-500">
                    The contract opens once the operator is approved.
                  </p>
                ) : props.contractLoading ? (
                  <p className="mb-0 mt-2 flex items-center gap-2 border-0 border-y border-solid border-neutral-200 px-3 py-4 text-xs text-neutral-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading contract
                  </p>
                ) : (
                  <div className="mt-2 border-0 border-y border-solid border-neutral-200">
                    {c?.contractId ? (
                      <p className="m-0 border-0 border-b border-solid border-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
                        Contract <span className="font-mono font-bold text-neutral-800">{c.contractId}</span>
                        {c.version ? <span className="text-neutral-400"> · version {c.version}</span> : null}
                      </p>
                    ) : null}

                    {/* Three joined steps */}
                    <ol className="m-0 grid list-none grid-cols-1 gap-px bg-neutral-100 p-0 sm:grid-cols-3">
                      {steps.map((step, index) => {
                        const done = reached > index;
                        const next = reached === index;
                        return (
                          <li key={step.title} className={`flex min-w-0 items-start gap-2.5 px-3 py-3 ${done ? "bg-white" : next ? "bg-amber-50/50" : "bg-white"}`}>
                            <span
                              className={`mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                                done ? "bg-emerald-600 text-white" : next ? "bg-white text-amber-700 ring-2 ring-amber-400" : "bg-neutral-100 text-neutral-400"
                              }`}
                            >
                              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-xs font-bold ${done ? "text-neutral-900" : next ? "text-amber-800" : "text-neutral-400"}`}>{done ? step.title : step.todo}</span>
                              <span className="mt-0.5 block truncate text-[10.5px] text-neutral-500">
                                {done ? `${date(step.at, true)}${step.by ? ` · ${step.by}` : ""}` : next ? "Next step" : "Waiting"}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>

                    {/* The one action that moves the contract on */}
                    {reached < 2 ? (
                      <div className="flex flex-col gap-2 border-0 border-t border-solid border-neutral-100 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <p className="m-0 text-[11px] text-neutral-600">
                          {reached === 0
                            ? "Prepare the draft. NoLSAF signs it first, then it goes to the operator."
                            : "The draft is ready. Once NoLSAF signs, the operator is asked to countersign."}
                        </p>
                        {reached === 0 ? (
                          <button type="button" onClick={props.onPrepareContract} disabled={props.contractAction !== null} className={`${actionClass} shrink-0`}>
                            {props.contractAction === "prepare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}Prepare draft
                          </button>
                        ) : (
                          <button type="button" onClick={props.onSignContract} disabled={props.contractAction !== null} className={`${primaryClass} shrink-0`}>
                            {props.contractAction === "sign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}Sign as NoLSAF
                          </button>
                        )}
                      </div>
                    ) : reached === 2 ? (
                      <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-2.5 text-[11px] text-neutral-600">NoLSAF has signed. Waiting for the operator to countersign.</p>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Notes */}
          <div className="border-0 border-t border-solid border-neutral-200 pt-4">
            <SectionLabel>Internal notes</SectionLabel>
            <textarea
              value={props.notes}
              onChange={(e) => props.onNotesChange(e.target.value)}
              rows={3}
              placeholder="Notes for the team. Never sent to the company."
              className={`${fieldClass} mt-2 resize-y py-2`}
              style={{ fontFamily: "inherit" }}
            />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={props.onSaveNotes} disabled={props.savingNotes} className={primaryClass}>
                {props.savingNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save notes
              </button>
            </div>
          </div>

          {/* Audit */}
          <div className="border-0 border-t border-solid border-neutral-200 pt-4">
            <SectionLabel right={props.audit.length ? <span className="text-[11px] tabular-nums text-neutral-400">{props.audit.length} {props.audit.length === 1 ? "event" : "events"}</span> : null}>
              Audit trail
            </SectionLabel>
            <div className="mt-2 border-0 border-y border-solid border-neutral-200">
              {props.auditLoading ? (
                <p className="m-0 flex items-center justify-center gap-2 px-3 py-5 text-xs text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading events</p>
              ) : props.audit.length === 0 ? (
                <p className="m-0 px-3 py-6 text-center text-xs text-neutral-500">No recorded events yet.</p>
              ) : (
                <ol className="m-0 list-none px-3 py-1">
                  {props.audit.slice(0, 15).map((entry, index, list) => {
                    const from = typeof entry.before?.status === "string" ? stageOf(entry.before.status) : null;
                    const to = typeof entry.after?.status === "string" ? stageOf(entry.after.status) : null;
                    const statusChange = Boolean(from && to && from.key !== to.key);
                    const actor = entry.actorName || "System";
                    const role = entry.actorRole ? entry.actorRole.charAt(0) + entry.actorRole.slice(1).toLowerCase() : "";
                    return (
                      <li key={entry.id} className="relative flex gap-3 py-3">
                        {/* Rail between events */}
                        {index < list.length - 1 ? <span className="absolute bottom-0 left-[5px] top-[22px] w-px bg-neutral-200" aria-hidden /> : null}
                        <span className={`relative mt-[7px] h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-white ${to?.dot || "bg-neutral-400"}`} aria-hidden />

                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            {statusChange ? (
                              <p className="m-0 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                                <span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${from!.pill}`}>{from!.label}</span>
                                to
                                <span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${to!.pill}`}>{to!.label}</span>
                              </p>
                            ) : (
                              <p className="m-0 text-xs font-bold text-neutral-900">{props.formatAuditAction(entry.action)}</p>
                            )}
                            <p className="mb-0 mt-1 text-[11px] text-neutral-500">
                              {statusChange ? "Status changed" : props.summarizeAuditEvent(entry)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-3 sm:text-right">
                            <div className="order-2 sm:order-1">
                              <p className="m-0 text-[11px] font-semibold text-neutral-700">{relativeAgo(entry.createdAt)}</p>
                              <p className="m-0 text-[10px] tabular-nums text-neutral-400">{date(entry.createdAt, true)}</p>
                            </div>
                            <span className="order-1 inline-flex items-center gap-2 sm:order-2" title={role ? `${actor}, ${role}` : actor}>
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">{initialsOf(actor)}</span>
                              <span className="min-w-0 text-left">
                                <span className="block text-[11px] font-semibold text-neutral-700">{actor}</span>
                                {role ? <span className="block text-[10px] text-neutral-400">{role}</span> : null}
                              </span>
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
