import type { PrismaClient } from '@prisma/client';

import { normalizeUserEmail } from './constants';

type Db = PrismaClient;

export type ChallengeUsersStatus = 'all' | 'in_progress' | 'completed';

/** Main user-facing challenge order (skip retired / off codes). */
const CHALLENGE_PIPELINE = [
  'first_confirmed_receipt',
  'two_receipts_1500_10d',
  'receipt_3000_any_store',
  'points_to_pavlaka',
] as const;

export async function listChallengeCatalog(prisma: Db) {
  const challenges = await prisma.challenge.findMany({
    where: { isActive: true },
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

  const order = new Map(CHALLENGE_PIPELINE.map((code, i) => [code, i]));
  challenges.sort((a, b) => {
    const ai = order.has(a.code) ? (order.get(a.code) as number) : 999;
    const bi = order.has(b.code) ? (order.get(b.code) as number) : 999;
    if (ai !== bi) return ai - bi;
    return a.id - b.id;
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

function mapUserChallengeRow(row: {
  account: {
    id: number;
    userEmail: string | null;
    userId: string | null;
    balance: number;
    lifetimeEarned: number;
    confirmedReceiptCount: number;
    createdAt: Date;
  };
  challenge: {
    id: number;
    code: string;
    title: string;
    target: number;
    pointsReward: number;
    isActive: boolean;
  };
  progress: number;
  completedAt: Date | null;
  rewardGrantedAt: Date | null;
}) {
  return {
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
  };
}

/**
 * One row per matched account: current challenge in the pipeline + points.
 * "Current" = first incomplete active challenge in CHALLENGE_PIPELINE.
 */
async function listAccountsCurrentState(
  prisma: Db,
  email: string,
  take: number,
) {
  const accounts = await prisma.userPointsAccount.findMany({
    where: {
      OR: [
        { userEmail: { contains: email, mode: 'insensitive' } },
        { userId: { contains: email, mode: 'insensitive' } },
      ],
    },
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      userEmail: true,
      userId: true,
      balance: true,
      lifetimeEarned: true,
      confirmedReceiptCount: true,
      createdAt: true,
      userChallenges: {
        include: {
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
      },
    },
  });

  const catalog = await prisma.challenge.findMany({
    where: { code: { in: [...CHALLENGE_PIPELINE] } },
    select: {
      id: true,
      code: true,
      title: true,
      target: true,
      pointsReward: true,
      isActive: true,
    },
  });
  const byCode = new Map(catalog.map((c) => [c.code, c]));

  const users = accounts.map((account) => {
    const ucByCode = new Map(
      account.userChallenges.map((uc) => [uc.challenge.code, uc]),
    );

    let current = null as null | ReturnType<typeof mapUserChallengeRow>;
    let completedCount = 0;

    for (const code of CHALLENGE_PIPELINE) {
      const challenge = byCode.get(code);
      if (!challenge || !challenge.isActive) continue;
      const uc = ucByCode.get(code);
      if (uc?.completedAt) {
        completedCount += 1;
        continue;
      }
      current = mapUserChallengeRow({
        account,
        challenge,
        progress: uc?.progress ?? 0,
        completedAt: null,
        rewardGrantedAt: uc?.rewardGrantedAt ?? null,
      });
      break;
    }

    if (!current) {
      const lastCode = [...CHALLENGE_PIPELINE].reverse().find((code) => {
        const ch = byCode.get(code);
        return ch && ch.isActive;
      });
      const lastChallenge = lastCode ? byCode.get(lastCode)! : null;
      const lastUc = lastCode ? ucByCode.get(lastCode) : null;
      if (lastChallenge) {
        current = mapUserChallengeRow({
          account,
          challenge: lastChallenge,
          progress: lastUc?.progress ?? lastChallenge.target,
          completedAt: lastUc?.completedAt ?? new Date(),
          rewardGrantedAt: lastUc?.rewardGrantedAt ?? null,
        });
      }
    }

    return {
      ...(current ?? {
        accountId: account.id,
        userEmail: account.userEmail,
        userId: account.userId,
        balance: account.balance,
        lifetimeEarned: account.lifetimeEarned,
        confirmedReceiptCount: account.confirmedReceiptCount,
        accountCreatedAt: account.createdAt.toISOString(),
        challengeId: null,
        challengeCode: null,
        challengeTitle: 'Nema aktivnog izazova',
        target: 0,
        pointsReward: 0,
        progress: 0,
        completed: true,
        completedAt: null,
        rewardGrantedAt: null,
      }),
      pipelineCompletedCount: completedCount,
      pipelineTotal: CHALLENGE_PIPELINE.filter((code) => {
        const ch = byCode.get(code);
        return ch?.isActive;
      }).length,
      currentState: true as const,
    };
  });

  return {
    total: users.length,
    take,
    truncated: false,
    filters: {
      email,
      challengeId: null,
      challengeCode: null,
      status: 'all' as ChallengeUsersStatus,
    },
    users,
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

  // Email-only: one row per account with current challenge state.
  if (email && !challengeId && !challengeCode) {
    return listAccountsCurrentState(prisma, email, take);
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
    users: rows.map((row) => mapUserChallengeRow(row)),
  };
}
