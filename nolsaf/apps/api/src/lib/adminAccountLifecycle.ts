import { Prisma } from '@prisma/client';
import { prisma } from '@nolsaf/prisma';
import { invalidateAuthSessionCacheForUser } from './authSessionCache.js';
import { retentionFields } from './auditRetention.js';

export type LifecycleAction = 'CORRECT_TO_TRAVELLER' | 'RETIRE_UNUSED';
type Db = Prisma.TransactionClient;

// These records do not establish a commercial or privileged relationship. They
// remain in place for their normal retention period; sessions are revoked.
const NON_BLOCKING_RELATIONS = new Set([
  'sessions', 'passkeys', 'pushDevices', 'emailVerificationTokens', 'phoneOtps',
  'notifications', 'ownerNotifications', 'auditLogs', 'savedProperties',
]);

// Prisma's `_count: true` joins every User list relation in one statement.
// This schema has far more than MySQL's 61-table join limit, so inspect a
// bounded group at a time. Runtime model metadata keeps new list relations
// covered; singular relations are checked explicitly below.
const SINGULAR_USER_RELATIONS = new Set(['agentProfile', 'salesPartnerProfile', 'driverLiveLocation']);
const USER_COUNT_RELATIONS = Prisma.dmmf.datamodel.models
  .find((model) => model.name === 'User')?.fields
  .filter((field) => field.kind === 'object' && !SINGULAR_USER_RELATIONS.has(field.name))
  .map((field) => field.name) ?? [];
const RELATION_COUNT_BATCH_SIZE = 16;

async function countUserRelations(db: Db | typeof prisma, userId: number): Promise<Record<string, number>> {
  if (USER_COUNT_RELATIONS.length === 0) throw new Error('User relation metadata is unavailable');
  const batches: string[][] = [];
  for (let i = 0; i < USER_COUNT_RELATIONS.length; i += RELATION_COUNT_BATCH_SIZE) {
    batches.push(USER_COUNT_RELATIONS.slice(i, i + RELATION_COUNT_BATCH_SIZE));
  }
  const rows = await Promise.all(batches.map((names) => db.user.findUnique({
    where: { id: userId },
    select: { _count: { select: Object.fromEntries(names.map((name) => [name, true])) } },
  } as any))) as Array<{ _count?: Record<string, number> } | null>;
  if (rows.some((row) => !row?._count)) throw new Error('User relation counts are unavailable');
  return Object.assign({}, ...rows.map((row) => row!._count!));
}

export class LifecycleBlocked extends Error {
  constructor(public blockers: string[]) {
    super('Account has records requiring manual review');
  }
}

export async function inspectAccountLifecycle(db: Db | typeof prisma, userId: number) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, role: true, deletedAt: true, isDisabled: true, suspendedAt: true, kycStatus: true,
      email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true,
      agentProfile: { select: { id: true } },
      salesPartnerProfile: { select: { id: true } },
      driverLiveLocation: { select: { driverId: true } },
    },
  });
  if (!user) return null;

  const relationCounts = await countUserRelations(db, userId);

  const blockers: string[] = [];
  if (!['OWNER', 'DRIVER', 'CUSTOMER'].includes(user.role)) blockers.push(`Role ${user.role} requires manual review`);
  if (user.deletedAt) blockers.push('Account is already retired');
  if (user.isDisabled || user.suspendedAt) blockers.push('Existing account restriction requires review');
  if (user.kycStatus) blockers.push('KYC review exists');
  if (user.agentProfile) blockers.push('Agent profile exists');
  if (user.salesPartnerProfile) blockers.push('Sales partner profile exists');

  for (const [relation, count] of Object.entries(relationCounts)) {
    if (count > 0 && !NON_BLOCKING_RELATIONS.has(relation) && relation !== 'payoutAccounts') {
      blockers.push(`${relation}: ${count}`);
    }
  }

  // These money and referral records deliberately have no Prisma User relation.
  // A broad User._count check alone would miss them.
  const [releases, withdrawalJobs, challenges, recoveries, payoutDisbursements, verifiedPayoutAccounts, referredUsers, restrictions, karibuGestures, offlineMutations, portfolios, guestCodeRequests, activeSupportHandoffs, legalHoldAudits, legalHoldAdminAudits, otpGuard] = await Promise.all([
    db.payoutRelease.count({ where: { ownerId: userId } }),
    db.payoutWithdrawalJob.count({ where: { ownerId: userId } }),
    db.payoutWithdrawalChallenge.count({ where: { userId } }),
    db.ownerPayoutRecovery.count({ where: { ownerId: userId } }),
    db.payoutAccount.count({ where: { userId, disbursements: { some: {} } } }),
    db.payoutAccount.count({ where: { userId, OR: [{ isVerified: true }, { verifiedAt: { not: null } }] } }),
    db.user.count({ where: { referredBy: userId } }),
    db.platformRestrictionCase.count({ where: { ownerId: userId } }),
    db.karibuGesture.count({ where: { userId } }),
    db.nrmsOfflineMutation.count({ where: { userId } }),
    db.nrmsPortfolio.count({ where: { ownerId: userId } }),
    db.guestCodeRequest.count({ where: { ownerId: userId } }),
    db.supportImpersonationHandoff.count({ where: { supportUserId: userId, usedAt: null, expiresAt: { gt: new Date() } } }),
    db.auditLog.count({ where: { legalHoldAt: { not: null }, OR: [{ actorId: userId }, { entity: 'User', entityId: userId }] } }),
    db.adminAudit.count({ where: { targetUserId: userId, legalHoldAt: { not: null } } }),
    db.payoutWithdrawalOtpGuard.findUnique({ where: { ownerId: userId }, select: { failedAttempts: true, lockedAt: true } }),
  ]);
  for (const [name, count] of Object.entries({ payoutReleases: releases, payoutWithdrawalJobs: withdrawalJobs, payoutWithdrawalChallenges: challenges, ownerPayoutRecoveries: recoveries, payoutDisbursements, verifiedPayoutAccounts, referredUsers, restrictions, karibuGestures, offlineMutations, portfolios, guestCodeRequests, activeSupportHandoffs, legalHoldAudits, legalHoldAdminAudits })) {
    if (count > 0) blockers.push(`${name}: ${count}`);
  }
  if (otpGuard?.failedAttempts || otpGuard?.lockedAt) blockers.push('Payout OTP security review exists');

  return {
    user,
    blockers,
    actions: {
      CORRECT_TO_TRAVELLER: ['OWNER', 'DRIVER'].includes(user.role) && blockers.length === 0,
      RETIRE_UNUSED: blockers.length === 0,
    },
  };
}

