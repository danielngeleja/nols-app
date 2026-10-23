import { prisma } from "@nolsaf/prisma";
import type { Prisma } from "@prisma/client";

/** The owner-facing withdrawal day is midnight-to-midnight in Tanzania (UTC+03:00). */
export function ownerWithdrawalDay(now: Date): { start: Date; end: Date; day: string } {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = eat.toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00.000Z`);
  start.setUTCHours(start.getUTCHours() - 3);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), day };
}

export class OwnerWithdrawalLimitError extends Error {
  constructor(
    readonly code: "LIMIT_UNAVAILABLE" | "DAILY_LIMIT",
    message: string,
    readonly remaining: number = 0,
  ) {
    super(message);
    this.name = "OwnerWithdrawalLimitError";
  }
}

type Db = typeof prisma | Prisma.TransactionClient;

/** Mandatory admin setting. Missing schema/settings block money rather than removing the ceiling. */
export async function ownerWithdrawalLimit(db: Db = prisma): Promise<number> {
  try {
    const row = await db.systemSetting.findUnique({ where: { id: 1 }, select: { ownerWithdrawalDailyLimitTzs: true } });
    const value = Number(row?.ownerWithdrawalDailyLimitTzs);
    if (Number.isSafeInteger(value) && value >= 1_000 && value <= 2_000_000_000) return value;
  } catch (error: any) {
    if (error?.code !== "P2022" && !String(error?.message ?? "").includes("Unknown field")) throw error;
  }
  throw new OwnerWithdrawalLimitError("LIMIT_UNAVAILABLE", "Withdrawals are paused while the daily limit is being configured.");
}

/** Counts confirmed OTP requests and system-initiated unclaimed requests. A
 * finance-cancelled amount request had no transfer or recovery side effect. */
export async function ownerWithdrawalUsedToday(ownerId: number, now: Date, db: Db = prisma): Promise<number> {
  const { start, end } = ownerWithdrawalDay(now);
  const [confirmed, unclaimed] = await Promise.all([
    db.payoutWithdrawalChallenge.aggregate({
      where: { userId: ownerId, usedAt: { gte: start, lt: end },
        NOT: { planVersion: 2, handoffStatus: "CANCELLED" } },
      _sum: { totalAmount: true },
    }),
    db.payoutWithdrawalJob.findMany({
      where: { ownerId, challengeId: null, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      select: { grossAmount: true, plannedDeduction: true },
    }),
  ]);
  const amount = Number(confirmed._sum.totalAmount ?? 0) + unclaimed.reduce(
    (sum, job) => sum + Math.max(0, Number(job.grossAmount) - Number(job.plannedDeduction)), 0,
  );
  if (!Number.isFinite(amount) || amount < 0) {
    throw new OwnerWithdrawalLimitError("LIMIT_UNAVAILABLE", "Withdrawals are paused while today's total is checked.");
  }
  return Math.round(amount * 100) / 100;
}

export async function ownerWithdrawalAllowance(ownerId: number, now: Date, db: Db = prisma) {
  const [limit, used] = await Promise.all([ownerWithdrawalLimit(db), ownerWithdrawalUsedToday(ownerId, now, db)]);
  return { limit, used, remaining: Math.max(0, Math.round((limit - used) * 100) / 100), ...ownerWithdrawalDay(now) };
}

export function assertOwnerWithdrawalAmount(amount: number, allowance: { remaining: number }) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) {
    throw new OwnerWithdrawalLimitError("DAILY_LIMIT", "Enter a valid positive TZS amount.", allowance.remaining);
  }
  if (amount > allowance.remaining) {
    throw new OwnerWithdrawalLimitError(
      "DAILY_LIMIT",
      `Only TZS ${allowance.remaining.toLocaleString("en-US", { maximumFractionDigits: 2 })} remains in today's withdrawal limit.`,
      allowance.remaining,
    );
  }
}

/** Serialize every owner-initiated and unclaimed reservation on the same owner row. */
export async function lockOwnerWithdrawalDay(tx: Prisma.TransactionClient, ownerId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM \`user\` WHERE id = ${ownerId} FOR UPDATE`;
  if (rows.length !== 1) throw new OwnerWithdrawalLimitError("LIMIT_UNAVAILABLE", "Owner account could not be verified for withdrawal.");
}
