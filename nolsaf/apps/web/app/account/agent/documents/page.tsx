"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertCircle,
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
  // Licences being renewed: their expiry picker is open for the new date.
  const [renewing, setRenewing] = useState<string[]>([]);
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
      timeZone: "Africa/Dar_es_Salaam",
    }) + " EAT";
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
      setRenewing((ids) => ids.filter((id) => id !== docId));
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

  const approvedCount = documents.filter((doc) => doc.status === "APPROVED" && !doc.expired).length;
  const reviewCount = documents.filter((doc) => doc.uploaded && doc.status !== "APPROVED" && doc.status !== "REJECTED").length;
  const actionCount = documents.filter((doc) => doc.status === "MISSING" || doc.status === "REJECTED" || doc.expired).length;
  const expiringCount = documents.filter((doc) => doc.expiringSoon && !doc.expired).length;
  const total = REQUIRED_DOCUMENTS.length;
  const progressPercent = Math.round((approvedCount / total) * 100);
  const verified = approvedCount === total;

  const standing = verified
    ? expiringCount
      ? { label: "Verified, renewal due", tone: "border-amber-200 bg-amber-50 text-amber-800", Icon: CalendarClock, line: `${expiringCount} licence${expiringCount === 1 ? "" : "s"} expire within ${EXPIRY_WARNING_DAYS} days. Upload the renewed copy before then to stay verified.` }
      : { label: "Verified", tone: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: ShieldCheck, line: "Every required document is approved." }
    : actionCount
      ? { label: "Action needed", tone: "border-red-200 bg-red-50 text-red-700", Icon: AlertCircle, line: `${actionCount} document${actionCount === 1 ? " needs" : "s need"} you: upload what is missing and replace anything rejected or expired.` }
      : { label: "In review", tone: "border-amber-200 bg-amber-50 text-amber-800", Icon: CalendarClock, line: "Everything is uploaded. NoLSAF compliance is reviewing your files." };
  const StandingIcon = standing.Icon;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  return (
    <div id="agent-documents" className="w-full min-w-0 space-y-4 pb-10">
      <style>{`#agent-documents, #agent-documents * { box-sizing: border-box; }`}</style>

      {/* Standing: the one answer this page exists for, then how each file stands. */}
      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-lg font-semibold text-neutral-900">My documents</h1>
                <span className={`inline-flex items-center gap-1 rounded-md border border-solid px-2 py-0.5 text-[11px] font-semibold ${standing.tone}`}>
                  <StandingIcon className="h-3.5 w-3.5" aria-hidden />
                  {standing.label}
                </span>
              </div>
              <p className="m-0 mt-1 max-w-2xl text-[13px] leading-5 text-neutral-600">{standing.line}</p>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="m-0 text-2xl font-semibold tabular-nums text-neutral-900">
              {approvedCount}<span className="text-base text-neutral-400">/{total}</span>
            </p>
            <p className="m-0 text-[12px] text-neutral-500">approved, {progressPercent}%</p>
          </div>
        </div>

        {/* One segment per document, named, so the bar says which file is holding things up. */}
        <ol className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-3 border-0 border-t border-solid border-neutral-100 px-4 py-3.5 sm:grid-cols-5 sm:px-5">
          {documents.map((doc) => {
            const tone =
              doc.status === "APPROVED" && !doc.expired
                ? doc.expiringSoon ? "bg-amber-400" : "bg-emerald-600"
                : doc.status === "REJECTED" || doc.expired
                  ? "bg-red-500"
                  : doc.uploaded
                    ? "bg-amber-300"
                    : "bg-neutral-200";
            const caption =
              doc.expired ? "Expired"
                : doc.status === "APPROVED" ? (doc.expiringSoon ? `${doc.remainingDays} days left` : "Approved")
                  : doc.status === "REJECTED" ? "Rejected"
                    : doc.uploaded ? "In review" : "Missing";
            return (
              <li key={doc.id} className="min-w-0">
                <span className={`block h-1.5 w-full rounded-full ${tone}`} aria-hidden />
                <p className="m-0 mt-1.5 truncate text-[12px] font-semibold text-neutral-800">{doc.label}</p>
                <p className="m-0 text-[11px] text-neutral-500">{caption}</p>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-2.5 text-[12px] text-neutral-600 sm:px-5">
          <span><strong className="font-semibold tabular-nums text-neutral-900">{approvedCount}</strong> approved</span>
          <span><strong className="font-semibold tabular-nums text-neutral-900">{reviewCount}</strong> in review</span>
          <span><strong className={`font-semibold tabular-nums ${actionCount ? "text-red-700" : "text-neutral-900"}`}>{actionCount}</strong> need you</span>
          <span><strong className={`font-semibold tabular-nums ${expiringCount ? "text-amber-700" : "text-neutral-900"}`}>{expiringCount}</strong> expiring soon</span>
        </div>
      </section>

      {uploadError ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{uploadError}</span>
        </div>
      ) : null}
      {uploadSuccess ? (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
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

      {/* A register: five records with the same attributes, compared across rows. */}
      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-semibold text-neutral-900">Document register</h2>
            <p className="m-0 mt-0.5 text-[12px] text-neutral-500">
              Required of every Tanzanian tour operator and checked by NoLSAF compliance. PDF only, up to 5MB each.
            </p>
          </div>
          <span className="rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-semibold text-neutral-600">{total} required</span>
        </header>

        <TableScroller label="document register">
          <table className="w-full min-w-[56rem] border-collapse text-left">
            <thead className="bg-neutral-50/80">
              <tr className="[&>th]:border-0 [&>th]:border-b [&>th]:border-solid [&>th]:border-neutral-200 [&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:text-neutral-500">
                <th scope="col">Document</th>
                <th scope="col" className="whitespace-nowrap">Status</th>
                <th scope="col" className="whitespace-nowrap">Last change</th>
                <th scope="col" className="whitespace-nowrap">Validity</th>
                <th scope="col" className="whitespace-nowrap text-right">File</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const busy = uploadingId === doc.id;
                const needsExpiry = EXPIRING_DOCUMENTS.includes(doc.id as (typeof EXPIRING_DOCUMENTS)[number]);
                const expiryValue = doc.id === "license" ? licenseExpiresOn : businessExpiresOn;
                const flagged = doc.status === "REJECTED" || doc.expired;
                // The date picker is for a new file: shown when one is due, or when renewing.
                const showPicker = needsExpiry && (!doc.uploaded || flagged || doc.expiringSoon || renewing.includes(doc.id));

                const statusChip =
                  doc.expired
                    ? { tone: "border-red-200 bg-red-50 text-red-700", label: "Expired", Icon: XCircle }
                    : doc.status === "APPROVED"
                      ? { tone: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "Approved", Icon: CheckCircle2 }
                      : doc.status === "REJECTED"
                        ? { tone: "border-red-200 bg-red-50 text-red-700", label: "Rejected", Icon: XCircle }
                        : doc.uploaded
                          ? { tone: "border-amber-200 bg-amber-50 text-amber-800", label: "In review", Icon: CalendarClock }
                          : { tone: "border-neutral-200 bg-neutral-50 text-neutral-600", label: "Missing", Icon: AlertCircle };
                const ChipIcon = statusChip.Icon;
                const primary = !doc.uploaded || flagged;

                return (
                  <tr
                    key={doc.id}
                    className={`align-top transition [&>td]:border-0 [&>td]:border-b [&>td]:border-solid [&>td]:border-neutral-100 [&>td]:px-4 [&>td]:py-3.5 last:[&>td]:border-b-0 ${flagged ? "bg-red-50/40" : "hover:bg-neutral-50/70"}`}
                  >
                    <td>
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${
                            doc.status === "APPROVED" && !doc.expired
                              ? "bg-emerald-50 text-emerald-700"
                              : flagged
                                ? "bg-red-50 text-red-600"
                                : doc.uploaded
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-neutral-100 text-neutral-400"
                          }`}
                        >
                          <FileText className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 text-[13px] font-semibold text-neutral-900">{doc.label}</p>
                          <p className="m-0 mt-0.5 text-[12px] leading-4 text-neutral-500">{doc.description}</p>
                          {doc.status === "REJECTED" ? (
                            <p className="m-0 mt-2 rounded-md bg-white px-2.5 py-1.5 text-[12px] leading-4 text-red-700 ring-1 ring-red-100">
                              <span className="font-semibold">NoLSAF: </span>
                              {doc.rejectionReason || "Not accepted. Upload a corrected copy."}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 rounded-md border border-solid px-2 py-0.5 text-[11px] font-semibold ${statusChip.tone}`}>
                        <ChipIcon className="h-3.5 w-3.5" aria-hidden />
                        {statusChip.label}
                      </span>
                    </td>

                    <td className="text-[12px] text-neutral-500">
                      {doc.status === "APPROVED" && doc.approvedAt ? (
                        <>
                          <span className="block font-medium text-neutral-800">{doc.approvedAt}</span>
                          <span className="block text-[11px] text-neutral-400">Approved</span>
                        </>
                      ) : doc.uploadedAt ? (
                        <>
                          <span className="block font-medium text-neutral-800">{doc.uploadedAt}</span>
                          <span className="block text-[11px] text-neutral-400">Uploaded</span>
                        </>
                      ) : (
                        <span className="text-neutral-400">Not uploaded</span>
                      )}
                    </td>

                    <td>
                      {!needsExpiry ? (
                        <span className="text-[12px] text-neutral-400">Does not expire</span>
                      ) : (
                        <div className="w-[10rem] min-w-0">
                          {doc.expiresOn ? (
                            <span
                              className={`block text-[12px] font-medium ${
                                doc.expired ? "text-red-700" : doc.expiringSoon ? "text-amber-700" : "text-neutral-800"
                              }`}
                            >
                              {doc.expired
                                ? `Expired ${formatDateOnly(doc.expiresOn)}`
                                : `Valid to ${formatDateOnly(doc.expiresOn)}`}
                            </span>
                          ) : null}
                          {doc.expiringSoon && !doc.expired ? (
                            <span className="block text-[11px] text-amber-700">{doc.remainingDays} days left</span>
                          ) : null}
                          {showPicker ? (
                            <div className="mt-1.5">
                              <DatePickerField
                                label={doc.uploaded ? "New expiry date" : doc.id === "license" ? "Tourism License expiry date" : "Business Licence expiry date"}
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
                              {!doc.uploaded && !expiryValue ? (
                                <span className="mt-1 block text-[11px] text-amber-700">Set this before uploading</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>

                    <td className="whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 no-underline transition hover:border-[#02665e]/40 hover:text-[#02665e] hover:no-underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> View
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            // Renewing a licence starts with its new expiry date.
                            if (needsExpiry && doc.uploaded && !showPicker) {
                              setRenewing((ids) => [...ids, doc.id]);
                              if (doc.id === "license") setLicenseExpiresOn("");
                              else setBusinessExpiresOn("");
                              setUploadError(null);
                              setUploadSuccess(`Set the new expiry date for your ${doc.label}, then choose the file.`);
                              return;
                            }
                            startUpload(doc.id);
                          }}
                          disabled={Boolean(uploadingId)}
                          className={`inline-flex h-8 cursor-pointer appearance-none items-center gap-1.5 rounded-md border border-solid px-2.5 text-[12px] font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            primary
                              ? "border-[#02665e] bg-[#02665e] text-white hover:bg-[#014e47]"
                              : "border-neutral-200 bg-white text-neutral-700 hover:border-[#02665e]/40 hover:text-[#02665e]"
                          }`}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : doc.uploaded ? (
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Upload className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {busy ? "Uploading" : !doc.uploaded ? "Upload" : flagged ? "Upload new copy" : needsExpiry && doc.expiringSoon ? "Renew" : "Replace"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>

        <p className="m-0 flex items-start gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-2.5 text-[12px] leading-5 text-neutral-500 sm:px-5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
          A new file replaces the old one and goes back into review, so upload a renewed licence only once you have it.
        </p>
      </section>
    </div>
  );
}
