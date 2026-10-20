import prisma from "./prismaClient";

export type StoreAvailabilityRow = {
  storeId: number;
  chain: string;
  storeCode: string | null;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  productId: number | null;
  productName: string | null;
  price: string | null;
  priceBeforeDiscount: string | number | null;
  isAvailable: boolean | null;
  offerEndsOn: string | null;
  lastSeenAt: Date | null;
  tracked: boolean;
};

/**
 * Per-object availability for a Product (chain listing) or StandardizedProduct.
 * Zlatan Trag: Store.storeCode ↔ StoreLocationPrice.storeCode ↔ Product.normalizedName.
 */
export async function getStoreAvailability(opts: {
  productId?: number;
  standardizedProductId?: number;
  chain?: string;
}): Promise<{
  products: Array<{ id: number; name: string; store: string; normalizedName: string | null }>;
  locations: StoreAvailabilityRow[];
}> {
  const productWhere =
    opts.productId != null
      ? { id: opts.productId }
      : opts.standardizedProductId != null
        ? {
            standardizedProductId: opts.standardizedProductId,
            ...(opts.chain ? { store: opts.chain } : {}),
          }
        : null;
  if (!productWhere) {
    throw new Error("Provide productId or standardizedProductId");
  }

  const products = await prisma.product.findMany({
    where: productWhere,
    select: {
      id: true,
      name: true,
      store: true,
      normalizedName: true,
    },
  });

  const locations: StoreAvailabilityRow[] = [];
  for (const product of products) {
    if (!product.normalizedName) continue;

    const stores = await prisma.store.findMany({
      where: { name: product.store },
      orderBy: [{ city: "asc" }, { address: "asc" }],
    });
    if (stores.length === 0) continue;

    const coded = stores.filter((s) => s.storeCode);
    const prices =
      coded.length === 0
        ? []
        : await prisma.storeLocationPrice.findMany({
            where: {
              store: product.store,
              normalizedName: product.normalizedName,
              storeCode: { in: coded.map((s) => s.storeCode as string) },
            },
          });
    const byCode = new Map(prices.map((p) => [p.storeCode, p]));

    for (const store of stores) {
      const loc = store.storeCode ? byCode.get(store.storeCode) : undefined;
      locations.push({
        storeId: store.id,
        chain: store.name,
        storeCode: store.storeCode,
        address: store.address,
        city: store.city,
        latitude: store.latitude,
        longitude: store.longitude,
        productId: product.id,
        productName: loc?.name ?? product.name,
        price: loc?.price ?? null,
        priceBeforeDiscount: loc?.priceBeforeDiscount ?? null,
        isAvailable: loc ? loc.isAvailable : null,
        offerEndsOn: loc?.offerEndsOn ?? null,
        lastSeenAt: loc?.lastSeenAt ?? null,
        tracked: Boolean(store.storeCode),
      });
    }
  }

  return { products, locations };
}
