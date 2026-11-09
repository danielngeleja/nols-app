import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real router and rate limiters; storage, auth and SMS are fakes.
const state = vi.hoisted(() => ({
  otps: [] as any[],
  nextId: 1,
  sms: vi.fn(async (..._args: any[]) => ({ success: true, provider: "test" })),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, role: "OWNER", name: "Owner", phone: null })),
      update: vi.fn(async () => ({})),
    },
    phoneOtp: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: state.nextId++, usedAt: null, ...data };
        state.otps.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        [...state.otps].reverse().find((o) => o.userId === where.userId && o.usedAt === null) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.otps.find((o) => o.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: Number(req.headers["x-test-user"]), role: "OWNER" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/crypto.js", () => ({
  hashCode: async (code: string) => createHash("sha256").update(code).digest("hex"),
  verifyCode: async (hash: string, code: string) => createHash("sha256").update(code).digest("hex") === hash,
}));
vi.mock("../lib/sms.js", () => ({ sendSms: state.sms }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));

let app: express.Express;
let owner = 5000;
let suffix = 100;

beforeAll(async () => {
  process.env.JWT_SECRET = "owner-phone-verify-test-secret";
  const { router } = await import("./owner.phone.verify.js");
  app = express();
  app.use(express.json());
  app.use("/api/owner/phone", router);
});
beforeEach(() => {
  state.sms.mockClear();
  owner += 1;
  suffix += 1;
});

const start = (user: number, phone: string) =>
  request(app).post("/api/owner/phone/start").set("x-test-user", String(user)).send({ phone });
const verify = (user: number, code: string) =>
  request(app).post("/api/owner/phone/verify").set("x-test-user", String(user)).send({ code });
const sentCode = () => String(state.sms.mock.calls.at(-1)?.[1] ?? "").match(/\d{6}/)?.[0] ?? "";
const number = () => `+2557130${String(suffix).padStart(5, "0")}`;

describe("owner phone verification abuse resistance", () => {
  it("refuses to text a malformed number", async () => {
    await start(owner, "12").expect(400);
    await start(owner, "not a phone").expect(400);
    expect(state.sms).not.toHaveBeenCalled();
  });

  it("texts the canonical number", async () => {
    const phone = number();
    await start(owner, `0${phone.slice(4)}`).expect(200);
    expect(state.sms.mock.calls[0][0]).toBe(phone);
  });

  it("caps codes per owner", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) { suffix += 1; statuses.push((await start(owner, number())).status); }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(state.sms).toHaveBeenCalledTimes(3);
  });

  it("caps codes per target number across owners and spellings", async () => {
    const phone = number();
    const national = phone.slice(4);
    const spellings = [phone, `0${national}`, phone.slice(1), `0${national.slice(0, 3)} ${national.slice(3)}`, `00${phone.slice(1)}`, phone];
    const statuses: number[] = [];
    for (const [index, spelling] of spellings.entries()) statuses.push((await start(owner + 1000 + index, spelling)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(state.sms).toHaveBeenCalledTimes(5);
  });

  it("spends the code after five guesses, so the right code no longer works", async () => {
    await start(owner, number()).expect(200);
    const code = sentCode();
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await verify(owner, wrong).expect(400);
    const capped = await verify(owner, code).expect(400);
    expect(capped.body.code).toBe("OTP_ATTEMPTS_EXCEEDED");
    await verify(owner, code).expect(400);
  });

  it("accepts the right code within the guess budget", async () => {
    await start(owner, number()).expect(200);
    const code = sentCode();
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 4; i++) await verify(owner, wrong).expect(400);
    await verify(owner, code).expect(200);
  });
});
