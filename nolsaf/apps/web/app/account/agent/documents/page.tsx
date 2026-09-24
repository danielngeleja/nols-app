"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import DatePickerField from "@/components/DatePickerField";
import apiClient from "@/lib/apiClient";
import LogoSpinner from "@/components/LogoSpinner";
import TableScroller from "@/components/TableScroller";

const api = apiClient;

type ProofPhoto = {
  url: string;
  name?: string;
};

type DocumentProofValue =
  | string
  | {
      url: string;
      status?: string;
      uploadedAt?: string;
      approvedAt?: string;
      rejectedAt?: string;
      rejectionReason?: string;
      expiresOn?: string;
      expiresAt?: string | null;
    };

type OperatorProfile = {
  classifiedPhotos?: Record<string, string[]>;
  documentProofs?: Record<string, DocumentProofValue>;
  [key: string]: any;
};

type AgentMe = {
  ok: boolean;
  agent?: {
    operatorProfile?: OperatorProfile;
  };
};

type CloudinarySig = {
  timestamp: number;
  signature: string;
  folder: string;
  cloudName: string;
  apiKey: string;
};

/** Documents that carry an expiry the operator must supply. */
const EXPIRING_DOCUMENTS = ["license", "business"] as const;

const REQUIRED_DOCUMENTS = [
  { id: "brela", label: "BRELA Certificate", description: "Business Registration Certificate", match: ["brela"] },
  { id: "tin", label: "TIN Number", description: "Tax Identification Number Certificate", match: ["tin"] },
  { id: "license", label: "Tourism License", description: "Valid Tourism Operating License", match: ["tourism-license", "tourism_license"] },
  { id: "business", label: "Business Licence", description: "Business Licence Certificate", match: ["business-licence", "business_licence", "business-license"] },
  { id: "nationalId", label: "National ID / Passport", description: "Representative's National ID or Travel Passport", match: ["national-id", "national_id", "passport"] },
];

