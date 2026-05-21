import { Prisma } from "@prisma/client";

/** Same rules as {@link pricedProductWhere}: counts as a real shelf price for metrics/UI. */
export function isDisplayableProductPrice(
  price: string | null | undefined,
): boolean {
  if (price == null) return false;
  const t = String(price).trim();
  if (t === "") return false;
  const u = t.toUpperCase();
  if (u === "N/A" || u === "NA") return false;
  return true;
}

/**
 * Nested `products` filter for API responses: omit null, empty, and N/A-style prices.
 */
export const pricedProductWhere: Prisma.ProductWhereInput = {
  AND: [
    { price: { not: null } },
    { NOT: { price: { equals: "" } } },
    {
      NOT: {
        OR: [
          { price: { equals: "N/A", mode: Prisma.QueryMode.insensitive } },
          { price: { equals: "NA", mode: Prisma.QueryMode.insensitive } },
        ],
      },
    },
  ],
};

/** StandardizedProduct must have at least one related Product that passes {@link pricedProductWhere}. */
export const hasAtLeastOnePricedProduct: Prisma.StandardizedProductWhereInput =
  {
    products: { some: pricedProductWhere },
  };
