import prisma from "./prismaClient";

export type DuplicateStoreLinkProduct = {
  id: number;
  name: string;
  store: string;
  category: string;
  price: string | null;
  priceBeforeDiscount: string | null;
  image: string;
  isAvailable: boolean;
  lastSeenAt: string;
  consecutiveMissingDays: number;
  flaggedForReview: boolean;
};

export type DuplicateStoreLinkGroup = {
  standardizedProduct: {
    id: number;
    name: string;
    brand: string | null;
    volume: string | null;
    image: string | null;
    mainCategory: string | null;
    midCategory: string | null;
    subCategory: string | null;
  };
  store: string;
  products: DuplicateStoreLinkProduct[];
};

export type DuplicateStoreLinksResult = {
  groups: DuplicateStoreLinkGroup[];
  totalGroups: number;
  totalDuplicateProducts: number;
};

type ConflictKeyRow = {
  standardizedProductId: number;
  store: string;
  cnt: bigint | number;
};

/**
 * Find StandardizedProducts linked to 2+ Product rows from the same store.
 */
export async function getDuplicateStoreLinks(options?: {
  store?: string;
}): Promise<DuplicateStoreLinksResult> {
  const storeFilter = options?.store?.trim();

  const conflictKeys = storeFilter
    ? await prisma.$queryRaw<ConflictKeyRow[]>`
        SELECT "standardizedProductId", store, COUNT(*)::int AS cnt
        FROM "Product"
        WHERE "standardizedProductId" IS NOT NULL
          AND store ILIKE ${storeFilter}
        GROUP BY "standardizedProductId", store
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, "standardizedProductId" ASC
      `
    : await prisma.$queryRaw<ConflictKeyRow[]>`
        SELECT "standardizedProductId", store, COUNT(*)::int AS cnt
        FROM "Product"
        WHERE "standardizedProductId" IS NOT NULL
        GROUP BY "standardizedProductId", store
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, "standardizedProductId" ASC
      `;

  if (conflictKeys.length === 0) {
    return { groups: [], totalGroups: 0, totalDuplicateProducts: 0 };
  }

  const spIds = [...new Set(conflictKeys.map((r) => Number(r.standardizedProductId)))];

  const [standards, products] = await Promise.all([
    prisma.standardizedProduct.findMany({
      where: { id: { in: spIds } },
      select: {
        id: true,
        name: true,
        brand: true,
        volume: true,
        image: true,
        mainCategory: true,
        midCategory: true,
        subCategory: true,
      },
    }),
    prisma.product.findMany({
      where: {
        standardizedProductId: { in: spIds },
        ...(storeFilter
          ? { store: { equals: storeFilter, mode: "insensitive" as const } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        store: true,
        category: true,
        price: true,
        priceBeforeDiscount: true,
        image: true,
        isAvailable: true,
        lastSeenAt: true,
        consecutiveMissingDays: true,
        flaggedForReview: true,
        standardizedProductId: true,
      },
      orderBy: [{ store: "asc" }, { id: "asc" }],
    }),
  ]);

  const standardsById = new Map(standards.map((sp) => [sp.id, sp]));
  const conflictKeySet = new Set(
    conflictKeys.map((r) => `${Number(r.standardizedProductId)}::${r.store}`),
  );

  const productsByKey = new Map<string, typeof products>();
  for (const p of products) {
    if (p.standardizedProductId == null) continue;
    const key = `${p.standardizedProductId}::${p.store}`;
    if (!conflictKeySet.has(key)) continue;
    const list = productsByKey.get(key) ?? [];
    list.push(p);
    productsByKey.set(key, list);
  }

  const groups: DuplicateStoreLinkGroup[] = [];
  let totalDuplicateProducts = 0;

  for (const row of conflictKeys) {
    const spId = Number(row.standardizedProductId);
    const sp = standardsById.get(spId);
    if (!sp) continue;

    const key = `${spId}::${row.store}`;
    const linked = productsByKey.get(key) ?? [];
    if (linked.length < 2) continue;

    totalDuplicateProducts += linked.length;
    groups.push({
      standardizedProduct: {
        id: sp.id,
        name: sp.name,
        brand: sp.brand,
        volume: sp.volume,
        image: sp.image,
        mainCategory: sp.mainCategory,
        midCategory: sp.midCategory,
        subCategory: sp.subCategory,
      },
      store: row.store,
      products: linked.map((p) => ({
        id: p.id,
        name: p.name,
        store: p.store,
        category: p.category,
        price: p.price,
        priceBeforeDiscount:
          p.priceBeforeDiscount != null ? String(p.priceBeforeDiscount) : null,
        image: p.image,
        isAvailable: p.isAvailable,
        lastSeenAt: p.lastSeenAt.toISOString(),
        consecutiveMissingDays: p.consecutiveMissingDays,
        flaggedForReview: p.flaggedForReview,
      })),
    });
  }

  return {
    groups,
    totalGroups: groups.length,
    totalDuplicateProducts,
  };
}

/** Remove StandardizedProduct link; keep the Product row. */
export async function unlinkProductFromStandardized(productId: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, standardizedProductId: true, name: true, store: true },
  });

  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }

  if (product.standardizedProductId == null) {
    return { product, alreadyUnlinked: true };
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { standardizedProductId: null },
  });

  return { product: updated, alreadyUnlinked: false };
}

/** Permanently delete a Product row. */
export async function deleteProductById(productId: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, store: true, standardizedProductId: true },
  });

  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }

  await prisma.product.delete({ where: { id: productId } });
  return { deleted: product };
}
