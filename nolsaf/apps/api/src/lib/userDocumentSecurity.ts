const DRIVER_DOCUMENT_TYPES = new Set([
  "DRIVER_LICENSE",
  "DRIVING_LICENSE",
  "DRIVER_LICENCE",
  "DRIVING_LICENCE",
  "LICENSE",
  "NATIONAL_ID",
  "ID",
  "PASSPORT",
  "VEHICLE_REGISTRATION",
  "VEHICLE_REG",
  "LATRA",
  "INSURANCE",
]);

const OWNER_DOCUMENT_TYPES = new Set([
  "BUSINESS_LICENCE",
  "BUSINESS_LICENSE",
  "TIN_CERTIFICATE",
]);

const AGENT_DOCUMENT_TYPES = new Set([
  "NATIONAL_ID",
  "PASSPORT",
  // One combined slot on the operator upload page, mirrored by the admin review
  // panel. Without it every National ID / Passport upload was rejected with 400.
  "NATIONAL_ID_OR_PASSPORT",
  "CONTRACT",
  "CERTIFICATE",
  "LICENSE",
  "BRELA_CERTIFICATE",
  "TIN_NUMBER",
  "TIN_CERTIFICATE",
  "BUSINESS_LICENSE",
  "BUSINESS_LICENCE",
  "BUSINESS_LISENCE",
  "TOURISM_LICENSE",
  "TOURISM_LICENCE",
  "VEHICLE_PERMIT",
  "NDA",
]);

const TRAVELLER_DOCUMENT_TYPES = new Set([
  "PASSPORT_SIZE_PHOTO",
  "TRAVEL_PASSPORT",
  "PASSPORT",
  "NATIONAL_ID",
  "VISA_DOCUMENT",
  "YELLOW_FEVER_CERTIFICATE",
  "VACCINATION_CARD",
  "MEDICAL_CLEARANCE",
  "SUPPORTING_DOCUMENT",
]);

const LOCAL_UPLOAD_PATH_PREFIXES = ["/uploads/", "/api/uploads/"];

function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isAllowedProtocol(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return process.env.NODE_ENV !== "production" && url.protocol === "http:" && isLocalDevHost(url.hostname);
}

function getAllowedOriginHosts(): Set<string> {
  const hosts = new Set<string>();
  const rawOrigins = [
    process.env.WEB_ORIGIN || "",
    process.env.APP_ORIGIN || "",
    ...(process.env.CORS_ORIGIN || "").split(","),
  ];

  for (const rawOrigin of rawOrigins) {
    const origin = String(rawOrigin || "").trim();
    if (!origin) continue;
    try {
      hosts.add(new URL(origin).host.toLowerCase());
    } catch {
      // ignore malformed origin entries
    }
  }

  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
    hosts.add("localhost:4000");
    hosts.add("127.0.0.1:4000");
  }

  return hosts;
}

function getAllowedFolderPrefixesForRole(role?: string | null): string[] {
  const normalizedRole = String(role ?? "").trim().toUpperCase();
  if (normalizedRole === "DRIVER") return ["driver-documents/"];
  if (normalizedRole === "OWNER") return ["owner-documents/"];
  if (normalizedRole === "AGENT") return ["agent-documents/"];
  return ["uploads/"];
}

function isTrustedSameHostDocumentUrl(url: URL): boolean {
  const allowedHosts = getAllowedOriginHosts();
  if (!allowedHosts.has(url.host.toLowerCase())) return false;
  return LOCAL_UPLOAD_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isTrustedCloudinaryDocumentUrl(url: URL, folderPrefixes: string[]): boolean {
  if (url.hostname.toLowerCase() !== "res.cloudinary.com") return false;

  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  if (cloudName && !url.pathname.startsWith(`/${cloudName}/`)) return false;

  const decodedPath = decodeURIComponent(url.pathname);
  return folderPrefixes.some((prefix) => decodedPath.includes(`/${prefix}`));
}

function isTrustedS3DocumentUrl(url: URL, folderPrefixes: string[]): boolean {
  const bucket = String(process.env.S3_BUCKET || "").trim();
  const region = String(process.env.AWS_REGION || "").trim();
  if (!bucket) return false;

  const allowedHosts = new Set<string>([
    `${bucket}.s3.amazonaws.com`.toLowerCase(),
    `${bucket}.s3.${region}.amazonaws.com`.toLowerCase(),
  ]);

  if (!allowedHosts.has(url.host.toLowerCase())) return false;

  const decodedPath = decodeURIComponent(url.pathname);
  return folderPrefixes.some((prefix) => decodedPath.startsWith(`/${prefix}`) || decodedPath.includes(`/${prefix}`));
}

export function isAllowedDocumentTypeForRole(role: string | null | undefined, type: string): boolean {
  const normalizedRole = String(role ?? "").trim().toUpperCase();
  const normalizedType = String(type ?? "").trim().toUpperCase();

  if (!normalizedType) return false;
  if (normalizedRole === "DRIVER") return DRIVER_DOCUMENT_TYPES.has(normalizedType);
  if (normalizedRole === "OWNER") return OWNER_DOCUMENT_TYPES.has(normalizedType);
  if (normalizedRole === "AGENT") return AGENT_DOCUMENT_TYPES.has(normalizedType);
  if (["TRAVELLER", "TRAVELER", "CUSTOMER", "USER"].includes(normalizedRole)) {
    return TRAVELLER_DOCUMENT_TYPES.has(normalizedType);
  }
  return true;
}

export function isTrustedUserDocumentUrl(rawUrl: string, role?: string | null): boolean {
  try {
    const url = new URL(String(rawUrl || ""));
    if (!isAllowedProtocol(url)) return false;

    const folderPrefixes = getAllowedFolderPrefixesForRole(role);
    return (
      isTrustedSameHostDocumentUrl(url) ||
      isTrustedCloudinaryDocumentUrl(url, folderPrefixes) ||
      isTrustedS3DocumentUrl(url, folderPrefixes)
    );
  } catch {
    return false;
  }
}

export function sanitizeUserDocument<T extends { url?: string | null }>(doc: T, role?: string | null): T & { unsafeUrl?: boolean } {
  const rawUrl = typeof doc?.url === "string" ? doc.url : null;
  if (!rawUrl) {
    return { ...doc, unsafeUrl: false };
  }

  if (isTrustedUserDocumentUrl(rawUrl, role)) {
    return { ...doc, unsafeUrl: false };
  }

  return {
    ...doc,
    url: null,
    unsafeUrl: true,
  };
}
