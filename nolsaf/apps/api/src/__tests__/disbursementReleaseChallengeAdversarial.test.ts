import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("../lib/otp.js", () => ({
  generate6: () => "123456",
  hashCode: (value: string) => `hash:${value}`,
}));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn(), SECURITY_EMAIL_FROM: "security@example.com" }));
vi.mock("../lib/sms.js", () => ({ sendSms: vi.fn() }));
vi.mock("../lib/emailBase.js", () => ({
  proEmail: () => "",
  proNoteCard: () => "",
  proReferenceCard: () => "",
}));

import {
  consumeBatchReleaseChallenge,
  ReleaseChallengeError,
  releaseChallengePurpose,
} from "../services/payouts/releaseChallenge";

describe("batch release challenge attack resistance", () => {
  it("lets only one concurrent authorization spend a release code", async () => {
    const purpose = releaseChallengePurpose(5, "abcdef1234567890");
    let used = false;
    const tx = {
      adminOtp: {
        findFirst: vi.fn(async ({ where }: any) =>
          !used && where.purpose === purpose && where.codeHash === "hash:123456"
            ? { id: 91, usedAt: null }
            : null
        ),
        updateMany: vi.fn(async () => {
          if (used) return { count: 0 };
          used = true;
          return { count: 1 };
        }),
      },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const results = await Promise.allSettled([
      consumeBatchReleaseChallenge(9, 5, "abcdef1234567890", "123456"),
      consumeBatchReleaseChallenge(9, 5, "abcdef1234567890", "123456"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(used).toBe(true);
  });

  it("cannot spend a code against a different batch fingerprint", async () => {
    const tx = {
      adminOtp: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(
      consumeBatchReleaseChallenge(19, 8, "different-fingerprint", "123456")
    ).rejects.toBeInstanceOf(ReleaseChallengeError);
    expect(tx.adminOtp.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purpose: releaseChallengePurpose(8, "different-fingerprint") }),
      })
    );
  });
});
