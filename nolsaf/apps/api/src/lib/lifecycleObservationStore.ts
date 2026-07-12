import { createHash } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import type { ServiceLifecycle, ServiceType } from "./serviceLifecycle.js";

type PersistLifecycleObservationInput = {
  serviceType: ServiceType;
  bookingId: number;
  lifecycle: ServiceLifecycle;
  metadata?: Record<string, unknown>;
};

function fingerprint(serviceType: ServiceType, bookingId: number, code: string, message: string): string {
  return createHash("sha256")
    .update(`${serviceType}:${bookingId}:${code}:${message}`)
    .digest("hex");
}

function snapshotFingerprint(lifecycle: ServiceLifecycle): string | null {
  if (!lifecycle.consistency.issues.length) return null;
  return createHash("sha256")
    .update(lifecycle.consistency.issues.map((issue) => `${issue.code}:${issue.message}`).join("|"))
    .digest("hex");
}

/**
 * Persists one observation without changing any source booking or financial record.
 * Re-running this function is safe: snapshots and exception occurrences are upserted.
 */
export async function persistLifecycleObservation(input: PersistLifecycleObservationInput): Promise<void> {
  const now = new Date();
  const activeExceptions = input.lifecycle.consistency.issues.map((issue) => ({
    ...issue,
    fingerprint: fingerprint(input.serviceType, input.bookingId, issue.code, issue.message),
  }));

  await (prisma as any).$transaction(async (tx: any) => {
    await tx.lifecycleSnapshot.upsert({
      where: { serviceType_bookingId: { serviceType: input.serviceType, bookingId: input.bookingId } },
      create: {
        serviceType: input.serviceType,
        bookingId: input.bookingId,
        bookingStage: input.lifecycle.bookingStage,
        paymentStage: input.lifecycle.paymentStage,
        receiptStage: input.lifecycle.receiptStage,
        responsibilityStage: input.lifecycle.responsibilityStage,
        caseStage: input.lifecycle.caseStage,
        requiredAction: input.lifecycle.requiredAction,
        consistencyStatus: input.lifecycle.consistency.status,
        issueFingerprint: snapshotFingerprint(input.lifecycle),
        issues: input.lifecycle.consistency.issues,
        calculatedAt: now,
      },
      update: {
        bookingStage: input.lifecycle.bookingStage,
        paymentStage: input.lifecycle.paymentStage,
        receiptStage: input.lifecycle.receiptStage,
        responsibilityStage: input.lifecycle.responsibilityStage,
        caseStage: input.lifecycle.caseStage,
        requiredAction: input.lifecycle.requiredAction,
        consistencyStatus: input.lifecycle.consistency.status,
        issueFingerprint: snapshotFingerprint(input.lifecycle),
        issues: input.lifecycle.consistency.issues,
        calculatedAt: now,
      },
    });

    for (const issue of activeExceptions) {
      const existing = await tx.lifecycleException.findUnique({
        where: {
          serviceType_bookingId_fingerprint: {
            serviceType: input.serviceType,
            bookingId: input.bookingId,
            fingerprint: issue.fingerprint,
          },
        },
        select: { id: true, status: true },
      });

      const reopened = existing && ["RESOLVED", "IGNORED"].includes(String(existing.status).toUpperCase());
      if (existing) {
        await tx.lifecycleException.update({
          where: { id: existing.id },
          data: {
            severity: issue.severity,
            message: issue.message,
            metadata: input.metadata ?? undefined,
            lastSeenAt: now,
            ...(reopened ? { status: "OPEN", resolvedAt: null, ignoredAt: null } : {}),
          },
        });
      } else {
        await tx.lifecycleException.create({
          data: {
            serviceType: input.serviceType,
            bookingId: input.bookingId,
            code: issue.code,
            severity: issue.severity,
            status: "OPEN",
            fingerprint: issue.fingerprint,
            message: issue.message,
            metadata: input.metadata,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
      }
    }

    const activeFingerprints = activeExceptions.map((issue) => issue.fingerprint);
    await tx.lifecycleException.updateMany({
      where: {
        serviceType: input.serviceType,
        bookingId: input.bookingId,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        ...(activeFingerprints.length ? { fingerprint: { notIn: activeFingerprints } } : {}),
      },
      data: { status: "RESOLVED", resolvedAt: now },
    });
  });
}
