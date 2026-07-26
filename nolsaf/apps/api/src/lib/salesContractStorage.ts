import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function bucketName(): string {
  return String(
    process.env.SALES_CONTRACT_S3_BUCKET ||
      process.env.AWS_S3_BUCKET ||
      process.env.S3_BUCKET ||
      "",
  ).trim();
}

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    ...(process.env.AWS_S3_ENDPOINT
      ? {
          endpoint: process.env.AWS_S3_ENDPOINT,
          forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
        }
      : {}),
  });
}

export function hasSalesContractObjectStorage(): boolean {
  return Boolean(bucketName());
}

export async function storeSalesContractPdf(params: {
  partnerId: number;
  contractNumber: string;
  pdfSha256: string;
  pdf: Buffer;
}): Promise<string | null> {
  const bucket = bucketName();
  if (!bucket) return null;

  const safeContractNumber = params.contractNumber.replace(/[^A-Za-z0-9._-]/g, "_");
  const key = `private/sales-contracts/${params.partnerId}/${safeContractNumber}/${params.pdfSha256}.pdf`;
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: params.pdf,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="${safeContractNumber}.pdf"`,
      CacheControl: "private, no-store",
      ServerSideEncryption: process.env.SALES_CONTRACT_S3_KMS_KEY_ID ? "aws:kms" : "AES256",
      ...(process.env.SALES_CONTRACT_S3_KMS_KEY_ID
        ? { SSEKMSKeyId: process.env.SALES_CONTRACT_S3_KMS_KEY_ID }
        : {}),
      Metadata: {
        "contract-number": safeContractNumber,
        "sha256": params.pdfSha256,
      },
    }),
  );
  return `s3://${bucket}/${key}`;
}

function parsePrivateS3Reference(reference: string): { bucket: string; key: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(String(reference || ""));
  if (!match) return null;
  const [, bucket, key] = match;
  if (
    !bucket ||
    bucket !== bucketName() ||
    !key ||
    !key.startsWith("private/sales-contracts/")
  ) {
    return null;
  }
  return { bucket, key };
}

export async function salesContractDownloadUrl(reference: string): Promise<string | null> {
  const parsed = parsePrivateS3Reference(reference);
  if (!parsed) return null;
  return getSignedUrl(
    s3Client() as any,
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }) as any,
    { expiresIn: 300 },
  );
}
