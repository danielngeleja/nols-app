import { prisma } from "@nolsaf/prisma";

const db = prisma as any;

async function update(worker: string, data: Record<string, unknown>) {
  try {
    // `{ increment: 1 }` is only valid against an existing row (the `update`
    // branch). For `create`, Prisma needs a plain starting integer instead.
    // Reusing the same increment object there fails argument validation on
    // every call, since Prisma validates both branches' shapes upfront.
    const { runCount, ...rest } = data as { runCount?: { increment: number } } & Record<string, unknown>;
    await db.nrmsWorkerHealth.upsert({
      where: { worker },
      update: data,
      create: { worker, ...rest, ...(runCount ? { runCount: runCount.increment } : {}) },
    });
  } catch (error) {
    // Health reporting must never stop the worker itself, especially while a
    // migration is rolling out across a multi-instance deployment.
    console.warn(`[nrms-worker-health] unable to update ${worker}:`, error instanceof Error ? error.message : error);
  }
}

export async function runNrmsWorker<T>(worker: string, task: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  await update(worker, { status: "RUNNING", lastStartedAt: startedAt, lastError: null });
  try {
    const result = await task();
    await update(worker, { status: "HEALTHY", lastSuccessAt: new Date(), runCount: { increment: 1 } });
    return result;
  } catch (error) {
    await update(worker, {
      status: "FAILED",
      lastFailureAt: new Date(),
      lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
      runCount: { increment: 1 },
    });
    throw error;
  }
}
