import type { PrismaClient } from '@prisma/client';

import { PAVLAKA_POINTS_COST, PAVLAKA_REWARD_CODE } from './constants';

/** Idempotent seed of default challenges + pavlaka reward (safe on every boot). */
export async function ensureReceiptRewardsCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.challenge.upsert({
    where: { code: 'first_confirmed_receipt' },
    create: {
      code: 'first_confirmed_receipt',
      title: 'Skeniraj prvi račun',
      description: 'Potvrdi prvi fiskalni račun i osvoji bonus poene.',
      type: 'first_confirmed_receipt',
      target: 1,
      pointsReward: 0,
      isActive: true,
    },
    update: {},
  });

  await prisma.challenge.upsert({
    where: { code: 'confirmed_receipts_2' },
    create: {
      code: 'confirmed_receipts_2',
      title: 'Potvrdi 2 računa',
      description: 'Sakupi 2 admin-potvrđena računa.',
      type: 'confirmed_receipt_count',
      target: 2,
      pointsReward: 0,
      isActive: true,
    },
    update: {},
  });

  await prisma.challenge.upsert({
    where: { code: 'points_to_pavlaka' },
    create: {
      code: 'points_to_pavlaka',
      title: 'Sakupi 100 poena',
      description: 'Osvoji besplatnu pavlaku kada sakupiš 100 poena.',
      type: 'points_balance_lifetime',
      target: PAVLAKA_POINTS_COST,
      pointsReward: 0,
      isActive: true,
    },
    update: {},
  });

  await prisma.reward.upsert({
    where: { code: PAVLAKA_REWARD_CODE },
    create: {
      code: PAVLAKA_REWARD_CODE,
      title: 'Besplatna pavlaka',
      description: 'Nagrada za sakupljenih 100 poena iz potvrđenih računa.',
      pointsCost: PAVLAKA_POINTS_COST,
      isActive: true,
    },
    update: {},
  });
}