const DOCUMENT_TYPE_BY_ID: Record<string, string> = {
  brela: "BRELA_CERTIFICATE",
  tin: "TIN_NUMBER",
  license: "TOURISM_LICENSE",
  business: "BUSINESS_LICENCE",
  nationalId: "NATIONAL_ID_OR_PASSPORT",
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** A licence inside this window is flagged before it lapses. */
const EXPIRY_WARNING_DAYS = 60;

export default function AgentDocumentsPage() {
  const [loading, setLoading] = useState(true);
  const [proofPhotos, setProofPhotos] = useState<ProofPhoto[]>([]);
  const [operatorProfile, setOperatorProfile] = useState<OperatorProfile>({});
  // Scoped to the document being uploaded, so one upload does not put every
  // other row into a spinner.
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [licenseExpiresOn, setLicenseExpiresOn] = useState("");
  const [businessExpiresOn, setBusinessExpiresOn] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The picked document travels in a ref, not state: the file dialog opens in
  // the same tick as the click, before React has re-rendered with new state.
  const pendingDocId = useRef<string>("");

  const fetchPhotos = useCallback(async () => {
    try {
      const res = await api.get("/api/agent/me", { params: { _t: Date.now() } });
      const data = (res as any)?.data as AgentMe;
      const currentProfile = data?.agent?.operatorProfile ?? {};
      setOperatorProfile(currentProfile);
      const savedLicenseProof = currentProfile.documentProofs?.license;
      const savedLicenseExpiry = typeof savedLicenseProof === "string"
        ? ""
        : String(savedLicenseProof?.expiresOn ?? "").slice(0, 10);
      const savedBusinessProof = currentProfile.documentProofs?.business;
      const savedBusinessExpiry = typeof savedBusinessProof === "string"
        ? ""
        : String(savedBusinessProof?.expiresOn ?? "").slice(0, 10);
      setLicenseExpiresOn(savedLicenseExpiry);
      setBusinessExpiresOn(savedBusinessExpiry);
      const classified = currentProfile.classifiedPhotos ?? {};
      const proofUrls = Array.isArray(classified.proof) ? classified.proof : [];
      const photos: ProofPhoto[] = proofUrls.map((url: string) => ({
        url,
        name: url.split("/").pop()?.split("?")[0] || "Proof document",
      }));
      setProofPhotos(photos);
    } catch {
      setProofPhotos([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchPhotos();
      setLoading(false);
    })();
  }, [fetchPhotos]);

  function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDate(value?: string) {
    if (!value) return "";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatDateOnly(value?: string) {
    if (!value) return "";
    const d = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  /** Days until an expiry date; negative once it has lapsed. */
  function daysUntil(value?: string) {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86_400_000);
  }

  async function uploadToCloudinary(file: File, documentType: string) {
    const folder = `agent-documents/${documentType.toLowerCase()}`;
    const sig = await api.get(`/api/uploads/cloudinary/sign?folder=${encodeURIComponent(folder)}`);
    const sigData = sig.data as CloudinarySig;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("timestamp", String(sigData.timestamp));
    fd.append("api_key", sigData.apiKey);
    fd.append("signature", sigData.signature);
    fd.append("folder", sigData.folder);
    fd.append("overwrite", "true");
    const resp = await axios.post(`https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`, fd);
    return (resp.data as { secure_url: string }).secure_url;
  }

  function startUpload(docId: string) {
    setUploadError(null);
    setUploadSuccess(null);

    if (docId === "license" && !licenseExpiresOn) {
      setUploadError("Set the Tourism License expiry date before uploading.");
      return;
    }
    if (docId === "business" && !businessExpiresOn) {
      setUploadError("Set the Business Licence expiry date before uploading.");
      return;
    }

    pendingDocId.current = docId;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleUpload(files: FileList | null) {
    const docId = pendingDocId.current;
    if (!files?.length || !docId) return;

    const file = files[0];
    if (file.type !== "application/pdf") {
      setUploadError("Only PDF documents are allowed.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Each document must be 5MB or smaller.");
      return;
    }

    const documentType = DOCUMENT_TYPE_BY_ID[docId];
    if (!documentType) {
      setUploadError("That document type is not recognised.");
      return;
    }

    try {
      setUploadingId(docId);
      setUploadError(null);
      setUploadSuccess(null);

      const url = await uploadToCloudinary(file, documentType);
      const existingClassified = operatorProfile?.classifiedPhotos ?? {};
      const existingProof = Array.isArray(existingClassified.proof) ? existingClassified.proof : [];
      const mergedClassified = {
        ...existingClassified,
        proof: [...existingProof, url],
      };
      const existingDocumentProofs = operatorProfile?.documentProofs ?? {};
      const expiryDateValue = docId === "license" ? licenseExpiresOn : docId === "business" ? businessExpiresOn : "";
      const expiresAt = expiryDateValue ? new Date(`${expiryDateValue}T23:59:59.999Z`).toISOString() : null;
      const mergedDocumentProofs = {
        ...existingDocumentProofs,
        [docId]: {
          url,
          status: "PENDING",
          uploadedAt: new Date().toISOString(),
          approvedAt: null,
          // A replacement must clear the previous decision, or a re-upload
          // after a rejection would keep showing the old rejection.
          rejectedAt: null,
          rejectionReason: null,
          ...(EXPIRING_DOCUMENTS.includes(docId as (typeof EXPIRING_DOCUMENTS)[number])
            ? { expiresOn: expiryDateValue, expiresAt }
            : null),
        },
      };

      const metadata = {
        source: "agent_documents",
        documentId: docId,
        uploadedAt: new Date().toISOString(),
        ...(expiryDateValue ? { expiresOn: expiryDateValue, expiresAt } : {}),
      };

      await api.put("/api/account/documents", { type: documentType, url, metadata });

      await api.patch("/api/agent/operator-profile", {
        ...operatorProfile,
        _preserveProfileReview: true,
        classifiedPhotos: mergedClassified,
        documentProofs: mergedDocumentProofs,
      });

      const label = REQUIRED_DOCUMENTS.find((d) => d.id === docId)?.label || docId;
      setUploadSuccess(`${label} uploaded. NoLSAF will review it shortly.`);
      setOperatorProfile((prev) => ({
        ...prev,
        classifiedPhotos: mergedClassified,
        documentProofs: mergedDocumentProofs,
      }));
      await fetchPhotos();
    } catch (err: any) {
      setUploadError(err?.response?.data?.message || "Upload failed. Please try again.");
    } finally {
      setUploadingId(null);
      pendingDocId.current = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const documents = useMemo(() => {
    return REQUIRED_DOCUMENTS.map((doc) => {
      const raw = operatorProfile?.documentProofs?.[doc.id];
      const isLegacyString = typeof raw === "string";
      const mappedUrl = isLegacyString ? raw : raw?.url;
      const status = isLegacyString ? "PENDING" : String(raw?.status || "PENDING").toUpperCase();

      // Filename matching is only a fallback for records saved before
      // documentProofs existed. It must be specific: a loose "license" test
      // matched a business licence file to the tourism licence row.
      const photoMatch = mappedUrl
        ? undefined
        : proofPhotos.find((photo) => {
            const name = (photo.name || "").toLowerCase();
            return doc.match.some((token) => name.includes(token));
          });

      const resolvedUrl = mappedUrl || photoMatch?.url;
      const expiresOn = isLegacyString ? "" : String(raw?.expiresOn || "").slice(0, 10);
      const remainingDays = daysUntil(expiresOn);

      return {
        ...doc,
        url: resolvedUrl,
        uploaded: Boolean(resolvedUrl),
        status: resolvedUrl ? status : "MISSING",
        uploadedAt: isLegacyString ? "" : formatDate(raw?.uploadedAt),
        approvedAt: isLegacyString ? "" : formatDate(raw?.approvedAt),
        rejectionReason: isLegacyString ? "" : String(raw?.rejectionReason || ""),
        expiresOn,
        remainingDays,
        expired: remainingDays != null && remainingDays < 0,
        expiringSoon: remainingDays != null && remainingDays >= 0 && remainingDays <= EXPIRY_WARNING_DAYS,
      };
    });
  }, [operatorProfile, proofPhotos]);

  const approvedCount = documents.filter((doc) => doc.status === "APPROVED").length;
  const actionCount = documents.filter((doc) => doc.status === "MISSING" || doc.status === "REJECTED" || doc.expired).length;
  const progressPercent = Math.round((approvedCount / REQUIRED_DOCUMENTS.length) * 100);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full pb-10">
      <Link
        href="/account/agent"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 no-underline transition hover:text-emerald-700"
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to dashboard
      </Link>

      <header className="mb-4">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Verification</p>
        <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">My documents</h1>
        <p className="m-0 mt-1 max-w-2xl text-sm text-neutral-500">
          Registration and licensing documents required of Tanzanian tour operators. Every file is reviewed by NoLSAF
          before it counts toward your verification.
        </p>
      </header>

      {/* Verification progress: the page's headline answer, which the old
          checklist made you count by eye. */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Verification progress</h2>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">
                {actionCount > 0
                  ? `${actionCount} document${actionCount === 1 ? "" : "s"} need your attention`
                  : approvedCount === REQUIRED_DOCUMENTS.length
                    ? "Every required document is approved"
                    : "All documents submitted and awaiting review"}
              </p>
            </div>
          </div>
          <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">
            {approvedCount} of {REQUIRED_DOCUMENTS.length} approved <span className="text-neutral-400">·</span> {progressPercent}%
          </p>
        </div>
        <div className="flex h-2 w-full gap-1 px-5 pb-4">
          {documents.map((doc) => (
            <span
              key={doc.id}
              title={`${doc.label}: ${doc.status.toLowerCase()}`}
              className={`h-full flex-1 rounded-full ${
                doc.status === "APPROVED"
                  ? "bg-emerald-600"
                  : doc.status === "REJECTED" || doc.expired
                    ? "bg-red-400"
                    : doc.uploaded
                      ? "bg-amber-400"
                      : "bg-neutral-200"
              }`}
            />
          ))}
        </div>
      </section>

      {uploadError ? (
        <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{uploadError}</span>
        </div>
      ) : null}
      {uploadSuccess ? (
        <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{uploadSuccess}</span>
        </div>
      ) : null}

      <input
        id="doc-upload"
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={(event) => void handleUpload(event.target.files)}
        className="hidden"
      />

      {/* A register of five records sharing the same five attributes, so it is
          laid out as one: comparing status or expiry across documents was the
          whole point, and stacked cards made that a scan down the page. */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Document register</h2>
            <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">
              Reviewed by NoLSAF compliance. PDF only, up to 5MB each.
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">
            {REQUIRED_DOCUMENTS.length} required
          </span>
        </header>

        <TableScroller label="document register">
          <table className="w-full min-w-[58rem] border-collapse text-left">
            <thead className="bg-neutral-50/90 [&>tr>th]:shadow-[inset_0_-1px_0_0_#e5e5e5]">
              <tr>
                <th scope="col" className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Document</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Status</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Submitted</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Validity</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">File</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Action</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>tr:last-child>td]:shadow-none">
              {documents.map((doc) => {
                const busy = uploadingId === doc.id;
                const needsExpiry = EXPIRING_DOCUMENTS.includes(doc.id as (typeof EXPIRING_DOCUMENTS)[number]);
                const expiryValue = doc.id === "license" ? licenseExpiresOn : businessExpiresOn;
                const flagged = doc.status === "REJECTED" || doc.expired;

                const statusChip =
                  doc.status === "APPROVED"
                    ? { tone: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Approved", Icon: CheckCircle2 }
                    : doc.status === "REJECTED"
                      ? { tone: "border-red-200 bg-red-50 text-red-700", label: "Rejected", Icon: XCircle }
                      : doc.uploaded
                        ? { tone: "border-amber-200 bg-amber-50 text-amber-700", label: "In review", Icon: CalendarClock }
                        : { tone: "border-neutral-200 bg-neutral-50 text-neutral-500", label: "Not uploaded", Icon: AlertCircle };
                const ChipIcon = statusChip.Icon;

                return (
                  <tr key={doc.id} className={`align-top transition ${flagged ? "bg-red-50/40" : "hover:bg-emerald-50/30"}`}>
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                            doc.status === "APPROVED"
                              ? "bg-emerald-50 text-emerald-600"
                              : flagged
                                ? "bg-red-50 text-red-600"
                                : doc.uploaded
                                  ? "bg-amber-50 text-amber-600"
                                  : "bg-neutral-100 text-neutral-400"
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 text-[13px] font-bold text-neutral-900">{doc.label}</p>
                          <p className="m-0 mt-0.5 text-[11px] leading-4 text-neutral-500">{doc.description}</p>
                          {doc.status === "REJECTED" ? (
                            <p className="m-0 mt-1.5 text-[11px] font-semibold leading-4 text-red-700">
                              {doc.rejectionReason || "Not accepted. Upload a corrected copy."}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${statusChip.tone}`}>
                        <ChipIcon className="h-3 w-3" aria-hidden />
                        {statusChip.label}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-[11px] text-neutral-500">
                      {doc.status === "APPROVED" && doc.approvedAt ? (
                        <>
                          <span className="block font-semibold text-neutral-700">{doc.approvedAt}</span>
                          <span className="block text-[10px] text-neutral-400">approved</span>
                        </>
                      ) : doc.uploadedAt ? (
                        <>
                          <span className="block font-semibold text-neutral-700">{doc.uploadedAt}</span>
                          <span className="block text-[10px] text-neutral-400">uploaded</span>
                        </>
                      ) : (
                        <span className="text-neutral-300">--</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      {needsExpiry ? (
                        <div className="w-[9.5rem] min-w-0">
                          <DatePickerField
                            label={doc.id === "license" ? "Tourism License expiry date" : "Business Licence expiry date"}
                            value={expiryValue}
                            onChangeAction={(iso) => {
                              if (doc.id === "license") setLicenseExpiresOn(String(iso));
                              else setBusinessExpiresOn(String(iso));
                            }}
                            min={todayIsoDate()}
                            widthClassName="!w-full"
                            size="sm"
                            allowPast={false}
                            twoMonths={false}
                          />
                          {doc.expiresOn ? (
                            <span
                              className={`mt-1 block text-[10px] font-semibold ${
                                doc.expired ? "text-red-600" : doc.expiringSoon ? "text-amber-600" : "text-neutral-400"
                              }`}
                            >
                              {doc.expired
                                ? `Expired ${formatDateOnly(doc.expiresOn)}`
                                : doc.expiringSoon
                                  ? `${doc.remainingDays} days left`
                                  : `Valid to ${formatDateOnly(doc.expiresOn)}`}
                            </span>
                          ) : (
                            <span className="mt-1 block text-[10px] font-semibold text-amber-600">Required before upload</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-neutral-300">No expiry</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5">
                      {doc.url ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 no-underline transition hover:text-emerald-800 hover:no-underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden /> View
                        </a>
                      ) : (
                        <span className="text-[11px] text-neutral-300">--</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => startUpload(doc.id)}
                        disabled={Boolean(uploadingId)}
                        className={`inline-flex min-h-8 cursor-pointer appearance-none items-center gap-1.5 rounded-lg border border-solid px-2.5 text-[11px] font-bold outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          doc.uploaded
                            ? "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200 hover:text-emerald-700"
                            : "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                        }`}
                      >
                        {busy ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : doc.uploaded ? (
                          <RefreshCw className="h-3 w-3" aria-hidden />
                        ) : (
                          <Upload className="h-3 w-3" aria-hidden />
                        )}
                        {busy ? "Uploading" : doc.uploaded ? "Replace" : "Upload"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </div>
  );
}
