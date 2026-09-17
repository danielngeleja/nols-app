import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { chatbotConversation: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));

import { autoResolveQuietTwigaThreads } from "../workers/twigaAutoResolve.js";
import { AGENT_ACTIVE_AUTO_RESOLVE_MS, CONVERSATION_STATUS } from "../lib/twiga/handoff.js";

describe("autoResolveQuietTwigaThreads", () => {
  const now = new Date("2026-09-16T18:00:00.000Z");
  const cutoff = new Date(now.getTime() - AGENT_ACTIVE_AUTO_RESOLVE_MS);

  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.updateMany.mockReset();
  });

  it("looks only at AGENT_ACTIVE threads with no message since the 12-hour cut-off", async () => {
    mocks.findMany.mockResolvedValue([]);
    await autoResolveQuietTwigaThreads(now);

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(AGENT_ACTIVE_AUTO_RESOLVE_MS).toBe(12 * 60 * 60 * 1000);
    expect(where.status).toBe(CONVERSATION_STATUS.AGENT_ACTIVE);
    expect(where.messages).toEqual({ none: { createdAt: { gte: cutoff } } });
    expect(where.createdAt).toEqual({ lt: cutoff });
  });

  it("does not write when nothing is quiet", async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(autoResolveQuietTwigaThreads(now)).resolves.toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("resolves without deleting, and re-checks status so a late reply wins", async () => {
    mocks.findMany.mockResolvedValue([{ id: 4 }, { id: 9 }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(autoResolveQuietTwigaThreads(now)).resolves.toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [4, 9] }, status: CONVERSATION_STATUS.AGENT_ACTIVE },
      data: { status: CONVERSATION_STATUS.RESOLVED, resolvedAt: now, needsFollowUp: false },
    });
  });
});
