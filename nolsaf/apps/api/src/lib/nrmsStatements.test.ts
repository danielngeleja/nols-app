import { describe, expect, it } from "vitest";
import { applyNrmsCredit, NrmsPaymentInFlightError, syncNrmsStatement } from "./nrmsStatements.js";

/** Just enough of Prisma, in memory, for the statement engine. */
function fakeDb() {
  const state = {
    statements: [] as any[],
    events: [] as any[],
    items: [] as any[],
    tokens: [] as any[],
  };
  let id = 1;
  const next = () => id++;
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    if (key === "statementItem") return cond === null ? !state.items.some((item) => item.usageEventId === row.id) : true;
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(row[key]);
      if ("not" in cond) return Number(row[key]) !== cond.not;
      if ("gt" in cond) return row[key] > cond.gt;
      return true;
    }
    return row[key] === cond;
  });
  const tx = {
    nrmsBillingStatement: {
      findMany: async ({ where }: any) => state.statements.filter((row) => matches(row, where)).sort((a, b) => a.id - b.id),
      create: async ({ data }: any) => { const row = { id: next(), status: "PAYABLE", ...data }; state.statements.push(row); return row; },
      update: async ({ where, data }: any) => { const row = state.statements.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    nrmsUsageEvent: {
      findMany: async ({ where }: any) => state.events.filter((row) => matches(row, where)).sort((a, b) => a.id - b.id),
      create: async ({ data }: any) => { const row = { id: next(), ...data }; state.events.push(row); return row; },
    },
    nrmsBillingStatementItem: {
      create: async ({ data }: any) => { state.items.push({ id: next(), ...data }); },
      createMany: async ({ data }: any) => { for (const row of data) state.items.push({ id: next(), ...row }); },
    },
    nrmsServicePaymentToken: {
      findFirst: async ({ where }: any) => state.tokens.filter((row) => matches(row, where)).sort((a, b) => b.id - a.id)[0] ?? null,
      updateMany: async ({ where, data }: any) => { for (const row of state.tokens.filter((r) => matches(r, where))) Object.assign(row, data); },
      create: async ({ data }: any) => { const row = { id: next(), status: "PENDING", ...data }; state.tokens.push(row); return row; },
    },
  };
  const usage = (count: number, amount = 500) => {
    for (let i = 0; i < count; i += 1) state.events.push({ id: next(), accountId: 1, classification: "BILLABLE_EXTERNAL", amount });
  };
  const live = () => state.tokens.filter((row) => row.status === "PENDING");
  return { tx, state, usage, live };
}

const account = (unpaidBalance: number) => ({ id: 1, propertyId: 9, policyId: 3, unpaidBalance, policy: { currency: "TZS" } });

describe("syncNrmsStatement", () => {
  it("never re-bills nights an admin already credited", async () => {
    const { tx, state, usage, live } = fakeDb();
    usage(259); // TZS 129,500 of usage, never put on a statement
    // Admin forgives all of it while no statement exists.
    const credit = await applyNrmsCredit(tx, account(129_500), 129_500);
    expect(credit.carried).toBe(129_500);
    usage(3); // TZS 1,500 of new usage afterwards; the balance is now 1,500

    const synced = await syncNrmsStatement(tx, account(1_500));
    expect(synced.amount).toBe(1_500);
    expect(state.statements).toHaveLength(1);
    expect(live()).toEqual([expect.objectContaining({ amount: 1_500 })]);
  });

  it("does not open a statement while credit exceeds usage", async () => {
    const { tx, state, usage } = fakeDb();
    usage(2);
    await applyNrmsCredit(tx, account(1_000), 5_000);
    const synced = await syncNrmsStatement(tx, account(0));
    expect(synced.statementId).toBeNull();
    expect(state.statements).toHaveLength(0);
  });

  it("never asks for more than the account balance", async () => {
    const { tx, usage } = fakeDb();
    usage(258); // 129,000 of rows, but the authoritative balance says 1,500
    const synced = await syncNrmsStatement(tx, account(1_500));
    expect(synced.amount).toBe(1_500);
  });

  it("adds new usage to the open statement instead of opening a second one", async () => {
    const { tx, state, usage, live } = fakeDb();
    usage(4);
    await syncNrmsStatement(tx, account(2_000));
    usage(2);
    const synced = await syncNrmsStatement(tx, account(3_000));
    expect(state.statements.filter((row) => row.status === "PAYABLE")).toHaveLength(1);
    expect(synced.amount).toBe(3_000);
    expect(live()).toEqual([expect.objectContaining({ amount: 3_000 })]);
  });

  it("leaves a statement alone while its payment is with the provider", async () => {
    const { tx, state, usage } = fakeDb();
    usage(4);
    const first = await syncNrmsStatement(tx, account(2_000));
    state.tokens.find((row) => row.statementId === first.statementId).status = "PROCESSING";
    usage(2);
    const synced = await syncNrmsStatement(tx, account(3_000));
    expect(synced.deferred).toBe(true);
    expect(state.statements.find((row) => row.id === first.statementId).amount).toBe(2_000);
  });
});

describe("applyNrmsCredit", () => {
  it("covers every open statement, oldest first", async () => {
    const { tx, state, usage } = fakeDb();
    usage(200);
    await syncNrmsStatement(tx, account(100_000));
    // A legacy second open statement, as the old code could create.
    state.statements.push({ id: 900, accountId: 1, status: "PAYABLE", amount: 29_000, currency: "TZS" });

    const credit = await applyNrmsCredit(tx, account(129_000), 129_000);
    expect(credit.appliedToStatements.map((row) => row.remaining)).toEqual([0, 0]);
    expect(credit.carried).toBe(0);
    expect(state.statements.every((row) => row.status === "VOID")).toBe(true);
    expect(state.tokens.filter((row) => row.status === "PENDING")).toHaveLength(0);
  });

  it("reduces a statement and reissues its payment link for the new amount", async () => {
    const { tx, usage, live } = fakeDb();
    usage(10);
    await syncNrmsStatement(tx, account(5_000));
    const credit = await applyNrmsCredit(tx, account(5_000), 2_000);
    expect(credit.appliedToStatements).toEqual([expect.objectContaining({ amount: 2_000, remaining: 3_000 })]);
    expect(live()).toEqual([expect.objectContaining({ amount: 3_000 })]);
  });

  it("carries the remainder past the open statement to the next one", async () => {
    const { tx, usage } = fakeDb();
    usage(2);
    await syncNrmsStatement(tx, account(1_000));
    const credit = await applyNrmsCredit(tx, account(1_500), 1_500);
    expect(credit.carried).toBe(500);
  });

  it("refuses while a payment is in flight", async () => {
    const { tx, state, usage } = fakeDb();
    usage(4);
    const synced = await syncNrmsStatement(tx, account(2_000));
    state.tokens.find((row) => row.statementId === synced.statementId).status = "PROCESSING";
    await expect(applyNrmsCredit(tx, account(2_000), 1_000)).rejects.toBeInstanceOf(NrmsPaymentInFlightError);
  });
});
