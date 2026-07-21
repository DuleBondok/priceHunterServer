import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import { scheduleSitemapPingIfFirstPrices } from "./utils/firstPriceSitemapPing";
import {
  isDisplayableProductPrice,
  pricedProductWhere,
} from "./utils/pricedProductFilter";

export type ProductData = {
  name: string;
  price: string | null;
  priceBeforeDiscount?: number | null;
  /** Optional scraper signal used to distinguish parse misses from real stock-outs. */
  availability?: "in_stock" | "out_of_stock" | "unknown";
  image: string;
  store: string;
  category: string;
  requiresLoyaltyCard?: boolean;
  offerEndsOn?: string | null;
};

export type SaveProductsOptions = {
  /**
   * When true, products from the same store (and optional category filter) that
   * were not seen in this run get consecutiveMissingDays incremented — prices are
   * not cleared. After save, {@link applyProductAvailabilityCleanup} runs once.
   */
  clearMissingForStore?: boolean;
  /**
   * When set, `clearMissingForStore` only affects rows whose DB `category` is in this list.
   * Omit for legacy behavior (any category for that store). An empty array affects none.
   */
  clearMissingOnlyForCategories?: string[];
};

/** Days without being seen before hiding on site. */
export const AVAILABILITY_GRACE_DAYS = 14;

/**
 * Neon pooler default connection_limit is 9; app.ts also holds a Prisma client.
 * Individual row updates must not exceed this or the pool times out (10s).
 */
const PRISMA_WRITE_CONCURRENCY = 5;

export type SaveProductsResult = {
  /** New rows staged in NewProducts (not Product). */
  created: number;
  /** Existing Product rows updated. */
  updated: number;
  /** @deprecated Always 0 — prices are no longer cleared when missing. */
  priceCleared: number;
  newProductsUpdated: number;
  missingMarked: number;
  availabilityHidden: number;
  missingCleared: number;
  totalInDb: number;
};

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`"´¿]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function productKey(normalizedName: string, store: string): string {
  return `${normalizedName}-${store}`;
}

function countsAsPricedOffer(
  price: string | null | undefined,
  isAvailable: boolean,
): boolean {
  return isAvailable && isDisplayableProductPrice(price);
}

async function runInBatches<T>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<any>,
) {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize));
  }
}

/**
 * Bulk hide products not seen for {@link AVAILABILITY_GRACE_DAYS}+ days.
 * Call once after a full store scrape finishes.
 */
export async function applyProductAvailabilityCleanup(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AVAILABILITY_GRACE_DAYS);

  const result = await prisma.product.updateMany({
    where: {
      lastSeenAt: { lt: cutoff },
      isAvailable: true,
      flaggedForReview: false,
    },
    data: { isAvailable: false },
  });

  return result.count;
}

/**
 * Promote a pending NewProducts row into Product after manual review.
 * Removes the NewProducts row after a successful insert into Product.
 */
export async function promoteNewProducts(pendingProductId: number) {
  const pending = await prisma.newProducts.findUnique({
    where: { id: pendingProductId },
  });

  if (!pending) {
    throw new Error(`NewProducts #${pendingProductId} not found`);
  }

  const existingProduct = await prisma.product.findUnique({
    where: {
      normalizedName_store: {
        normalizedName: pending.normalizedName,
        store: pending.store,
      },
    },
  });

  if (existingProduct) {
    await prisma.newProducts.delete({ where: { id: pendingProductId } });
    throw new Error(
      `Product already exists for normalizedName="${pending.normalizedName}" store="${pending.store}" (id=${existingProduct.id}); removed stale NewProducts row`,
    );
  }

  const seenAt = pending.lastSeenAt ?? new Date();

  const product = await prisma.product.create({
    data: {
      name: pending.name,
      normalizedName: pending.normalizedName,
      price: pending.price,
      priceBeforeDiscount: pending.priceBeforeDiscount,
      store: pending.store,
      category: pending.category,
      image: pending.image,
      lastSeenAt: seenAt,
      isAvailable: true,
      consecutiveMissingDays: 0,
    },
  });

  await prisma.newProducts.delete({ where: { id: pendingProductId } });

  return { product, pending };
}

/**
 * Link a pending NewProducts row to a StandardizedProduct: create (or update)
 * Product with standardizedProductId, then remove the NewProducts row.
 */
