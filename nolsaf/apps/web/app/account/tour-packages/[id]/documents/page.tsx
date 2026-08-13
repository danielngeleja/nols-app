"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowLeft, CheckCircle2, Clock3, Eye, FileText, Loader2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

function displayText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return fallback;
}

type CloudinarySig = {
  timestamp: number;
  signature: string;
  folder: string;
  cloudName: string;
  apiKey: string;
  maxFileSize?: number | null;
};

type RequiredDoc = {
  type: string;
  label: string;
  description: string;
  accept: string;
  required: boolean;
};

const ALLOWED_ACCEPT = "application/pdf,image/jpeg,image/png";
const PASSPORT_PHOTO_ACCEPT = "image/jpeg,image/png";
const PASSPORT_TARGET_WIDTH = 700;
const PASSPORT_TARGET_HEIGHT = 900;

function getAcceptByType(type: string): string {
  return type === "PASSPORT_SIZE_PHOTO" ? PASSPORT_PHOTO_ACCEPT : ALLOWED_ACCEPT;
}

function toAcceptedText(accept: string): string {
  const tokens = String(accept || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const labels: string[] = [];
  if (tokens.includes("application/pdf")) labels.push("PDF");
  if (tokens.includes("image/jpeg")) labels.push("JPG");
  if (tokens.includes("image/png")) labels.push("PNG");
  return labels.join(", ");
}

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load selected image."));
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Could not prepare passport photo."));
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function normalizePassportImage(file: File): Promise<{ processedFile: File; previewUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    const targetRatio = PASSPORT_TARGET_WIDTH / PASSPORT_TARGET_HEIGHT;
    const sourceRatio = srcW / srcH;

    let cropW = srcW;
    let cropH = srcH;
    let cropX = 0;
    let cropY = 0;

    if (sourceRatio > targetRatio) {
      cropW = Math.floor(srcH * targetRatio);
      cropX = Math.floor((srcW - cropW) / 2);
    } else if (sourceRatio < targetRatio) {
      cropH = Math.floor(srcW / targetRatio);
      cropY = Math.floor((srcH - cropH) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = PASSPORT_TARGET_WIDTH;
    canvas.height = PASSPORT_TARGET_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare image canvas.");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      cropX,
      cropY,
      cropW,
      cropH,
      0,
      0,
      PASSPORT_TARGET_WIDTH,
      PASSPORT_TARGET_HEIGHT,
    );

    let quality = 0.92;
    let blob = await canvasToJpegBlob(canvas, quality);
    while (blob.size > 2 * 1024 * 1024 && quality > 0.6) {
      quality -= 0.08;
      blob = await canvasToJpegBlob(canvas, quality);
    }

    if (blob.size > 2 * 1024 * 1024) {
      throw new Error("Passport photo remains above 2MB after resize. Please use a smaller image.");
    }

    const processedFile = new File([blob], file.name.replace(/\.[^.]+$/, "") + "-passport.jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(blob);
    return { processedFile, previewUrl };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const DEFAULT_REQUIRED_DOCS: RequiredDoc[] = [
  {
    type: "PASSPORT_SIZE_PHOTO",
    label: "Passport Size Photo",
    description: "Clear recent passport-size image for park permit and related entry processing.",
    accept: PASSPORT_PHOTO_ACCEPT,
    required: true,
  },
  {
    type: "TRAVEL_PASSPORT",
    label: "Travel Passport",
    description: "Passport biodata page (image or PDF).",
    accept: ALLOWED_ACCEPT,
    required: true,
  },
  {
    type: "VISA_DOCUMENT",
    label: "Visa Document",
    description: "Visa approval page when the destination requires one.",
    accept: ALLOWED_ACCEPT,
    required: false,
  },
  {
    type: "YELLOW_FEVER_CERTIFICATE",
    label: "Yellow Fever Certificate",
    description: "Yellow fever vaccination proof for destinations that require it.",
    accept: ALLOWED_ACCEPT,
    required: false,
  },
  {
    type: "VACCINATION_CARD",
    label: "Vaccination Card",
    description: "General immunization card or travel vaccination booklet.",
    accept: ALLOWED_ACCEPT,
    required: false,
  },
  {
    type: "MEDICAL_CLEARANCE",
    label: "Medical Clearance",
    description: "Medical letter or fitness note when needed for package activities.",
    accept: ALLOWED_ACCEPT,
    required: false,
  },
  {
    type: "SUPPORTING_DOCUMENT",
    label: "Other Supporting Documents",
    description: "Any other requested file from your tour operator.",
    accept: ALLOWED_ACCEPT,
    required: false,
  },
];

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ")
    .trim();
}

function normalizeRequiredDocs(raw: any): RequiredDoc[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const mapped: RequiredDoc[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const type = entry.toUpperCase().replace(/\s+/g, "_").trim();
      if (!type) continue;
      mapped.push({
        type,
        label: toTitleCase(type),
        description: "Required for this package processing flow.",
        accept: getAcceptByType(type),
        required: true,
      });
      continue;
    }

    if (!entry || typeof entry !== "object") continue;
    const typeRaw = String(entry.type || entry.key || entry.code || entry.name || "")
      .toUpperCase()
      .replace(/\s+/g, "_")
      .trim();
    if (!typeRaw) continue;

    mapped.push({
      type: typeRaw,
      label: String(entry.label || entry.title || toTitleCase(typeRaw)).trim(),
      description: String(
        entry.description ||
          entry.helpText ||
          entry.note ||
          "Required for this package processing flow."
      ).trim(),
      accept: getAcceptByType(typeRaw),
      required: entry.required !== false,
    });
  }

  return mapped;
}

function inferHealthRequiredDocs(metadata: any): RequiredDoc[] {
  const values = [
    metadata?.healthRequirements,
    metadata?.medicalRequirements,
    metadata?.vaccinationRequirements,
    metadata?.entryRequirements,
    metadata?.travelRequirements,
  ];

  const bag = values
    .flatMap((value) => {
      if (Array.isArray(value)) return value.map((v) => String(v || ""));
      return [String(value || "")];
    })
    .join(" ")
    .toLowerCase();

  if (!bag.trim()) return [];

  const inferred: RequiredDoc[] = [];

  if (bag.includes("yellow fever") || bag.includes("yellow-fever")) {
    inferred.push({
      type: "YELLOW_FEVER_CERTIFICATE",
      label: "Yellow Fever Certificate",
      description: "Required by destination health controls before entry.",
      accept: getAcceptByType("YELLOW_FEVER_CERTIFICATE"),
      required: true,
    });
  }

  if (bag.includes("vaccin") || bag.includes("immunization") || bag.includes("immunisation")) {
    inferred.push({
      type: "VACCINATION_CARD",
      label: "Vaccination Card",
      description: "Required vaccination or immunization proof for this itinerary.",
      accept: getAcceptByType("VACCINATION_CARD"),
      required: true,
    });
  }

  if (bag.includes("medical") || bag.includes("fitness") || bag.includes("clearance")) {
    inferred.push({
      type: "MEDICAL_CLEARANCE",
      label: "Medical Clearance",
      description: "Medical clearance is required for one or more booked activities.",
      accept: getAcceptByType("MEDICAL_CLEARANCE"),
      required: true,
    });
  }

  return inferred;
}

export default function TourPackageDocumentsPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const bookingId = String(params?.id || "");
  const requestedEvidenceCaseId = Number(searchParams.get("caseId"));
  const isCancellationEvidenceUpload = Number.isInteger(requestedEvidenceCaseId) && requestedEvidenceCaseId > 0;

  const [loading, setLoading] = useState(true);
  const [savingForType, setSavingForType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [bookingCode, setBookingCode] = useState<string>("");
  const [packageTitle, setPackageTitle] = useState<string>("");
  const [requiredDocs, setRequiredDocs] = useState<RequiredDoc[]>(DEFAULT_REQUIRED_DOCS);
  const [uploadedByType, setUploadedByType] = useState<Record<string, { url: string; uploadedAt: string }>>({});
  const [fileInputAccept, setFileInputAccept] = useState<string>(`.pdf,.jpg,.jpeg,.png,${ALLOWED_ACCEPT}`);
  const [localPreviewByType, setLocalPreviewByType] = useState<Record<string, string>>({});
  const localPreviewByTypeRef = useRef<Record<string, string>>({});

  const pendingUploadTypeRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      for (const url of Object.values(localPreviewByTypeRef.current)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [bookingRes, meRes] = await Promise.all([
          api.get(`/api/customer/tour-bookings/${encodeURIComponent(bookingId)}`),
          api.get("/api/account/me").catch(() => null),
        ]);

        if (!alive) return;

        const booking = bookingRes?.data || {};
        const metadata = booking?.metadata && typeof booking.metadata === "object" ? booking.metadata : {};
        const packageSnapshot = booking?.packageSnapshot && typeof booking.packageSnapshot === "object" ? booking.packageSnapshot : {};

        setBookingCode(String(booking?.bookingCode || ""));
        setPackageTitle(String(booking?.title || "Tour Package"));

        const requiredFromPayload = normalizeRequiredDocs(
          packageSnapshot?.requiredDocuments ||
            packageSnapshot?.requiredDocs ||
            packageSnapshot?.documentsRequired ||
            metadata?.requiredDocuments ||
            metadata?.requiredDocs ||
            metadata?.documentsRequired ||
            metadata?.processingDocuments ||
            metadata?.travelerRequiredDocuments
        );

        const inferredHealthDocs = inferHealthRequiredDocs(metadata);

        if (requiredFromPayload.length > 0 || inferredHealthDocs.length > 0) {
          const merged = [...requiredFromPayload];
          for (const inferred of inferredHealthDocs) {
            const existingIndex = merged.findIndex((d) => d.type === inferred.type);
            if (existingIndex >= 0) {
              merged[existingIndex] = {
                ...merged[existingIndex],
                required: merged[existingIndex].required || inferred.required,
              };
            } else {
              merged.push(inferred);
            }
          }
          for (const fallback of DEFAULT_REQUIRED_DOCS) {
            if (!merged.some((d) => d.type === fallback.type)) merged.push(fallback);
          }
          setRequiredDocs(merged);
        }

        const meData = (meRes as any)?.data?.data ?? (meRes as any)?.data ?? {};
        const docs = Array.isArray(meData?.documents) ? meData.documents : [];
        const nextUploaded: Record<string, { url: string; uploadedAt: string }> = {};

        for (const d of docs) {
          const type = String(d?.type || "").toUpperCase().trim();
          const url = String(d?.url || "").trim();
          if (!type || !url) continue;
          nextUploaded[type] = {
            url,
            uploadedAt: String(d?.createdAt || d?.updatedAt || ""),
          };
        }

        if (Object.keys(nextUploaded).length > 0) {
          setUploadedByType(nextUploaded);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(displayText(err?.response?.data?.error, "Failed to load required documents."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bookingId]);

  const completion = useMemo(() => {
    const requiredOnly = requiredDocs.filter((d) => d.required);
    if (requiredOnly.length === 0) return { uploaded: 0, total: 0 };
    const uploaded = requiredOnly.filter((d) => Boolean(uploadedByType[d.type]?.url)).length;
    return { uploaded, total: requiredOnly.length };
  }, [requiredDocs, uploadedByType]);

  const orderedDocs = useMemo(() => {
    return [...requiredDocs].sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [requiredDocs]);

  const completionPercent = completion.total > 0
    ? Math.round((completion.uploaded / completion.total) * 100)
    : 0;

  const openPicker = (type: string) => {
    pendingUploadTypeRef.current = type;
    const doc = requiredDocs.find((d) => d.type === type);
    const accept = doc?.accept || getAcceptByType(type);
    const baseExt = accept.includes("application/pdf")
      ? ".pdf,.jpg,.jpeg,.png"
      : ".jpg,.jpeg,.png";
    setFileInputAccept(`${baseExt},${accept}`);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const uploadToCloudinary = async (file: File) => {
    const sig = await api.get("/api/uploads/cloudinary/sign?folder=uploads&maxBytes=2097152");
    const s = sig.data as CloudinarySig;

    const fd = new FormData();
    fd.append("file", file);
    fd.append("timestamp", String(s.timestamp));
    fd.append("api_key", s.apiKey);
    fd.append("signature", s.signature);
    fd.append("folder", s.folder);
    fd.append("overwrite", "true");
    const resp = await axios.post(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, fd);
    return (resp.data as { secure_url: string }).secure_url;
  };

  const handleFilePicked = async (files: FileList | null) => {
    const type = pendingUploadTypeRef.current;
    pendingUploadTypeRef.current = null;

    if (!type || !files?.length) return;

    const docSpec = requiredDocs.find((d) => d.type === type);
    if (!docSpec) return;

    const file = files[0];
    const acceptedMime = new Set(
      String(docSpec.accept || "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    );

    if (!acceptedMime.has(String(file.type || "").toLowerCase())) {
      setError(
        docSpec.type === "PASSPORT_SIZE_PHOTO"
          ? "Passport size photo allows only JPG and PNG files."
          : "Only PDF, JPG, and PNG files are allowed."
      );
      return;
    }

    const isPassportPhoto = docSpec.type === "PASSPORT_SIZE_PHOTO";

    if (!isPassportPhoto && file.size > 2 * 1024 * 1024) {
      setError("File too large. Maximum allowed size is 2MB.");
      return;
    }

    if (isPassportPhoto && file.size > 10 * 1024 * 1024) {
      setError("Passport photo source file is too large. Please choose a file under 10MB.");
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      setSavingForType(type);

      let fileToUpload = file;
      if (isPassportPhoto) {
        const { processedFile, previewUrl } = await normalizePassportImage(file);
        setLocalPreviewByType((prev) => {
          const previous = prev[type];
          if (previous) {
            try {
              URL.revokeObjectURL(previous);
            } catch {
              // ignore
            }
          }
          const next = {
            ...prev,
            [type]: previewUrl,
          };
          localPreviewByTypeRef.current = next;
          return next;
        });
        fileToUpload = processedFile;
      }

      const url = await uploadToCloudinary(fileToUpload);
      const uploadedAt = new Date().toISOString();

      await api.put("/api/account/documents", {
        type,
        url,
        metadata: {
          source: "tour_package_documents",
          bookingId,
          bookingCode,
          packageTitle,
          documentLabel: docSpec.label,
          uploadedAt,
          fileName: fileToUpload.name,
          contentType: fileToUpload.type,
          size: fileToUpload.size,
          ...(isCancellationEvidenceUpload ? { cancellationCaseId: requestedEvidenceCaseId, source: "tour_cancellation_evidence" } : null),
          ...(isPassportPhoto
            ? {
                adjustedToDimension: `${PASSPORT_TARGET_WIDTH}x${PASSPORT_TARGET_HEIGHT}`,
                imageResizeStrategy: "center-crop-resize",
              }
            : null),
        },
      });

      if (isCancellationEvidenceUpload) {
        await api.post(`/api/customer/tour-bookings/${encodeURIComponent(bookingId)}/cases/${requestedEvidenceCaseId}/evidence`, {
          documents: [{
            url,
            fileName: fileToUpload.name,
            type,
            label: docSpec.label,
            uploadedAt,
          }],
        });
      }

      setUploadedByType((prev) => ({
        ...prev,
        [type]: { url, uploadedAt },
      }));
      setSuccess(
        isPassportPhoto
          ? `${docSpec.label} uploaded and adjusted to ${PASSPORT_TARGET_WIDTH}x${PASSPORT_TARGET_HEIGHT}${isCancellationEvidenceUpload ? ". It was attached to your cancellation case." : "."}`
          : `${docSpec.label} uploaded successfully${isCancellationEvidenceUpload ? " and attached to your cancellation case." : "."}`
      );
    } catch (err: any) {
      setError(displayText(err?.response?.data?.error || err?.response?.data?.message, "Upload failed. Please try again."));
    } finally {
      setSavingForType(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 space-y-4 min-w-0 overflow-x-hidden">
      <div className="relative rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <Link
          href={`/account/tour-packages/${encodeURIComponent(bookingId)}`}
          aria-label="Back to tour package"
          title="Back to tour package"
          className="absolute left-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="mx-auto max-w-3xl px-10 sm:px-12 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Package Documents</h1>
          <div className="mt-1 text-sm leading-relaxed text-slate-600">Upload and manage required files for booking verification and travel-clearance processing.</div>
        </div>
      </div>

      {isCancellationEvidenceUpload && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Cancellation evidence requested.</span> Files uploaded here are attached directly to cancellation case #{requestedEvidenceCaseId} for the NoLSAF review team.
        </div>
      )}

        <section className="w-full max-w-full min-w-0 card overflow-hidden">
          <div className="card-section space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading required documents...
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-white via-white to-teal-50 p-5 md:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-4 md:gap-6 items-stretch">
                    <div className="text-center md:text-left">
                      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-teal-700 font-semibold">
                        <Sparkles className="h-3.5 w-3.5" />
                        Upload Documents
                      </div>
                      <h1 className="mt-1 text-xl md:text-3xl font-bold text-slate-900 break-words">
                        {packageTitle || "Tour Package Documents"}
                      </h1>
                      <div className="text-sm text-slate-600 mt-1 break-all">Ref: {bookingCode || bookingId}</div>
                      <p className="mt-3 text-sm text-slate-700 leading-relaxed max-w-2xl mx-auto md:mx-0">
                        Upload the required documents for this package (passport, visa, yellow fever, and related files).
                      </p>
                      <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-2xl mx-auto md:mx-0">
                        Files are linked to your booking for permit and travel-clearance processing.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-teal-200 bg-white/90 p-4 flex flex-col justify-between">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-800">
                        <ShieldCheck className="h-4 w-4" />
                        Document Progress
                      </div>
                      <div className="mt-3">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all"
                            style={{ width: `${completionPercent}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-slate-600">Required uploaded</span>
                        <span className="font-semibold text-slate-900">{completion.uploaded}/{completion.total}</span>
                      </div>
                      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        Complete required uploads to speed up verification
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {success}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Required And Supporting Files</div>
                      <div className="text-xs text-slate-500 mt-0.5">Required documents are prioritized first.</div>
                    </div>
                    <div className="text-xs text-slate-600 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      {orderedDocs.length} document type{orderedDocs.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {orderedDocs.map((doc) => {
                    const uploaded = uploadedByType[doc.type];
                    const isUploading = savingForType === doc.type;
                    return (
                      <div key={doc.type} className="rounded-2xl border border-slate-200 bg-white p-4 min-w-0 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 break-words">
                              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700 border border-teal-100 shrink-0">
                                <FileText className="h-4 w-4" />
                              </span>
                              {doc.label}
                              {doc.required ? <span className="text-rose-600 text-base leading-none">*</span> : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-600 leading-relaxed">{doc.description}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                              Accepted: {toAcceptedText(doc.accept)}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">Max: 2MB</span>
                            {doc.type === "PASSPORT_SIZE_PHOTO" ? (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] text-sky-700">
                                {PASSPORT_TARGET_WIDTH}x{PASSPORT_TARGET_HEIGHT}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {doc.type === "PASSPORT_SIZE_PHOTO" && localPreviewByType[doc.type] && (
                          <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5">
                            <div className="flex items-center gap-3">
                              <img
                                src={localPreviewByType[doc.type]}
                                alt="Adjusted passport-size preview"
                                className="h-20 w-16 object-cover rounded-md border border-sky-200"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-sky-700">Adjusted preview</div>
                                <div className="text-[11px] text-sky-600 mt-0.5">Auto-cropped to fit passport dimensions.</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {uploaded?.url ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            <div className="inline-flex items-center gap-1 font-semibold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Uploaded
                            </div>
                            <div className="mt-1 break-words text-[11px] text-emerald-800">
                              <a
                                href={uploaded.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="View uploaded file"
                                title="View uploaded file"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100"
                              >
                                <Eye className="h-4 w-4" />
                              </a>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            Waiting for upload.
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={Boolean(savingForType)}
                          onClick={() => openPicker(doc.type)}
                          className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all w-full md:w-auto ${
                            Boolean(savingForType)
                              ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                              : "bg-teal-600 text-white hover:bg-teal-700 shadow-sm"
                          }`}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4" />
                              {uploaded?.url ? "Replace File" : "Upload File"}
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFilePicked(e.target.files)}
          accept={fileInputAccept}
        />
    </main>
  );
}
