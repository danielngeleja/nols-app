import { prisma } from "@nolsaf/prisma";
import { mayPushNotification } from "../lib/pushPolicy.js";
import { getRoleSessionMaxMinutes, getSessionIdleMinutes } from "../lib/securitySettings.js";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const TICK_MS = 15_000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

type ExpoResult = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };

async function validSessionKeys(sessionIds: string[]): Promise<Set<string>> {
  if (!sessionIds.length) return new Set();
  const now = Date.now();
  const [idleMinutes, maxMinutes] = await Promise.all([
    getSessionIdleMinutes(),
    getRoleSessionMaxMinutes("CUSTOMER"),
  ]);
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds }, revokedAt: null },
    select: { id: true, userId: true, createdAt: true, lastSeenAt: true, user: { select: { role: true, isDisabled: true, suspendedAt: true, deletedAt: true, tokensValidAfter: true } } },
  });
  // Push eligibility follows the same idle and maximum session limits as API auth.
  return new Set(sessions.filter((session) =>
    ["CUSTOMER", "USER"].includes(session.user.role) &&
    !session.user.isDisabled && !session.user.suspendedAt && !session.user.deletedAt &&
    (!session.user.tokensValidAfter || session.createdAt >= session.user.tokensValidAfter) &&
    now - session.lastSeenAt.getTime() <= Math.max(1, idleMinutes) * 60_000 &&
    now - session.createdAt.getTime() <= maxMinutes * 60_000
  ).map((session) => `${session.id}:${session.userId}`));
}

async function postExpo(url: string, body: unknown): Promise<any> {
  const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("Expo push access token is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Expo Push API HTTP ${response.status}`);
  return response.json();
}

/** Scan saved inbox rows, including paths that do not call notifyUser(). */
async function enqueueNewNotifications() {
  const cursor = await prisma.pushCursor.findUnique({ where: { id: 1 } });
  if (!cursor) return; // Migration seeds the first cursor at the pre-push inbox maximum.
  const newRows = await prisma.notification.findMany({
    where: { id: { gt: cursor.lastNotificationId }, createdAt: { gte: cursor.activatedAt }, userId: { not: null } },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    include: { user: { select: { role: true, notificationPrefs: true } } },
  });
  // Revisit a small recent ID window for transactions that committed out of ID order.
  const recentRows = await prisma.notification.findMany({
    where: {
      id: { gt: Math.max(0, cursor.lastNotificationId - 300), lte: cursor.lastNotificationId },
      createdAt: { gte: cursor.activatedAt },
      userId: { not: null },
    },
    orderBy: { id: "desc" },
    take: 300,
    include: { user: { select: { role: true, notificationPrefs: true } } },
  });
  const rows = [...newRows, ...recentRows];
  const userIds = [...new Set(rows.filter((row) => row.user?.role === "CUSTOMER" || row.user?.role === "USER").map((row) => row.userId!))];
  const devices = userIds.length ? await prisma.pushDevice.findMany({ where: { userId: { in: userIds }, active: true } }) : [];
  const sessionIds: string[] = [...new Set<string>(devices.map((device: { sessionId: string }) => device.sessionId))];
  const validSessions = await validSessionKeys(sessionIds);
  const candidates: { notificationId: number; deviceId: number }[] = [];
  for (const row of rows) {
    if (!row.userId || !row.user || !["CUSTOMER", "USER"].includes(row.user.role)) continue;
    if (!mayPushNotification(row.meta, row.type, row.user.notificationPrefs)) continue;
    for (const device of devices) {
      if (device.userId !== row.userId || !validSessions.has(`${device.sessionId}:${device.userId}`)) continue;
      if (device.createdAt > row.createdAt) continue;
      candidates.push({ notificationId: row.id, deviceId: device.id });
    }
  }
  await prisma.$transaction(async (tx) => {
    if (candidates.length) await tx.pushDelivery.createMany({ data: candidates, skipDuplicates: true });
    if (newRows.length) await tx.pushCursor.update({ where: { id: 1 }, data: { lastNotificationId: newRows[newRows.length - 1].id } });
  });
}

async function retireDevice(deviceId: number) {
  await prisma.pushDevice.updateMany({ where: { id: deviceId }, data: { active: false } });
}

async function sendPending() {
  const now = new Date();
  const pending = await prisma.pushDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { id: "asc" }, take: BATCH_SIZE,
    include: { device: true, notification: { include: { user: { select: { notificationPrefs: true } } } } },
  });
  if (!pending.length) return;
  const validSessions = await validSessionKeys([...new Set<string>(pending.map((item: { device: { sessionId: string } }) => item.device.sessionId))]);
  const eligible: typeof pending = [];
  for (const item of pending) {
    if (!item.device.active || item.device.userId !== item.notification.userId || !validSessions.has(`${item.device.sessionId}:${item.device.userId}`)
      || !mayPushNotification(item.notification.meta, item.notification.type, item.notification.user?.notificationPrefs)) {
      await prisma.pushDelivery.update({ where: { id: item.id }, data: { status: "CANCELLED" } });
    } else eligible.push(item);
  }
  if (!eligible.length) return;
  const messages = eligible.map((item) => ({
    to: item.device.token,
    title: "NoLSAF",
    body: "You have a new update. Open NoLSAF to view it.",
    sound: "default",
    channelId: "updates",
    data: { notificationId: item.notification.id },
  }));
  let tickets: ExpoResult[];
  try {
    const response = await postExpo(SEND_URL, messages);
    if (response?.errors?.length) throw new Error("Expo Push API rejected the batch");
    tickets = Array.isArray(response?.data) ? response.data : [response?.data];
    if (tickets.length !== eligible.length) throw new Error("Expo Push API returned an incomplete batch");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Expo Push API failed";
    for (const item of eligible) {
      const attempts = item.attempts + 1;
      await prisma.pushDelivery.update({
        where: { id: item.id },
        data: { attempts, status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING", lastError: message.slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** attempts)) },
      });
    }
    console.warn("[mobile-push] send failed", message);
    return;
  }
  for (let i = 0; i < eligible.length; i++) {
    const item = eligible[i];
    const ticket = tickets[i];
    if (ticket?.status === "ok" && ticket.id) {
      await prisma.pushDelivery.update({ where: { id: item.id }, data: { status: "SENT", ticketId: ticket.id, sentAt: now, attempts: { increment: 1 } } });
    } else {
      if (ticket?.details?.error === "DeviceNotRegistered") await retireDevice(item.deviceId);
      const retry = ticket?.details?.error === "MessageRateExceeded" && item.attempts + 1 < MAX_ATTEMPTS;
      await prisma.pushDelivery.update({ where: { id: item.id }, data: {
        status: retry ? "PENDING" : "FAILED",
        nextAttemptAt: retry ? new Date(Date.now() + 60_000) : undefined,
        lastError: String(ticket?.details?.error || ticket?.message || "Expo rejected notification").slice(0, 500),
        attempts: { increment: 1 },
      } });
    }
  }
}

