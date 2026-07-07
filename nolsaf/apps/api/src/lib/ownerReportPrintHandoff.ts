import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV !== "production"
    ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret")
    : "");

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET not set");
}

type OwnerReportPrintHandoffPayload = {
  sub: string;
  role: "OWNER";
  purpose: "owner-report-print";
};

export function signOwnerReportPrintHandoff(userId: number) {
  return jwt.sign(
    {
      sub: String(userId),
      role: "OWNER",
      purpose: "owner-report-print",
    } satisfies OwnerReportPrintHandoffPayload,
    JWT_SECRET,
    {
      expiresIn: 5 * 60,
      issuer: "nolsaf",
      audience: "owner-report-print",
    }
  );
}

export function verifyOwnerReportPrintHandoff(token: string) {
  const payload = jwt.verify(token, JWT_SECRET, {
    issuer: "nolsaf",
    audience: "owner-report-print",
  }) as Partial<OwnerReportPrintHandoffPayload>;

  if (payload.purpose !== "owner-report-print" || payload.role !== "OWNER" || !payload.sub) {
    return null;
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return { userId };
}
