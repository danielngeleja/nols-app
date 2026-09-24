"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowLeft, CheckCircle2, Clock3, Eye, FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
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

  const requiredList = orderedDocs.filter((doc) => doc.required);
  const optionalList = orderedDocs.filter((doc) => !doc.required);
  const remaining = Math.max(0, completion.total - completion.uploaded);
  const allRequiredIn = completion.total > 0 && remaining === 0;

  const renderDocRow = (doc: RequiredDoc) => {
    const uploaded = uploadedByType[doc.type];
    const isUploading = savingForType === doc.type;
    const preview = localPreviewByType[doc.type];
    const done = Boolean(uploaded?.url);
    const uploadedWhen = uploaded?.uploadedAt ? new Date(uploaded.uploadedAt) : null;
    const meta = [
      toAcceptedText(doc.accept),
      "max 2MB",
      doc.type === "PASSPORT_SIZE_PHOTO" ? `cropped to ${PASSPORT_TARGET_WIDTH}×${PASSPORT_TARGET_HEIGHT}` : null,
    ].filter(Boolean).join(" · ");
    return (
      // One row at every width: icon, text, actions. Phones drop the long
      // description and the button labels so the row never wraps.
      <li key={doc.type} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:items-start">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`${doc.label} preview`} className="h-12 w-10 flex-shrink-0 rounded-lg object-cover" style={{ border: "1px solid #d0e8e5" }} />
          ) : (
            <span
              className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                done ? "bg-[#02665e] text-white" : doc.required ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"
              }`}
            >
              {done ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <FileText className="h-5 w-5" aria-hidden />}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-bold text-slate-900">{doc.label}</span>
              {done ? (
                <span className="inline-flex flex-shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Uploaded</span>
              ) : doc.required ? (
                <span className="inline-flex flex-shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">Needed</span>
              ) : null}
            </div>
            <p className="m-0 mt-0.5 hidden text-[12.5px] leading-relaxed text-slate-500 sm:block">{doc.description}</p>
            <p className="m-0 mt-0.5 truncate text-[11.5px] text-slate-400 sm:mt-1 sm:whitespace-normal">
              {meta}
              {done && uploadedWhen && !Number.isNaN(uploadedWhen.getTime()) ? ` · uploaded ${uploadedWhen.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          {done ? (
            <a
              href={uploaded!.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${doc.label}`}
              title="View"
              className="inline-flex h-9 w-9 items-center justify-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e] sm:w-auto sm:px-3.5"
            >
              <Eye className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">View</span>
            </a>
          ) : null}
          <button
            type="button"
            disabled={Boolean(savingForType)}
            onClick={() => openPicker(doc.type)}
            aria-label={`${done ? "Replace" : "Upload"} ${doc.label}`}
            title={done ? "Replace" : "Upload"}
            style={{ fontFamily: "inherit" }}
            className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-4 ${
              done
                ? "border border-solid border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                : "border-0 bg-[#02665e] text-white hover:bg-[#014d47]"
            }`}
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{isUploading ? "Uploading..." : done ? "Replace" : "Upload"}</span>
          </button>
        </div>
      </li>
    );
  };

  const ringSize = 76;
  const ringStroke = 7;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringLength = 2 * Math.PI * ringRadius;

  return (
    <div id="tour-docs-page" className="w-full min-w-0 space-y-5">
      <style>{"#tour-docs-page, #tour-docs-page * { box-sizing: border-box; }"}</style>

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/account/tour-packages/${encodeURIComponent(bookingId)}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to trip
        </Link>
        {bookingCode ? <span className="min-w-0 truncate font-mono text-[12px] text-slate-400">{bookingCode}</span> : null}
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true">
          <span role="status" className="sr-only">Loading documents</span>
          <div className="h-36 rounded-3xl border border-solid border-slate-200 bg-white" />
          <div className="h-80 rounded-3xl border border-solid border-slate-200 bg-white" />
        </div>
      ) : (
        <>
          {/* ── Header with progress ── */}
          <section className="flex flex-col gap-5 rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="min-w-0">
              <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#02665e]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Travel documents
              </p>
              <h1 className="m-0 mt-1.5 break-words text-[24px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[28px]">
                {packageTitle || "Your tour"}
              </h1>
              <p className="m-0 mt-2 max-w-xl text-[13.5px] leading-relaxed text-slate-500">
                Upload what your operator needs for permits and entry. Files stay linked to this booking.
              </p>
            </div>

            {completion.total > 0 ? (
              <div className="flex flex-shrink-0 items-center gap-4 rounded-2xl bg-slate-50 px-4 py-3.5 sm:bg-transparent sm:p-0">
                <div className="relative" style={{ width: ringSize, height: ringSize }}>
                  <svg width={ringSize} height={ringSize} className="-rotate-90" aria-hidden>
                    <circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} fill="none" stroke="#e2e8f0" strokeWidth={ringStroke} />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke="#02665e"
                      strokeWidth={ringStroke}
                      strokeLinecap="round"
                      strokeDasharray={ringLength}
                      strokeDashoffset={ringLength * (1 - completionPercent / 100)}
                      style={{ transition: "stroke-dashoffset 400ms ease" }}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[16px] font-black tabular-nums text-slate-900">
                    {completion.uploaded}/{completion.total}
                  </span>
                </div>
                <div>
                  <div className="text-[14px] font-bold text-slate-900">{allRequiredIn ? "All required documents in" : `${remaining} required ${remaining === 1 ? "document" : "documents"} left`}</div>
                  <div className="mt-0.5 text-[12.5px] text-slate-500">{allRequiredIn ? "Your operator can now verify your booking." : "Finish these to speed up verification."}</div>
                </div>
              </div>
            ) : null}
          </section>

          {isCancellationEvidenceUpload ? (
            <div className="flex items-start gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3.5 text-[13px] leading-relaxed text-amber-950">
              <Clock3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
              <span><strong>Evidence for cancellation case #{requestedEvidenceCaseId}.</strong> Anything you upload here is attached to that case for the NoLSAF review team.</span>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>
          ) : null}
          {success ? (
            <div role="status" className="flex items-center gap-2 rounded-2xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
              {success}
            </div>
          ) : null}

          {/* ── Required ── */}
          {requiredList.length ? (
            <section className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3.5 sm:px-5">
                <h2 className="m-0 text-[15px] font-bold text-slate-900">Required</h2>
                <span className="text-[12.5px] font-semibold text-slate-500">{completion.uploaded} of {completion.total} uploaded</span>
              </div>
              <ul className="m-0 list-none divide-y divide-solid divide-slate-200 [&>*]:border-x-0 p-0">{requiredList.map(renderDocRow)}</ul>
            </section>
          ) : null}

          {/* ── Optional ── */}
          {optionalList.length ? (
            <section className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 className="m-0 text-[15px] font-bold text-slate-900">Only if asked</h2>
                  <p className="m-0 mt-0.5 text-[12px] text-slate-500">Upload these when your destination or operator requests them.</p>
                </div>
              </div>
              <ul className="m-0 list-none divide-y divide-solid divide-slate-200 [&>*]:border-x-0 p-0">{optionalList.map(renderDocRow)}</ul>
            </section>
          ) : null}
        </>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFilePicked(e.target.files)} accept={fileInputAccept} />
    </div>
  );
}