export async function confirmNewProductMatch(
  newProductId: number,
  standardizedProductId: number,
) {
  const pending = await prisma.newProducts.findUnique({
    where: { id: newProductId },
  });

  if (!pending) {
    throw new Error(`NewProducts #${newProductId} not found`);
  }

  const standardized = await prisma.standardizedProduct.findUnique({
    where: { id: standardizedProductId },
    include: {
      products: { select: { id: true, store: true } },
    },
  });

  if (!standardized) {
    throw new Error(`StandardizedProduct #${standardizedProductId} not found`);
  }

  if (standardized.products.some((p) => p.store === pending.store)) {
    throw new Error(
      `StandardizedProduct #${standardizedProductId} already has a listing for store "${pending.store}"`,
    );
  }

  const existingProduct = await prisma.product.findUnique({
    where: {
      normalizedName_store: {
        normalizedName: pending.normalizedName,
        store: pending.store,
      },
    },
  });

  const seenAt = pending.lastSeenAt ?? new Date();

  const product = existingProduct
    ? await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          name: pending.name,
          price: pending.price,
          priceBeforeDiscount: pending.priceBeforeDiscount,
          category: pending.category,
          image: pending.image,
          lastSeenAt: seenAt,
          isAvailable: true,
          consecutiveMissingDays: 0,
          standardizedProductId,
        },
      })
    : await prisma.product.create({
        data: {
          name: pending.name,
          normalizedName: pending.normalizedName,
          price: pending.price,
          priceBeforeDiscount: pending.priceBeforeDiscount,
          store: pending.store,
          category: pending.category,
          image: pending.image,
          lastSeenAt: seenAt,
          isAvailable: true,
          consecutiveMissingDays: 0,
          standardizedProductId,
        },
      });

  await prisma.newProducts.delete({ where: { id: newProductId } });

  return { product, pending, standardizedProductId };
}

export type PromotePendingNewProductsResult = {
  pending: number;
  promoted: number;
  skippedExisting: number;
};

/**
 * Move all unprocessed NewProducts rows for a store into Product.
 * Deletes each NewProducts row after it is handled (created or already in Product).
 */
export async function promotePendingNewProductsForStore(
  store: string,
): Promise<PromotePendingNewProductsResult> {
  const pending = await prisma.newProducts.findMany({
    where: { store, processedAt: null },
    orderBy: { id: "asc" },
  });

  if (pending.length === 0) {
    return { pending: 0, promoted: 0, skippedExisting: 0 };
  }

  const existing = await prisma.product.findMany({
    where: { store },
    select: { normalizedName: true },
  });
  const existingNames = new Set(
    existing
      .map((row) => row.normalizedName)
      .filter((name): name is string => Boolean(name)),
  );

  const toCreate = pending.filter((row) => !existingNames.has(row.normalizedName));
  const skippedExisting = pending.length - toCreate.length;
  const promotedAt = new Date();

  await runInBatches(toCreate, 100, async (batch) => {
    await prisma.product.createMany({
      data: batch.map((row) => ({
        name: row.name,
        normalizedName: row.normalizedName,
        price: row.price,
        priceBeforeDiscount: row.priceBeforeDiscount,
        store: row.store,
        category: row.category,
        image: row.image,
        lastSeenAt: row.lastSeenAt ?? promotedAt,
        isAvailable: true,
        consecutiveMissingDays: 0,
      })),
      skipDuplicates: true,
    });
  });

  await prisma.newProducts.deleteMany({
    where: { id: { in: pending.map((row) => row.id) } },
  });

  return {
    pending: pending.length,
    promoted: toCreate.length,
    skippedExisting,
  };
}

const now = () => new Date();

