import type { PrismaClient, UserPointsAccount } from '@prisma/client';

export const RECEIPT_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
} as const;

export type ReceiptStatusValue = (typeof RECEIPT_STATUS)[keyof typeof RECEIPT_STATUS];

export const FIRST_CONFIRMED_RECEIPT_POINTS = 20;
export const CONFIRMED_RECEIPT_POINTS = 10;
export const PAVLAKA_POINTS_COST = 100;
export const PAVLAKA_REWARD_CODE = 'pavlaka';

export function normalizeUserEmail(email: string | null | undefined): string | null {
  const t = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return t || null;
}

export async function ensurePointsAccount(
  prisma: PrismaClient,
  opts: { userEmail?: string | null; userId?: string | null }
): Promise<UserPointsAccount> {
  const userEmail = normalizeUserEmail(opts.userEmail);
  const userId = opts.userId?.trim() || null;
  if (!userEmail && !userId) {
    throw new Error('userEmail or userId is required for points account');
  }

  if (userEmail) {
    const byEmail = await prisma.userPointsAccount.findUnique({ where: { userEmail } });
    if (byEmail) {
      if (userId && !byEmail.userId) {
        return prisma.userPointsAccount.update({
          where: { id: byEmail.id },
          data: { userId },
        });
      }
      return byEmail;
    }
  }

  if (userId) {
    const byId = await prisma.userPointsAccount.findUnique({ where: { userId } });
    if (byId) {
      if (userEmail && !byId.userEmail) {
        return prisma.userPointsAccount.update({
          where: { id: byId.id },
          data: { userEmail },
        });
      }
      return byId;
    }
  }

  return prisma.userPointsAccount.create({
    data: {
      userEmail,
      userId,
    },
  });
}
