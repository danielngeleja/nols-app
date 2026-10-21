import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@nolsaf/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/authSessionCache.js', () => ({ invalidateAuthSessionCacheForUser: vi.fn().mockResolvedValue(undefined) }));

import { applyAccountLifecycle, inspectAccountLifecycle, LifecycleBlocked } from '../lib/adminAccountLifecycle.js';

function inspectionDb(options: {
  role?: string;
  counts?: Record<string, number>;
  payoutReleases?: number;
  verifiedPayoutAccounts?: number;
  referredUsers?: number;
  kycStatus?: string | null;
  legalHoldAudits?: number;
  suspended?: boolean;
} = {}) {
  const user = {
    id: 42, role: options.role ?? 'DRIVER', deletedAt: null, isDisabled: false, suspendedAt: options.suspended ? new Date() : null,
    kycStatus: options.kycStatus ?? null, email: 'user@example.com', phone: null,
    emailVerifiedAt: null, phoneVerifiedAt: null,
    agentProfile: null, salesPartnerProfile: null, driverLiveLocation: null,
  };
  return {
    user: {
      findUnique: vi.fn().mockImplementation(async (query: any) => {
        const selected = query.select?._count?.select;
        if (!selected) return user;
        return { _count: Object.fromEntries(Object.keys(selected).map((name) => [name, options.counts?.[name] ?? (name === 'sessions' ? 2 : name === 'notifications' ? 1 : 0)])) };
      }),
      count: vi.fn().mockResolvedValue(options.referredUsers ?? 0),
    },
    payoutRelease: { count: vi.fn().mockResolvedValue(options.payoutReleases ?? 0) },
    payoutWithdrawalJob: { count: vi.fn().mockResolvedValue(0) },
    payoutWithdrawalChallenge: { count: vi.fn().mockResolvedValue(0) },
    ownerPayoutRecovery: { count: vi.fn().mockResolvedValue(0) },
    payoutAccount: { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(options.verifiedPayoutAccounts ?? 0) },
    platformRestrictionCase: { count: vi.fn().mockResolvedValue(0) },
    karibuGesture: { count: vi.fn().mockResolvedValue(0) },
    nrmsOfflineMutation: { count: vi.fn().mockResolvedValue(0) },
    nrmsPortfolio: { count: vi.fn().mockResolvedValue(0) },
    guestCodeRequest: { count: vi.fn().mockResolvedValue(0) },
    supportImpersonationHandoff: { count: vi.fn().mockResolvedValue(0) },
    auditLog: { count: vi.fn().mockResolvedValue(options.legalHoldAudits ?? 0) },
    adminAudit: { count: vi.fn().mockResolvedValue(0) },
    payoutWithdrawalOtpGuard: { findUnique: vi.fn().mockResolvedValue(null) },
  };
}

function transactionDb(options: Parameters<typeof inspectionDb>[0] = {}) {
  const db = inspectionDb(options) as any;
  db.$queryRaw = vi.fn().mockResolvedValue([{ id: 42 }]);
  db.payoutAccount.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  db.payoutWithdrawalOtpGuard.deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  db.driverLiveLocation = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.user.update = vi.fn().mockResolvedValue({ id: 42 });
  db.session = { updateMany: vi.fn().mockResolvedValue({ count: 2 }) };
  db.pushDevice = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
  db.karibuGuestPreference = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.savedProperty = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.passkey = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.emailVerificationToken = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.phoneOtp = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  db.adminAudit.create = vi.fn().mockResolvedValue({ id: 1 });
  return db;
}

