import type { PrismaClient, UserPointsAccount } from '@prisma/client';

import { RECEIPT_STATUS, ensurePointsAccount, normalizeUserEmail } from './constants';

type Db = PrismaClient;

export async function getUserPointsSummary(
  prisma: Db,
  opts: { userEmail?: string | null; userId?: string | null }
) {
  const email = normalizeUserEmail(opts.userEmail);
  const userId = opts.userId?.trim() || null;
  if (!email && !userId) {
    return {
      balance: 0,
      lifetimeEarned: 0,
      confirmedReceiptCount: 0,
      scanCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      rewards: [] as Array<{ code: string; title: string; unlockedAt: string }>,
      challenges: [] as Array<{
        code: string;
        title: string;
        progress: number;
        target: number;
        completedAt: string | null;
      }>,
    };
  }

  const account = await ensurePointsAccount(prisma, { userEmail: email, userId });

  const whereUser =
    email && userId
      ? { OR: [{ userEmail: email }, { userId }] }
      : email
        ? { userEmail: email }
        : { userId: userId! };

  const [pendingCount, confirmedCount, rejectedCount, rewards, userChallenges] =
    await Promise.all([
      prisma.receiptScan.count({ where: { ...whereUser, status: RECEIPT_STATUS.PENDING } }),
      prisma.receiptScan.count({ where: { ...whereUser, status: RECEIPT_STATUS.CONFIRMED } }),
      prisma.receiptScan.count({ where: { ...whereUser, status: RECEIPT_STATUS.REJECTED } }),
      prisma.userReward.findMany({
        where: { accountId: account.id },
        include: { reward: true },
        orderBy: { unlockedAt: 'desc' },
      }),
      prisma.userChallenge.findMany({
        where: { accountId: account.id },
        include: { challenge: true },
      }),
    ]);

  return {
    balance: account.balance,
    lifetimeEarned: account.lifetimeEarned,
    confirmedReceiptCount: account.confirmedReceiptCount,
    /** All scans (any status) — reconstructable from ReceiptScan. */
    scanCount: pendingCount + confirmedCount + rejectedCount,
    pendingCount,
    rejectedCount,
    confirmedCount,
    rewards: rewards.map((r) => ({
      code: r.reward.code,
      title: r.reward.title,
      unlockedAt: r.unlockedAt.toISOString(),
      redeemedAt: r.redeemedAt?.toISOString() ?? null,
    })),
    challenges: userChallenges.map((uc) => ({
      code: uc.challenge.code,
      title: uc.challenge.title,
      description: uc.challenge.description,
      progress: uc.progress,
      target: uc.challenge.target,
      completedAt: uc.completedAt?.toISOString() ?? null,
      rewardGrantedAt: uc.rewardGrantedAt?.toISOString() ?? null,
    })),
  };
}

export async function getUserPointsLedger(
  prisma: Db,
  opts: { userEmail?: string | null; userId?: string | null; limit?: number }
) {
  const email = normalizeUserEmail(opts.userEmail);
  const userId = opts.userId?.trim() || null;
  if (!email && !userId) return [];

  let account: UserPointsAccount | null = null;
  if (email) {
    account = await prisma.userPointsAccount.findUnique({ where: { userEmail: email } });
  }
  if (!account && userId) {
    account = await prisma.userPointsAccount.findUnique({ where: { userId } });
  }
  if (!account) return [];

  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const rows = await prisma.userPointsTransaction.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    type: row.type,
    receiptId: row.receiptId,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  }));
}
