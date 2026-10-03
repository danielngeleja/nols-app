import type { Server } from "socket.io";
import { prisma } from "@nolsaf/prisma";
import { adminRecordReferenceOrNull as recordRef } from "../lib/adminRecordReference.js";

type StartOptions = {
  io?: Server;
  intervalMs?: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseExpiresAt(metadata: any): Date | null {
  const raw = metadata?.expiresAt ?? metadata?.expires_on ?? metadata?.expiresOn;
  if (!raw) return null;
  const parsed = new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

async function ensureDailyNotification({
  ownerId,
  title,
  body,
  meta,
}: {
  ownerId: number;
  title: string;
  body: string;
  meta: any;
}): Promise<{ created: boolean; id: number | null }> {
  const dateKey = String(meta?.dateKey || "");
  const documentId = Number(meta?.documentId);
  const kind = String(meta?.kind || "");

  // Safety: if key fields are missing, do not spam.
  if (!ownerId || !dateKey || !Number.isFinite(documentId) || !kind) {
    return { created: false, id: null };
  }

  try {
    const existing = await prisma.notification.findFirst({
      where: {
        ownerId,
        type: "compliance",
        AND: [
          { meta: { path: ["kind"], equals: kind } as any },
          { meta: { path: ["documentId"], equals: documentId } as any },
          { meta: { path: ["dateKey"], equals: dateKey } as any },
        ],
      } as any,
      select: { id: true },
    });

    if (existing?.id) return { created: false, id: Number(existing.id) };
  } catch {
    // If JSON-path filtering is unsupported in a given DB setup, fall back to creating.
    // The meta includes dateKey, so at worst it's 1/day.
  }

  try {
    const n = await prisma.notification.create({
      data: {
        ownerId,
        userId: ownerId,
        title,
        body,
        type: "compliance",
        meta,
      },
      select: { id: true },
    });
    return { created: true, id: Number(n.id) };
  } catch {
    return { created: false, id: null };
  }
}

async function tick(io?: Server) {
  const now = new Date();
  const dateKey = utcDateKey(now);

  // Pull all approved BUSINESS_LICENCE docs; we filter on metadata in JS.
  // This avoids relying on JSON query support across environments.
  const docs = await prisma.userDocument.findMany({
    where: {
      status: "APPROVED",
      type: "BUSINESS_LICENCE",
      url: { not: null },
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      url: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    take: 5000,
  } as any);

  for (const d of docs || []) {
    const ownerId = Number((d as any).userId);
    if (!Number.isFinite(ownerId) || ownerId <= 0) continue;

    const expiresAt = parseExpiresAt((d as any).metadata);
    if (!expiresAt) continue;

    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);

    // Notify from 10 days prior (inclusive) until expiry day.
    const inReminderWindow = daysLeft <= 10 && daysLeft >= 0;
    const isExpired = daysLeft < 0;

    // After expiry, stop reminders after 3 days.
    if (isExpired && daysLeft < -3) continue;

    if (!inReminderWindow && !isExpired) continue;

    const ownerName = (d as any)?.user?.name || (d as any)?.user?.email || `Owner #${ownerId}`;
    const expDateStr = expiresAt.toLocaleDateString();

    const title = isExpired ? "Business licence expired" : "Business licence expiring soon";
    const body = isExpired
      ? `${ownerName}: business licence expired on ${expDateStr}. Please renew and upload the updated licence.`
      : `${ownerName}: business licence will expire on ${expDateStr} (${daysLeft} day(s) left). Please renew and upload the updated licence.`;

    const meta = {
      kind: "business_licence_expiry",
      dateKey,
      documentId: Number((d as any).id),
      documentType: "BUSINESS_LICENCE",
      ownerId,
      ownerName: (d as any)?.user?.name ?? null,
      ownerEmail: (d as any)?.user?.email ?? null,
      expiresAt: expiresAt.toISOString(),
      daysLeft,
      state: isExpired ? "EXPIRED" : "EXPIRING",
      actionUrlOwner: "/owner/profile",
      actionUrlAdmin: `/admin/owners/${recordRef("owner", ownerId) ?? ownerId}`,
    };

    const r = await ensureDailyNotification({ ownerId, title, body, meta });

    if (r.created && io) {
      try {
        io.to(`user:${ownerId}`).emit("notification:new", { id: r.id, title, type: "compliance" });
      } catch {}
      try {
        io.to(`owner:${ownerId}`).emit("notification:new", { id: r.id, title, type: "compliance" });
      } catch {}
      try {
        io.emit("admin:notifications:updated", { kind: "business_licence_expiry", ownerId });
      } catch {}
    }
  }
}

export function startOwnerBusinessLicenceExpiryReminders({ io, intervalMs = 6 * 60 * 60 * 1000 }: StartOptions = {}) {
  if ((global as any).__ownerBusinessLicenceExpiryRemindersStarted) return;
  (global as any).__ownerBusinessLicenceExpiryRemindersStarted = true;

  const run = async () => {
    try {
      await tick(io);
    } catch (e) {
      console.warn("[owner-business-licence-expiry] tick failed", e);
    }
  };

  // Run on startup, then on interval.
  void run();
  setInterval(() => void run(), intervalMs);
}
