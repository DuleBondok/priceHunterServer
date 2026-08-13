import type { Prisma, PrismaClient } from '@prisma/client';

import {
  CONFIRMED_RECEIPT_POINTS,
  FIRST_CONFIRMED_RECEIPT_POINTS,
  PAVLAKA_POINTS_COST,
  PAVLAKA_REWARD_CODE,
  RECEIPT_STATUS,
  ensurePointsAccount,
  normalizeUserEmail,
} from './constants';

export type ConfirmItemInput = {
  id: string;
  productId: string;
  name: string;
  expectedQuantity: number;
  confirmed: boolean;
};

export type ConfirmReceiptResult =
  | { ok: true; receiptId: number; status: string; pointsAwarded: number; balance: number }
  | { ok: false; code: string; message: string };

function toDecimal(n: number | null | undefined): Prisma.Decimal | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n as unknown as Prisma.Decimal;
}

/**
 * Admin confirm: atomic status flip + confirmed items + points ledger + challenge progress.
 * Idempotent: re-confirm of already-confirmed receipt returns current state without re-awarding.
 */
export async function confirmReceiptScan(
  prisma: PrismaClient,
  opts: {
    receiptId: number;
    confirmedBy: string;
    itemConfirmations: ConfirmItemInput[];
  }
): Promise<ConfirmReceiptResult> {
  const receiptId = opts.receiptId;
  if (!Number.isFinite(receiptId) || receiptId <= 0) {
    return { ok: false, code: 'INVALID_ID', message: 'Invalid receipt scan id' };
  }

  const confirmedLines = opts.itemConfirmations.filter((x) => x.confirmed);
  if (confirmedLines.length === 0) {
    return {
      ok: false,
      code: 'NO_CONFIRMED_ITEMS',
      message: 'At least one cart item must be confirmed',
    };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.receiptScan.findUnique({ where: { id: receiptId } });
    if (!existing) {
      return { ok: false, code: 'NOT_FOUND', message: 'Receipt not found' };
    }

    if (existing.status === RECEIPT_STATUS.REJECTED) {
      return { ok: false, code: 'ALREADY_REJECTED', message: 'Receipt was rejected' };
    }

    const email = normalizeUserEmail(existing.userEmail);
    const userId = existing.userId?.trim() || null;

    // Already confirmed: do not re-award points.
    if (existing.status === RECEIPT_STATUS.CONFIRMED) {
      let balance = 0;
      if (email || userId) {
        const account = await ensurePointsAccount(tx as unknown as PrismaClient, {
          userEmail: email,
          userId,
        });
        balance = account.balance;
      }
      return {
        ok: true,
        receiptId,
        status: RECEIPT_STATUS.CONFIRMED,
        pointsAwarded: 0,
        balance,
      };
    }

    const legacyConfirmations = opts.itemConfirmations.map((entry) => ({
      id: entry.id,
      productId: entry.productId,
      name: entry.name,
      expectedQuantity: Math.max(1, Math.floor(entry.expectedQuantity || 1)),
      confirmed: Boolean(entry.confirmed),
    }));

    await tx.receiptConfirmedItem.deleteMany({ where: { receiptId } });
    await tx.receiptConfirmedItem.createMany({
      data: confirmedLines.map((line) => ({
        receiptId,
        lineId: line.id,
        productId: line.productId,
        productName: line.name,
        quantity: Math.max(1, Math.floor(line.expectedQuantity || 1)),
      })),
    });

    await tx.receiptScan.update({
      where: { id: receiptId },
      data: {
        status: RECEIPT_STATUS.CONFIRMED,
        itemConfirmations: legacyConfirmations,
        confirmedBy: opts.confirmedBy || 'admin',
        confirmedAt: new Date(),
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
        // Spent/saved filled when catalog pricing is available server-side; nullable for now.
        confirmedSpentRsd: toDecimal(null),
        confirmedSavedRsd: toDecimal(null),
      },
    });

    let pointsAwarded = 0;
    let balance = 0;

    if (email || userId) {
      const account = await ensurePointsAccount(tx as unknown as PrismaClient, {
        userEmail: email,
        userId,
      });

      const isFirst = account.confirmedReceiptCount === 0;
      pointsAwarded = isFirst ? FIRST_CONFIRMED_RECEIPT_POINTS : CONFIRMED_RECEIPT_POINTS;
      const idempotencyKey = `confirmed_receipt:${receiptId}`;

      const existingTx = await tx.userPointsTransaction.findUnique({
        where: { idempotencyKey },
      });

      if (!existingTx) {
        await tx.userPointsTransaction.create({
          data: {
            accountId: account.id,
            amount: pointsAwarded,
            type: isFirst ? 'FIRST_CONFIRMED_RECEIPT' : 'CONFIRMED_RECEIPT',
            receiptId,
            idempotencyKey,
            description: isFirst
              ? 'Prvi potvrđeni fiskalni račun'
              : 'Potvrđen fiskalni račun',
          },
        });

        const updated = await tx.userPointsAccount.update({
          where: { id: account.id },
          data: {
            balance: { increment: pointsAwarded },
            lifetimeEarned: { increment: pointsAwarded },
            confirmedReceiptCount: { increment: 1 },
          },
        });
        balance = updated.balance;

        await tx.receiptScan.update({
          where: { id: receiptId },
          data: { pointsGrantedAt: new Date() },
        });

        await syncChallengesAfterConfirmedReceipt(tx as unknown as PrismaClient, updated.id);
        const afterRedeem = await maybeUnlockPavlaka(tx as unknown as PrismaClient, updated.id);
        balance = afterRedeem.balance;
      } else {
        balance = account.balance;
        pointsAwarded = 0;
      }
    }

    return {
      ok: true,
      receiptId,
      status: RECEIPT_STATUS.CONFIRMED,
      pointsAwarded,
      balance,
    };
  });
}

