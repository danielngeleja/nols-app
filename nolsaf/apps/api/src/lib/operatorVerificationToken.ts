import jwt, { type Algorithm } from "jsonwebtoken";

export type OperatorVerificationTokenPayload = {
  typ: "OPERATOR_VERIFICATION";
  agentId: number;
  approvedAt: string;
};

const ISSUER = "nolsaf-operator-verification";
const ALGS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 2048;

function getSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  if (!secret) throw new Error("operator_verification_secret_missing");
  return secret;
}

export function signOperatorVerificationToken(agentId: number, approvedAt: string): string {
  return jwt.sign(
    { typ: "OPERATOR_VERIFICATION", agentId, approvedAt } satisfies OperatorVerificationTokenPayload,
    getSecret(),
    { issuer: ISSUER, algorithm: "HS256" },
  );
}

export function verifyOperatorVerificationToken(token: string): OperatorVerificationTokenPayload | null {
  try {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = jwt.verify(token, getSecret(), { issuer: ISSUER, algorithms: ALGS }) as OperatorVerificationTokenPayload;
    if (decoded?.typ !== "OPERATOR_VERIFICATION" || !Number.isInteger(Number(decoded.agentId)) || Number(decoded.agentId) <= 0) return null;
    if (typeof decoded.approvedAt !== "string" || !decoded.approvedAt.trim()) return null;
    return { typ: "OPERATOR_VERIFICATION", agentId: Number(decoded.agentId), approvedAt: decoded.approvedAt };
  } catch {
    return null;
  }
}