async function checkReceipts() {
  const now = new Date();
  const sent = await prisma.pushDelivery.findMany({
    where: {
      status: "SENT",
      sentAt: { lte: new Date(now.getTime() - 15 * 60_000) },
      OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }],
      ticketId: { not: null },
    },
    orderBy: { sentAt: "asc" }, take: BATCH_SIZE,
  });
  if (!sent.length) return;
  const response = await postExpo(RECEIPTS_URL, { ids: sent.map((item) => item.ticketId) });
  const receipts = response?.data || {};
  for (const item of sent) {
    const receipt: ExpoResult | undefined = receipts[item.ticketId!];
    if (!receipt) {
      if (item.sentAt && now.getTime() - item.sentAt.getTime() > 23 * 60 * 60_000) {
        await prisma.pushDelivery.update({ where: { id: item.id }, data: { status: "FAILED", checkedAt: now, lastError: "Push receipt unavailable" } });
      } else {
        await prisma.pushDelivery.update({ where: { id: item.id }, data: { checkedAt: now } });
      }
      continue;
    }
    if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") await retireDevice(item.deviceId);
    const retry = receipt.status === "error" && receipt.details?.error === "MessageRateExceeded" && item.attempts < MAX_ATTEMPTS;
    await prisma.pushDelivery.update({
      where: { id: item.id },
      data: {
        status: receipt.status === "ok" ? "DELIVERED" : retry ? "PENDING" : "FAILED",
        checkedAt: now,
        nextAttemptAt: retry ? new Date(Date.now() + 60_000) : undefined,
        ticketId: retry ? null : undefined,
        sentAt: retry ? null : undefined,
        lastError: receipt.status === "error" ? String(receipt.details?.error || receipt.message || "Push delivery failed").slice(0, 500) : null,
      },
    });
    if (receipt.status === "error") console.warn("[mobile-push] receipt error", receipt.details?.error || receipt.message);
  }
}

let running = false;
export function startMobilePushWorker() {
  if (process.env.MOBILE_PUSH_ENABLED === "false") return;
  if (!process.env.EXPO_PUSH_ACCESS_TOKEN?.trim()) {
    console.warn("[mobile-push] disabled: EXPO_PUSH_ACCESS_TOKEN is not configured");
    return;
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      await enqueueNewNotifications();
      await sendPending();
      await checkReceipts();
    } catch (error) {
      console.warn("[mobile-push] worker tick failed", error);
    } finally {
      running = false;
    }
  }
  void tick();
  setInterval(() => void tick(), TICK_MS);
}