export type RejectReceiptResult =
  | { ok: true; receiptId: number; status: string }
  | { ok: false; code: string; message: string };

export async function rejectReceiptScan(
  prisma: PrismaClient,
  opts: { receiptId: number; rejectedBy: string; reason: string }
): Promise<RejectReceiptResult> {
  const receiptId = opts.receiptId;
  const reason = opts.reason.trim();
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'rejection reason is required' };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.receiptScan.findUnique({ where: { id: receiptId } });
    if (!existing) {
      return { ok: false, code: 'NOT_FOUND', message: 'Receipt not found' };
    }
    if (existing.status === RECEIPT_STATUS.CONFIRMED) {
      return {
        ok: false,
        code: 'ALREADY_CONFIRMED',
        message: 'Cannot reject a confirmed receipt',
      };
    }
    if (existing.status === RECEIPT_STATUS.REJECTED) {
      return { ok: true, receiptId, status: RECEIPT_STATUS.REJECTED };
    }

    await tx.receiptScan.update({
      where: { id: receiptId },
      data: {
        status: RECEIPT_STATUS.REJECTED,
        rejectedBy: opts.rejectedBy || 'admin',
        rejectedAt: new Date(),
        rejectionReason: reason.slice(0, 2000),
      },
    });

    return { ok: true, receiptId, status: RECEIPT_STATUS.REJECTED };
  });
}

async function syncChallengesAfterConfirmedReceipt(
  prisma: PrismaClient,
  accountId: number
): Promise<void> {
  const account = await prisma.userPointsAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  const challenges = await prisma.challenge.findMany({ where: { isActive: true } });
  for (const challenge of challenges) {
    let progress = 0;
    if (challenge.type === 'first_confirmed_receipt') {
      progress = account.confirmedReceiptCount >= 1 ? 1 : 0;
    } else if (challenge.type === 'confirmed_receipt_count') {
      progress = account.confirmedReceiptCount;
    } else if (challenge.type === 'points_balance_lifetime') {
      progress = account.lifetimeEarned;
    } else {
      continue;
    }

    const completed = progress >= challenge.target;
    await prisma.userChallenge.upsert({
      where: {
        accountId_challengeId: { accountId, challengeId: challenge.id },
      },
      create: {
        accountId,
        challengeId: challenge.id,
        progress,
        completedAt: completed ? new Date() : null,
      },
      update: {
        progress,
        completedAt: completed ? new Date() : null,
      },
    });
  }
}

/**
 * When lifetime/balance reaches pavlaka cost and reward not yet unlocked:
 * debit balance, unlock UserReward. Idempotent via ledger key.
 */
async function maybeUnlockPavlaka(
  prisma: PrismaClient,
  accountId: number
): Promise<{ balance: number }> {
  const account = await prisma.userPointsAccount.findUnique({ where: { id: accountId } });
  if (!account) return { balance: 0 };
  if (account.balance < PAVLAKA_POINTS_COST) return { balance: account.balance };

  const reward = await prisma.reward.findUnique({ where: { code: PAVLAKA_REWARD_CODE } });
  if (!reward || !reward.isActive) return { balance: account.balance };

  const existing = await prisma.userReward.findUnique({
    where: { accountId_rewardId: { accountId, rewardId: reward.id } },
  });
  if (existing) return { balance: account.balance };

  const idempotencyKey = `reward_unlock:${PAVLAKA_REWARD_CODE}:account:${accountId}`;
  const existingTx = await prisma.userPointsTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existingTx) return { balance: account.balance };

  await prisma.userPointsTransaction.create({
    data: {
      accountId,
      amount: -PAVLAKA_POINTS_COST,
      type: 'REWARD_REDEEMED',
      rewardId: reward.id,
      idempotencyKey,
      description: 'Otključana nagrada: Besplatna pavlaka',
    },
  });

  const updated = await prisma.userPointsAccount.update({
    where: { id: accountId },
    data: { balance: { decrement: PAVLAKA_POINTS_COST } },
  });

  await prisma.userReward.create({
    data: {
      accountId,
      rewardId: reward.id,
      unlockedAt: new Date(),
    },
  });

  // Mark points_to_pavlaka challenge reward granted if present.
  const challenge = await prisma.challenge.findUnique({ where: { code: 'points_to_pavlaka' } });
  if (challenge) {
    await prisma.userChallenge.upsert({
      where: {
        accountId_challengeId: { accountId, challengeId: challenge.id },
      },
      create: {
        accountId,
        challengeId: challenge.id,
        progress: account.lifetimeEarned,
        completedAt: new Date(),
        rewardGrantedAt: new Date(),
      },
      update: {
        progress: Math.max(account.lifetimeEarned, challenge.target),
        completedAt: new Date(),
        rewardGrantedAt: new Date(),
      },
    });
  }

  return { balance: updated.balance };
}

