import type { PrismaClient } from '@prisma/client';

import { normalizeUserEmail } from './constants';

type Db = PrismaClient;

export type ChallengeUsersStatus = 'all' | 'in_progress' | 'completed';

export async function listChallengeCatalog(prisma: Db) {
  const challenges = await prisma.challenge.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      type: true,
      target: true,
      pointsReward: true,
      isActive: true,
      _count: { select: { userChallenges: true } },
    },
  });

  return {
    challenges: challenges.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      type: row.type,
      target: row.target,
      pointsReward: row.pointsReward,
      isActive: row.isActive,
      userCount: row._count.userChallenges,
    })),
  };
}

export async function listChallengeUsers(
  prisma: Db,
  input: {
    email?: string;
    challengeId?: number;
    challengeCode?: string;
    status?: ChallengeUsersStatus;
    take?: number;
  },
) {
  const email = normalizeUserEmail(input.email);
  const challengeCode = input.challengeCode?.trim() || undefined;
  const challengeId =
    Number.isFinite(input.challengeId) && (input.challengeId as number) > 0
      ? Number(input.challengeId)
      : undefined;
  const status: ChallengeUsersStatus = input.status ?? 'all';
  const take = Math.min(Math.max(input.take ?? 200, 1), 500);

  if (!email && !challengeId && !challengeCode) {
    throw new Error('Provide email and/or challengeId/challengeCode');
  }

  const challengeFilter =
    challengeId || challengeCode
      ? {
          ...(challengeId ? { id: challengeId } : {}),
          ...(challengeCode ? { code: challengeCode } : {}),
        }
      : undefined;

  const where = {
    ...(email
      ? {
          account: {
            OR: [
              { userEmail: { contains: email, mode: 'insensitive' as const } },
              { userId: { contains: email, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
    ...(challengeFilter ? { challenge: challengeFilter } : {}),
    ...(status === 'completed'
      ? { completedAt: { not: null } }
      : status === 'in_progress'
        ? { completedAt: null }
        : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.userChallenge.count({ where }),
    prisma.userChallenge.findMany({
      where,
      orderBy: [{ completedAt: 'asc' }, { id: 'desc' }],
      take,
      include: {
        account: {
          select: {
            id: true,
            userEmail: true,
            userId: true,
            balance: true,
            lifetimeEarned: true,
            confirmedReceiptCount: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        challenge: {
          select: {
            id: true,
            code: true,
            title: true,
            target: true,
            pointsReward: true,
            isActive: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    take,
    truncated: total > rows.length,
    filters: {
      email: email || null,
      challengeId: challengeId || null,
      challengeCode: challengeCode || null,
      status,
    },
    users: rows.map((row) => ({
      accountId: row.account.id,
      userEmail: row.account.userEmail,
      userId: row.account.userId,
      balance: row.account.balance,
      lifetimeEarned: row.account.lifetimeEarned,
      confirmedReceiptCount: row.account.confirmedReceiptCount,
      accountCreatedAt: row.account.createdAt.toISOString(),
      challengeId: row.challenge.id,
      challengeCode: row.challenge.code,
      challengeTitle: row.challenge.title,
      target: row.challenge.target,
      pointsReward: row.challenge.pointsReward,
      progress: row.progress,
      completed: row.completedAt != null,
      completedAt: row.completedAt?.toISOString() ?? null,
      rewardGrantedAt: row.rewardGrantedAt?.toISOString() ?? null,
    })),
  };
}