export async function applyAccountLifecycle(input: {
  userId: number; adminId: number; action: LifecycleAction; caseReference: string; reason: string;
}) {
  const { userId, adminId, action, caseReference, reason } = input;
  if (userId === adminId) throw new LifecycleBlocked(['Administrators cannot change their own account']);

  const result = await prisma.$transaction(async (tx) => {
    // Lock before recomputing eligibility. InnoDB serializable isolation also
    // prevents a new related record from silently passing the checked snapshot.
    await tx.$queryRaw`SELECT id FROM user WHERE id = ${userId} FOR UPDATE`;
    const inspection = await inspectAccountLifecycle(tx, userId);
    if (!inspection) return null;
    if (!inspection.actions[action]) {
      throw new LifecycleBlocked(inspection.blockers.length ? inspection.blockers : ['Action is unavailable for this role']);
    }
    const now = new Date();
    const previousRole = inspection.user.role;

    // An unused payout destination has no money history and cannot survive a
    // role correction or account retirement as a usable payout destination.
    await tx.payoutAccount.deleteMany({ where: { userId } });
    await tx.payoutWithdrawalOtpGuard.deleteMany({ where: { ownerId: userId } });
    await tx.driverLiveLocation.deleteMany({ where: { driverId: userId } });

    const roleSpecific = {
      tin: null, address: null, gender: null, nationality: null, nin: null,
      licenseNumber: null, plateNumber: null, vehicleType: null, vehicleMake: null,
      vehiclePlate: null, operationArea: null, paymentPhone: null, paymentVerified: false,
      rating: null, available: false, isAvailable: false, isVipDriver: false,
      driverGoals: Prisma.DbNull, payout: Prisma.DbNull,
    } as const;
    const retired = action === 'RETIRE_UNUSED';
    await tx.user.update({
      where: { id: userId },
      data: retired ? {
        ...roleSpecific, isDisabled: true, deletedAt: now,
        name: 'Retired account', fullName: null, email: `retired-${userId}@deleted.nolsaf.invalid`,
        phone: null, passwordHash: null, avatarUrl: null, dateOfBirth: null,
        region: null, district: null, emailVerifiedAt: null, phoneVerifiedAt: null,
        twoFactorEnabled: false, twoFactorSecret: null, twoFactorMethod: null,
        totpSecretEnc: null, backupCodesHash: Prisma.DbNull, sms2faEnabled: false,
        previousPasswordHashes: Prisma.DbNull, previousPasswords: Prisma.DbNull,
        resetPasswordToken: null, resetPasswordExpires: null,
        notificationPrefs: Prisma.DbNull, languages: Prisma.DbNull,
        referralCode: null, referredBy: null, tokensValidAfter: now,
      } : { ...roleSpecific, role: 'CUSTOMER', referralCode: null, tokensValidAfter: now },
    });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.pushDevice.updateMany({ where: { userId }, data: { active: false } });
    if (retired) {
      await tx.karibuGuestPreference.deleteMany({ where: { userId } });
      await tx.savedProperty.deleteMany({ where: { userId } });
      await tx.passkey.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.phoneOtp.deleteMany({ where: { userId } });
    }

    const audit = {
      adminId, targetUserId: userId,
      action: retired ? 'RETIRE_UNUSED_USER' : 'CORRECT_USER_TO_TRAVELLER',
      details: { caseReference, reason, previousRole, nextRole: retired ? null : 'CUSTOMER' },
      ...retentionFields('SECURITY', now),
    };
    await tx.adminAudit.create({ data: audit });
    return { id: userId, previousRole, role: retired ? previousRole : 'CUSTOMER', retired, email: inspection.user.emailVerifiedAt ? inspection.user.email : null, phone: inspection.user.phoneVerifiedAt ? inspection.user.phone : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });

  if (result) {
    await invalidateAuthSessionCacheForUser(userId).catch(() => {});
    const io = (global as any).io;
    if (io?.in) {
      try {
        const sockets = await io.in(`user:${userId}`).fetchSockets();
        await Promise.all(sockets.map(async (socket: any) => { socket.emit('session:expired', { code: 'SESSION_REVOKED' }); socket.disconnect(true); }));
      } catch { /* Database revocation remains authoritative. */ }
    }
  }
  return result;
}