/** Backfill ledger from already-confirmed Neon receipts (migration helper). */
export async function backfillPointsFromConfirmedReceipts(
  prisma: PrismaClient,
  userEmail: string
): Promise<{ processed: number; balance: number }> {
  const email = normalizeUserEmail(userEmail);
  if (!email) return { processed: 0, balance: 0 };

  const confirmed = await prisma.receiptScan.findMany({
    where: { userEmail: email, status: RECEIPT_STATUS.CONFIRMED },
    orderBy: { confirmedAt: 'asc' },
    select: {
      id: true,
      itemConfirmations: true,
      confirmedBy: true,
      pointsGrantedAt: true,
    },
  });

  let processed = 0;
  for (const row of confirmed) {
    if (row.pointsGrantedAt) continue;
    const icRaw = row.itemConfirmations;
    const items: ConfirmItemInput[] = Array.isArray(icRaw)
      ? (icRaw as ConfirmItemInput[]).map((e) => ({
          id: String((e as ConfirmItemInput).id ?? ''),
          productId: String((e as ConfirmItemInput).productId ?? ''),
          name: String((e as ConfirmItemInput).name ?? ''),
          expectedQuantity: Math.max(1, Math.floor(Number((e as ConfirmItemInput).expectedQuantity ?? 1))),
          confirmed: Boolean((e as ConfirmItemInput).confirmed),
        }))
      : [];

    // Force re-entry into award path by temporarily treating as pending in a nested flow:
    // use direct award via confirm with already-confirmed short-circuit — instead call internal award.
    // Simpler: reset status briefly is dangerous. Award via dedicated path:
    const account = await ensurePointsAccount(prisma, { userEmail: email });
    const idempotencyKey = `confirmed_receipt:${row.id}`;
    const exists = await prisma.userPointsTransaction.findUnique({ where: { idempotencyKey } });
    if (exists) {
      await prisma.receiptScan.update({
        where: { id: row.id },
        data: { pointsGrantedAt: new Date() },
      });
      continue;
    }

    // Temporarily set pending then confirm — riskier. Instead duplicate award logic:
    const isFirst = account.confirmedReceiptCount === 0;
    const pointsAwarded = isFirst ? FIRST_CONFIRMED_RECEIPT_POINTS : CONFIRMED_RECEIPT_POINTS;
    await prisma.$transaction(async (tx) => {
      await tx.userPointsTransaction.create({
        data: {
          accountId: account.id,
          amount: pointsAwarded,
          type: isFirst ? 'FIRST_CONFIRMED_RECEIPT' : 'CONFIRMED_RECEIPT',
          receiptId: row.id,
          idempotencyKey,
          description: 'Backfill: potvrđen račun',
        },
      });
      const updated = await tx.userPointsAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: pointsAwarded },
          lifetimeEarned: { increment: pointsAwarded },
          confirmedReceiptCount: { increment: 1 },
        },
      });
      await tx.receiptScan.update({
        where: { id: row.id },
        data: { pointsGrantedAt: new Date() },
      });
      if (items.length > 0) {
        await tx.receiptConfirmedItem.deleteMany({ where: { receiptId: row.id } });
        await tx.receiptConfirmedItem.createMany({
          data: items
            .filter((x) => x.confirmed)
            .map((line) => ({
              receiptId: row.id,
              lineId: line.id || `${line.productId}`,
              productId: line.productId,
              productName: line.name || line.productId,
              quantity: line.expectedQuantity,
            })),
        });
      }
      await syncChallengesAfterConfirmedReceipt(tx as unknown as PrismaClient, updated.id);
      await maybeUnlockPavlaka(tx as unknown as PrismaClient, updated.id);
    });
    processed += 1;
  }

  const account = await ensurePointsAccount(prisma, { userEmail: email });
  return { processed, balance: account.balance };
}