describe('admin account lifecycle eligibility', () => {
  it('allows correcting an unused driver while retaining sessions and notifications', async () => {
    const db = inspectionDb();
    const preview = await inspectAccountLifecycle(db as any, 42);
    expect(preview?.blockers).toEqual([]);
    expect(preview?.actions).toEqual({ CORRECT_TO_TRAVELLER: true, RETIRE_UNUSED: true });
    const countCalls = db.user.findUnique.mock.calls.filter(([query]) => query.select?._count?.select);
    expect(countCalls.length).toBeGreaterThan(1);
    expect(countCalls.every(([query]) => Object.keys(query.select._count.select).length <= 16)).toBe(true);
  });

  it('blocks business records even when there is no payout balance', async () => {
    const preview = await inspectAccountLifecycle(inspectionDb({ counts: { sessions: 1, driverBookings: 1, properties: 1 } }) as any, 42);
    expect(preview?.blockers).toEqual(expect.arrayContaining(['driverBookings: 1', 'properties: 1']));
    expect(preview?.actions.RETIRE_UNUSED).toBe(false);
  });

  it('checks payout tables without User relations and verified destinations', async () => {
    const preview = await inspectAccountLifecycle(inspectionDb({ payoutReleases: 1, verifiedPayoutAccounts: 1 }) as any, 42);
    expect(preview?.blockers).toEqual(expect.arrayContaining(['payoutReleases: 1', 'verifiedPayoutAccounts: 1']));
    expect(preview?.actions.CORRECT_TO_TRAVELLER).toBe(false);
  });

  it('blocks admin accounts and referral beneficiaries', async () => {
    const preview = await inspectAccountLifecycle(inspectionDb({ role: 'ADMIN', referredUsers: 1 }) as any, 42);
    expect(preview?.blockers).toEqual(expect.arrayContaining(['Role ADMIN requires manual review', 'referredUsers: 1']));
    expect(preview?.actions.RETIRE_UNUSED).toBe(false);
  });

  it('blocks suspended accounts, safety history and legal holds', async () => {
    const preview = await inspectAccountLifecycle(inspectionDb({ suspended: true, counts: { driverReminders: 1 }, legalHoldAudits: 1 }) as any, 42);
    expect(preview?.blockers).toEqual(expect.arrayContaining([
      'Existing account restriction requires review', 'driverReminders: 1', 'legalHoldAudits: 1',
    ]));
    expect(preview?.actions.RETIRE_UNUSED).toBe(false);
  });

  it('performs no mutation when a payout release appears before commit', async () => {
    const db = transactionDb({ payoutReleases: 1 });
    prismaMock.$transaction.mockImplementationOnce((run: (tx: any) => Promise<unknown>) => run(db));
    await expect(applyAccountLifecycle({ userId: 42, adminId: 7, action: 'CORRECT_TO_TRAVELLER', caseReference: 'CASE-1', reason: 'Mistaken registration verified by support' }))
      .rejects.toBeInstanceOf(LifecycleBlocked);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.payoutAccount.deleteMany).not.toHaveBeenCalled();
  });

  it('corrects an unused owner and revokes all sessions in the transaction', async () => {
    const db = transactionDb({ role: 'OWNER' });
    prismaMock.$transaction.mockImplementationOnce((run: (tx: any) => Promise<unknown>) => run(db));
    const result = await applyAccountLifecycle({ userId: 42, adminId: 7, action: 'CORRECT_TO_TRAVELLER', caseReference: 'CASE-2', reason: 'Owner registered by mistake; identity verified' });
    expect(result?.role).toBe('CUSTOMER');
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'CUSTOMER', payout: expect.anything(), tokensValidAfter: expect.any(Date) }) }));
    expect(db.session.updateMany).toHaveBeenCalledWith({ where: { userId: 42, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(db.adminAudit.create).toHaveBeenCalledOnce();
  });

  it('retires an unused account without deleting the User or audit row', async () => {
    const db = transactionDb({ role: 'CUSTOMER' });
    prismaMock.$transaction.mockImplementationOnce((run: (tx: any) => Promise<unknown>) => run(db));
    const result = await applyAccountLifecycle({ userId: 42, adminId: 7, action: 'RETIRE_UNUSED', caseReference: 'CASE-3', reason: 'Unused duplicate account; holder identity verified' });
    expect(result?.retired).toBe(true);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDisabled: true, deletedAt: expect.any(Date), phone: null, passwordHash: null }) }));
    expect(db.savedProperty.deleteMany).toHaveBeenCalledWith({ where: { userId: 42 } });
    expect(db.session.updateMany).toHaveBeenCalledOnce();
    expect(db.adminAudit.create).toHaveBeenCalledOnce();
  });
});