export async function saveProducts(
  products: ProductData[],
  options?: SaveProductsOptions,
): Promise<SaveProductsResult> {
  if (products.length === 0) {
    console.log("⚠️ No products to save.");
    const totalInDb = await prisma.product.count();
    let availabilityHidden = 0;
    if (options?.clearMissingForStore) {
      availabilityHidden = await applyProductAvailabilityCleanup();
      if (availabilityHidden > 0) {
        console.log(
          `ℹ️ Hidden ${availabilityHidden} product(s) not seen in ${AVAILABILITY_GRACE_DAYS}+ days.`,
        );
      }
    }
    return {
      created: 0,
      updated: 0,
      priceCleared: 0,
      newProductsUpdated: 0,
      missingMarked: 0,
      availabilityHidden,
      missingCleared: 0,
      totalInDb,
    };
  }

  console.log(`🛠️ Processing ${products.length} products...`);

  const storesInBatch = [...new Set(products.map((p) => p.store))];

  const [existingProducts, existingNewProducts] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        normalizedName: true,
        store: true,
        category: true,
        price: true,
        standardizedProductId: true,
        isAvailable: true,
        flaggedForReview: true,
      },
    }),
    prisma.newProducts.findMany({
      where: {
        store: { in: storesInBatch },
        processedAt: null,
      },
      select: {
        id: true,
        normalizedName: true,
        store: true,
      },
    }),
  ]);

  const productMap = new Map(
    existingProducts
      .filter((p): p is typeof p & { normalizedName: string } =>
        Boolean(p.normalizedName),
      )
      .map((p) => [
        productKey(p.normalizedName, p.store),
        {
          id: p.id,
          price: p.price,
          standardizedProductId: p.standardizedProductId,
          isAvailable: p.isAvailable,
          flaggedForReview: p.flaggedForReview,
        },
      ]),
  );

  const newProductMap = new Map(
    existingNewProducts.map((p) => [
      productKey(p.normalizedName, p.store),
      { id: p.id },
    ]),
  );

  let newProductsCreatedCount = 0;
  let updateCount = 0;
  let newProductsUpdatedCount = 0;
  let flaggedSkippedCount = 0;
  const firstPriceCandidateSpIds = new Set<number>();

  const newProductCreateOps: Prisma.NewProductsCreateManyInput[] = [];
  /** key → index in newProductCreateOps for rows queued in this run (not yet in DB) */
  const pendingNewProductIndexByKey = new Map<string, number>();
  const newProductUpdateById = new Map<
    number,
    {
      id: number;
      price: string | null;
      priceBeforeDiscount: number | null;
      image: string;
      lastSeenAt: Date;
    }
  >();
  const updateOps: {
    id: number;
    price: string | null;
    priceBeforeDiscount: number | null;
    image: string;
    lastSeenAt: Date;
    isAvailable: boolean;
    consecutiveMissingDays: number;
    requiresLoyaltyCard: boolean;
    offerEndsOn: string | null;
  }[] = [];
  const seenByStore = new Map<string, Set<string>>();
  const seenAt = now();

  for (const p of products) {
    const normalizedName = normalizeName(p.name);
    const key = productKey(normalizedName, p.store);
    if (!seenByStore.has(p.store)) {
      seenByStore.set(p.store, new Set<string>());
    }
    seenByStore.get(p.store)?.add(normalizedName);

    const existing = productMap.get(key);

    // STEP 1: existing Product — skip entirely when flagged for review
    if (existing) {
      if (existing.flaggedForReview) {
        flaggedSkippedCount++;
        continue;
      }

      const allowsNullPriceUpdate = p.availability === "out_of_stock";
      const preserveExistingPrice =
        isDisplayableProductPrice(existing.price) &&
        !isDisplayableProductPrice(p.price) &&
        !allowsNullPriceUpdate;
      const nextPrice = preserveExistingPrice ? existing.price : p.price;
      const wasPricedOffer = countsAsPricedOffer(
        existing.price,
        existing.isAvailable,
      );
      const willBePricedOffer = countsAsPricedOffer(
        nextPrice,
        p.availability !== "out_of_stock",
      );
      if (
        existing.standardizedProductId &&
        !wasPricedOffer &&
        willBePricedOffer
      ) {
        firstPriceCandidateSpIds.add(existing.standardizedProductId);
      }
      updateOps.push({
        id: existing.id,
        price: preserveExistingPrice ? existing.price : p.price,
        priceBeforeDiscount: p.priceBeforeDiscount ?? null,
        image: p.image,
        lastSeenAt: seenAt,
        isAvailable: p.availability !== "out_of_stock",
        consecutiveMissingDays: 0,
        requiresLoyaltyCard: p.requiresLoyaltyCard ?? false,
        offerEndsOn: p.offerEndsOn ?? null,
      });

      updateCount++;
      continue;
    }

    // STEP 2: NewProducts upsert path (never create Product here)
    const existingNew = newProductMap.get(key);
    const pendingCreateIdx = pendingNewProductIndexByKey.get(key);

    if (existingNew || pendingCreateIdx !== undefined) {
      if (pendingCreateIdx !== undefined) {
        newProductCreateOps[pendingCreateIdx] = {
          name: p.name,
          normalizedName,
          price: p.price,
          priceBeforeDiscount: p.priceBeforeDiscount ?? null,
          image: p.image,
          store: p.store,
          category: p.category,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        };
      } else if (existingNew && existingNew.id > 0) {
        newProductUpdateById.set(existingNew.id, {
          id: existingNew.id,
          price: p.price,
          priceBeforeDiscount: p.priceBeforeDiscount ?? null,
          image: p.image,
          lastSeenAt: seenAt,
        });
      }
      newProductsUpdatedCount++;
      continue;
    }

    if (p.price !== null) {
      const idx = newProductCreateOps.length;
      newProductCreateOps.push({
        name: p.name,
        normalizedName,
        price: p.price,
        priceBeforeDiscount: p.priceBeforeDiscount ?? null,
        image: p.image,
        store: p.store,
        category: p.category,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
      pendingNewProductIndexByKey.set(key, idx);
      newProductMap.set(key, { id: 0 });
      newProductsCreatedCount++;
    }
  }

  const newProductUpdateOps = [...newProductUpdateById.values()];

  const missingIncrementIds: number[] = [];

  if (options?.clearMissingForStore) {
    const stores = Array.from(seenByStore.keys());
    if (stores.length === 1) {
      const store = stores[0];
      const seen = seenByStore.get(store) ?? new Set<string>();
      const clearCategoryFilter =
        options.clearMissingOnlyForCategories !== undefined
          ? new Set(options.clearMissingOnlyForCategories)
          : null;

      for (const existing of existingProducts) {
        if (existing.store !== store) continue;
        if (!existing.normalizedName) continue;
        if (existing.flaggedForReview) continue;
        if (seen.has(existing.normalizedName)) continue;
        if (
          clearCategoryFilter &&
          !clearCategoryFilter.has(existing.category)
        ) {
          continue;
        }

        missingIncrementIds.push(existing.id);
      }
    } else if (stores.length > 1) {
      console.warn(
        `clearMissingForStore=true skipped (expected one store in batch, got ${stores.length}).`,
      );
    }
  }

  const spIdsWithZeroPricedBefore = new Set<number>();
  if (firstPriceCandidateSpIds.size > 0) {
    const spIdList = [...firstPriceCandidateSpIds];
    await runInBatches(spIdList, PRISMA_WRITE_CONCURRENCY, async (batch) => {
      const counts = await Promise.all(
        batch.map(async (spId) => {
          const count = await prisma.product.count({
            where: {
              standardizedProductId: spId,
              ...pricedProductWhere,
            },
          });
          return { spId, count };
        }),
      );
      for (const row of counts) {
        if (row.count === 0) {
          spIdsWithZeroPricedBefore.add(row.spId);
        }
      }
    });
  }

  await runInBatches(updateOps, PRISMA_WRITE_CONCURRENCY, async (batch) => {
    await Promise.all(
      batch.map((u) =>
        prisma.product.update({
          where: { id: u.id },
          data: {
            price: u.price,
            priceBeforeDiscount: u.priceBeforeDiscount,
            image: u.image,
            lastSeenAt: u.lastSeenAt,
            isAvailable: u.isAvailable,
            consecutiveMissingDays: u.consecutiveMissingDays,
            requiresLoyaltyCard: u.requiresLoyaltyCard,
            offerEndsOn: u.offerEndsOn,
            updatedAt: now(),
          },
        }),
      ),
    );
  });

  if (spIdsWithZeroPricedBefore.size > 0) {
    scheduleSitemapPingIfFirstPrices(spIdsWithZeroPricedBefore);
  }

  if (newProductUpdateOps.length > 0) {
    await runInBatches(newProductUpdateOps, PRISMA_WRITE_CONCURRENCY, async (batch) => {
      await Promise.all(
        batch.map((u) =>
          prisma.newProducts.update({
            where: { id: u.id },
            data: {
              price: u.price,
              priceBeforeDiscount: u.priceBeforeDiscount,
              image: u.image,
              lastSeenAt: u.lastSeenAt,
            },
          }),
        ),
      );
    });
  }

  await runInBatches(newProductCreateOps, 50, async (batch) => {
    await prisma.newProducts.createMany({
      data: batch,
      skipDuplicates: true,
    });
  });

  await runInBatches(missingIncrementIds, 50, async (batch) => {
    await prisma.product.updateMany({
      where: { id: { in: batch } },
      data: {
        consecutiveMissingDays: { increment: 1 },
        updatedAt: now(),
      },
    });
  });

  let availabilityHidden = 0;
  if (options?.clearMissingForStore) {
    availabilityHidden = await applyProductAvailabilityCleanup();
  }

  const totalInDb = await prisma.product.count();

  console.log(
    `⚡ Product updated: ${updateCount}, NewProducts created: ${newProductsCreatedCount}, NewProducts updated: ${newProductsUpdatedCount}, Flagged skipped: ${flaggedSkippedCount}, Missing marked: ${missingIncrementIds.length}, Hidden (${AVAILABILITY_GRACE_DAYS}d+): ${availabilityHidden}, Products in DB: ${totalInDb}`,
  );

  return {
    created: newProductsCreatedCount,
    updated: updateCount,
    priceCleared: 0,
    newProductsUpdated: newProductsUpdatedCount,
    missingMarked: missingIncrementIds.length,
    availabilityHidden,
    missingCleared: missingIncrementIds.length,
    totalInDb,
  };
}
