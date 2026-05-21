import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";

/** Filters for similarity search; omit a field or pass undefined = all categories on that side. */
export type ProductMatchesFilters = {
  standardizedMainCategory?: string;
  productCategory?: string;
};

export type MatchCategoryMeta = {
  standardizedMainCategories: string[];
  productCategories: string[];
};

export async function getMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  const [standardizedRows, productRows] = await Promise.all([
    prisma.standardizedProduct.findMany({
      where: { mainCategory: { not: null } },
      select: { mainCategory: true },
      distinct: ["mainCategory"],
    }),
    prisma.product.findMany({
      select: { category: true },
      distinct: ["category"],
    }),
  ]);

  const standardizedMainCategories = [
    ...new Set(
      standardizedRows
        .map((r) => r.mainCategory)
        .filter((c): c is string => c != null && String(c).trim() !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const productCategories = [
    ...new Set(productRows.map((r) => r.category).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  return { standardizedMainCategories, productCategories };
}

/**
 * Normalize Balkan text (čćšžđ → ascii)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/[š]/g, 's')
    .replace(/[ž]/g, 'z')
    .replace(/[đ]/g, 'dj')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-based similarity (Jaccard)
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));

  if (!tokensA.size || !tokensB.size) return 0;

  const intersection = [...tokensA].filter(x => tokensB.has(x)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  return intersection / union;
}

/**
 * Extract ALL volumes and normalize to liters
 */
function extractVolumesNormalized(text: string): number[] {
  const regex = /(\d+[.,]?\d*)(\s)?(l|ml|kg|g)/gi;
  const matches = [...text.matchAll(regex)];

  const results: number[] = [];

  for (const m of matches) {
    let amount = parseFloat(m[1].replace(',', '.'));
    let unit = m[3].toLowerCase();

    if (unit === 'ml') results.push(amount / 1000);
    else if (unit === 'l') results.push(amount);
    else if (unit === 'g') results.push(amount / 1000);
    else if (unit === 'kg') results.push(amount);
  }

  return results;
}

/**
 * Smarter volume scoring (smooth decay)
 */
function getBestVolumeScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.5;

  let bestDiff = Infinity;

  for (const v1 of a) {
    for (const v2 of b) {
      const diff = Math.abs(v1 - v2);
      if (diff < bestDiff) bestDiff = diff;
    }
  }

  // exponential decay instead of hard cutoff
  return Math.exp(-bestDiff * 3);
}

/**
 * Check if at least one token overlaps (cheap pre-filter)
 */
function hasTokenOverlap(a: string, b: string): boolean {
  const tokensA = a.split(' ');
  const tokensB = new Set(b.split(' '));

  return tokensA.some(t => tokensB.has(t));
}

export async function getProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<any[]> {
  const spWhere: Prisma.StandardizedProductWhereInput = {};
  if (filters.standardizedMainCategory?.trim()) {
    spWhere.mainCategory = {
      equals: filters.standardizedMainCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const allStandards = await prisma.standardizedProduct.findMany({
    where: spWhere,
    include: {
      products: true,
    },
  });

  // Focus on weakly matched standards
  const standards = allStandards.filter((sp) => sp.products.length <= 2);

  const productWhere: Prisma.ProductWhereInput = {
    standardizedProductId: null,
  };
  if (filters.productCategory?.trim()) {
    productWhere.category = {
      equals: filters.productCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const unmatchedProducts = await prisma.product.findMany({
    where: productWhere,
  });


  const matches: any[] = [];

  for (const scraped of unmatchedProducts) {
    const normalizedScraped = normalizeText(scraped.name);
    const scrapedVolumes = extractVolumesNormalized(scraped.name);

    for (const sp of standards) {
      const combined = `${sp.brand ?? ''} ${sp.name}`;
      const normalizedCombined = normalizeText(combined);

      // 🚀 pre-filter (skip totally unrelated items)
      if (!hasTokenOverlap(normalizedScraped, normalizedCombined)) {
        continue;
      }

      const similarity = tokenSimilarity(
        normalizedScraped,
        normalizedCombined
      );

      const spVolumes = extractVolumesNormalized(sp.volume ?? '');

      const volumeScore = getBestVolumeScore(
        scrapedVolumes,
        spVolumes
      );

      // brand boost
      const brandMatch =
        sp.brand &&
        normalizedScraped.includes(normalizeText(sp.brand))
          ? 1
          : 0;

      const finalScore =
        similarity * 0.65 +
        volumeScore * 0.2 +
        brandMatch * 0.15;

      // softer threshold
      if (finalScore > 0.45) {
        matches.push({
          product: scraped,
          standardizedProduct: sp,
          similarity,
          volumeScore,
          brandMatch,
          finalScore,
        });
      }
    }
  }

  // sort best first
  return matches.sort((a, b) => b.finalScore - a.finalScore);
}