import prisma from "../prismaClient";
import { pingGoogleSitemapFireAndForget } from "./googleSitemapPing";
import { pricedProductWhere } from "./pricedProductFilter";

async function countPricedProductsForStandardizedProduct(
  standardizedProductId: number,
): Promise<number> {
  return prisma.product.count({
    where: {
      standardizedProductId,
      ...pricedProductWhere,
    },
  });
}

/**
 * After price saves, ping Google once if any standardized product went from
 * 0 displayable prices to 1+.
 */
export function scheduleSitemapPingIfFirstPrices(
  candidateStandardizedProductIds: Iterable<number>,
): void {
  const ids = [...new Set(candidateStandardizedProductIds)];
  if (!ids.length) return;

  void (async () => {
    try {
      let shouldPing = false;
      for (const spId of ids) {
        const count = await countPricedProductsForStandardizedProduct(spId);
        if (count > 0) {
          shouldPing = true;
          break;
        }
      }
      if (shouldPing) {
        pingGoogleSitemapFireAndForget();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sitemap-ping] Transition check failed:", message);
    }
  })();
}
