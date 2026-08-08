/**
 * AzamPay Disbursement — Checksum Primitive
 *
 * Published rule: Base64( RSA( SHA512(string) ) ), RSA using PKCS#1 v1.5
 * padding. AzamPay's own Python/Go samples use OAEP, but the written rule
 * says PKCS1 — this implementation follows the written rule per
 * docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md and must be confirmed against a
 * real AzamPay test vector before certification.
 *
 * This function is pure crypto — it does not know which fields go into the
 * input string. See checksumInput.ts for that (config-driven, since the
 * exact field composition is not yet confirmed by AzamPay).
 */

import { createHash, publicEncrypt, constants } from "node:crypto";

export function azamPayChecksum(inputString: string, publicKeyPem: string): string {
  if (!publicKeyPem) {
    throw new Error(
      "AzamPay checksum: no public key configured. AzamPay must supply this key before any real checksum can be computed."
    );
  }

  const digest = createHash("sha512").update(inputString, "utf8").digest();

  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_PADDING,
    },
    digest
  );

  return encrypted.toString("base64");
}

/**
 * Verifies a checksum implementation against a known-good AzamPay test
 * vector. Call this once AzamPay provides {input, publicKey, expected} —
 * do not trust the implementation in production without it.
 */
export function verifyAzamPayChecksumVector(
  input: string,
  publicKeyPem: string,
  expected: string
): boolean {
  return azamPayChecksum(input, publicKeyPem) === expected;
}
