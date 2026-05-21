import prisma from "./prismaClient";
import { isDisplayableProductPrice } from "./utils/pricedProductFilter";

export type ProductData = {
  name: string;
  price: string | null;
  priceBeforeDiscount?: number | null;
  /** Optional scraper signal used to distinguish parse misses from real stock-outs. */
  availability?: "in_stock" | "out_of_stock" | "unknown";
  image: string;
  store: string;
  category: string;
};

export type SaveProductsOptions = {
  /**
   * When true, rows from the same store that were not seen in this run
   * will be marked unavailable by clearing their prices.
   * Use only for complete store scrapes.
   */
  clearMissingForStore?: boolean;
  /**
   * When set, `clearMissingForStore` only clears rows whose DB `category` is in this list.
   * Omit for legacy behavior (clear any category for that store). An empty array clears none.
   */
  clearMissingOnlyForCategories?: string[];
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

// 🔥 batch helper (IMPORTANT)
async function runInBatches<T>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<any>,
) {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize));
  }
}

export async function saveProducts(
  products: ProductData[],
  options?: SaveProductsOptions,
) {
  if (products.length === 0) {
    console.log("⚠️ No products to save.");
    return {
      created: 0,
      updated: 0,
      priceCleared: 0,
      totalInDb: await prisma.product.count(),
    };
  }

  console.log(`🛠️ Processing ${products.length} products...`);

  const existingProducts = await prisma.product.findMany({
    select: {
      id: true,
      normalizedName: true,
      store: true,
      category: true,
      price: true,
    },
  });

  const productMap = new Map(
    existingProducts.map((p) => [
      `${p.normalizedName}-${p.store}`,
      { id: p.id, price: p.price },
    ]),
  );

  let createdCount = 0;
  let updateCount = 0;
  let priceClearedCount = 0;

  const createOps: any[] = [];
  const updateOps: any[] = [];
  const seenByStore = new Map<string, Set<string>>();

  for (const p of products) {
    const normalizedName = normalizeName(p.name);
    const key = `${normalizedName}-${p.store}`;
    if (!seenByStore.has(p.store)) {
      seenByStore.set(p.store, new Set<string>());
    }
    seenByStore.get(p.store)?.add(normalizedName);

    const existing = productMap.get(key);

    // EXISTING → UPDATE (ALWAYS)
    if (existing) {
      const allowsNullPriceUpdate = p.availability === "out_of_stock";
      const preserveExistingPrice =
        isDisplayableProductPrice(existing.price) &&
        !isDisplayableProductPrice(p.price) &&
        !allowsNullPriceUpdate;
      updateOps.push({
        id: existing.id,
        price: preserveExistingPrice ? existing.price : p.price,
        priceBeforeDiscount: p.priceBeforeDiscount ?? null,
        image: p.image,
      });

      updateCount++;
      continue;
    }

    // NEW → ONLY IF HAS PRICE
    if (p.price !== null) {
      createOps.push({
        name: p.name,
        normalizedName,
        price: p.price,
        priceBeforeDiscount: p.priceBeforeDiscount ?? null,
        image: p.image,
        store: p.store,
        category: p.category,
      });

      createdCount++;
    }
  }

  let missingClearedCount = 0;
  const clearMissingOps: number[] = [];

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
        if (seen.has(existing.normalizedName)) continue;
        if (
          clearCategoryFilter &&
          !clearCategoryFilter.has(existing.category)
        ) {
          continue;
        }

        if (isDisplayableProductPrice(existing.price)) {
          priceClearedCount++;
        }
        clearMissingOps.push(existing.id);
      }
      missingClearedCount = clearMissingOps.length;
    } else if (stores.length > 1) {
      console.warn(
        `clearMissingForStore=true skipped (expected one store in batch, got ${stores.length}).`,
      );
    }
  }

  // 🔥 SAFE BATCHED WRITES

  await runInBatches(updateOps, 50, async (batch) => {
    await Promise.all(
      batch.map((u) =>
        prisma.product.update({
          where: { id: u.id },
          data: {
            price: u.price,
            priceBeforeDiscount: u.priceBeforeDiscount,
            image: u.image,
            updatedAt: new Date(),
          },
        }),
      ),
    );
  });

  await runInBatches(createOps, 50, async (batch) => {
    await prisma.product.createMany({
      data: batch,
      skipDuplicates: true,
    });
  });

  await runInBatches(clearMissingOps, 50, async (batch) => {
    await prisma.product.updateMany({
      where: { id: { in: batch } },
      data: {
        price: null,
        priceBeforeDiscount: null,
        updatedAt: new Date(),
      },
    });
  });

  const totalInDb = await prisma.product.count();

  console.log(
    `⚡ Created: ${createdCount}, Updated: ${updateCount}, Price cleared: ${priceClearedCount}, Total: ${totalInDb}`,
  );
  if (missingClearedCount > 0) {
    console.log(`ℹ️ Missing in latest run (set to null): ${missingClearedCount}`);
  }

  return {
    created: createdCount,
    updated: updateCount,
    priceCleared: priceClearedCount,
    missingCleared: missingClearedCount,
    totalInDb,
  };
}