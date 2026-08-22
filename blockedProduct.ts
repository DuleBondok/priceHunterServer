import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";

type BlockedDelegate = {
  findMany: (args: unknown) => Promise<any>;
  findUnique: (args: unknown) => Promise<any>;
  createMany: (args: unknown) => Promise<any>;
  count: (args: unknown) => Promise<number>;
  delete: (args: unknown) => Promise<any>;
  deleteMany?: (args: unknown) => Promise<any>;
};

function blockedOf(client: object = prisma): BlockedDelegate {
  const table = (client as { blockedProduct?: BlockedDelegate }).blockedProduct;
  if (!table) {
    throw new Error(
      "Prisma client is missing BlockedProduct. Run `npx prisma generate` and restart the process.",
    );
  }
  return table;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function blockedProductKey(normalizedName: string, store: string): string {
  return `${normalizedName}-${store}`;
}

export async function loadBlockedKeysForStores(
  stores: string[],
): Promise<Set<string>> {
  if (!stores.length) return new Set();
  const rows = await blockedOf().findMany({
    where: { store: { in: stores } },
    select: { normalizedName: true, store: true },
  });
  return new Set(
    rows.map((row) => blockedProductKey(row.normalizedName, row.store)),
  );
}

export async function isProductBlocked(
  normalizedName: string,
  store: string,
): Promise<boolean> {
  const row = await blockedOf().findUnique({
    where: {
      blocked_normalizedName_store: { normalizedName, store },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function purgeBlockedListingsForStores(
  stores: string[],
): Promise<{ deletedProducts: number; deletedNewProducts: number }> {
  if (!stores.length) {
    return { deletedProducts: 0, deletedNewProducts: 0 };
  }

  const blocked = await blockedOf().findMany({
    where: { store: { in: stores } },
    select: { normalizedName: true, store: true },
  });
  if (!blocked.length) {
    return { deletedProducts: 0, deletedNewProducts: 0 };
  }

  let deletedProducts = 0;
  let deletedNewProducts = 0;
  for (const batch of chunk(blocked, 100)) {
    const where = {
      OR: batch.map((row) => ({
        normalizedName: row.normalizedName,
        store: row.store,
      })),
    };
    const [products, pending] = await Promise.all([
      prisma.product.deleteMany({ where }),
      prisma.newProducts.deleteMany({ where }),
    ]);
    deletedProducts += products.count;
    deletedNewProducts += pending.count;
  }
  return { deletedProducts, deletedNewProducts };
}

export async function blockListings(input: {
  productIds?: number[];
  newProductIds?: number[];
  reason?: string;
}): Promise<{
  blocked: number;
  deletedProducts: number;
  deletedNewProducts: number;
}> {
  const reason = input.reason?.trim() || "blocked";
  const productIds = [
    ...new Set((input.productIds ?? []).filter((id) => Number.isFinite(id) && id > 0)),
  ];
  const newProductIds = [
    ...new Set(
      (input.newProductIds ?? []).filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];

  if (productIds.length + newProductIds.length > 500) {
    throw new Error("Too many ids (max 500)");
  }

  const [products, pending] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            normalizedName: true,
            store: true,
            category: true,
          },
        })
      : Promise.resolve([]),
    newProductIds.length
      ? prisma.newProducts.findMany({
          where: { id: { in: newProductIds } },
          select: {
            id: true,
            name: true,
            normalizedName: true,
            store: true,
            category: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const entries = new Map<
    string,
    {
      normalizedName: string;
      store: string;
      name: string;
      category: string | null;
      reason: string;
    }
  >();

  for (const row of [...products, ...pending]) {
    const normalizedName = row.normalizedName?.trim();
    if (!normalizedName) continue;
    entries.set(blockedProductKey(normalizedName, row.store), {
      normalizedName,
      store: row.store,
      name: row.name,
      category: row.category || null,
      reason,
    });
  }

  if (entries.size === 0) {
    return { blocked: 0, deletedProducts: 0, deletedNewProducts: 0 };
  }

  const payload = [...entries.values()];

  return prisma.$transaction(async (tx) => {
    await blockedOf(tx).createMany({
      data: payload,
      skipDuplicates: true,
    });

    const deletedProducts = await tx.product.deleteMany({
      where: {
        OR: payload.map((row) => ({
          normalizedName: row.normalizedName,
          store: row.store,
        })),
      },
    });

    const deletedNewProducts = await tx.newProducts.deleteMany({
      where: {
        OR: payload.map((row) => ({
          normalizedName: row.normalizedName,
          store: row.store,
        })),
      },
    });

    return {
      blocked: payload.length,
      deletedProducts: deletedProducts.count,
      deletedNewProducts: deletedNewProducts.count,
    };
  });
}

export async function unblockListing(id: number): Promise<void> {
  await blockedOf().delete({ where: { id } });
}

export async function searchProductsByName(input: {
  q: string;
  take?: number;
}): Promise<{
  total: number;
  products: Array<{
    id: number;
    name: string;
    normalizedName: string | null;
    store: string;
    category: string;
    image: string;
    price: string | null;
  }>;
}> {
  const q = input.q.trim();
  if (q.length < 2) {
    throw new Error("Search query must be at least 2 characters");
  }

  const take = Math.min(Math.max(input.take ?? 50, 1), 100);
  const where: Prisma.ProductWhereInput = /^\d+$/.test(q)
    ? { id: Number(q) }
    : {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { normalizedName: { contains: q, mode: "insensitive" } },
        ],
      };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { id: "desc" },
      take,
      select: {
        id: true,
        name: true,
        normalizedName: true,
        store: true,
        category: true,
        image: true,
        price: true,
      },
    }),
  ]);

  return { total, products };
}

export async function listBlockedProducts(input: {
  store?: string;
  q?: string;
  take?: number;
  skip?: number;
}): Promise<{
  total: number;
  items: Array<{
    id: number;
    name: string;
    normalizedName: string;
    store: string;
    category: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
}> {
  const take = Math.min(Math.max(input.take ?? 100, 1), 200);
  const skip = Math.max(input.skip ?? 0, 0);
  const store = input.store?.trim() || undefined;
  const q = input.q?.trim() || undefined;

  const where: Record<string, unknown> = {
    ...(store ? { store } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { normalizedName: { contains: q, mode: "insensitive" } },
            { reason: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    blockedOf().count({ where }),
    blockedOf().findMany({
      where,
      orderBy: { id: "desc" },
      take,
      skip,
      select: {
        id: true,
        name: true,
        normalizedName: true,
        store: true,
        category: true,
        reason: true,
        createdAt: true,
      },
    }),
  ]);

  return { total, items };
}
