import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import {
  buildBrandAliasIndex,
  buildStandardizedTokenIndex,
  computeMatchScore,
  expandScrapedNameWithBrandAliases,
  extractVolumesNormalized,
  getBestVolumeScore,
  linkedStoreCount,
  MAX_STORE_LINKS_PER_STANDARD,
  MIN_WEAK_MATCH_SCORE,
  normalizeText,
  scoreProductMatch,
  scrapedNameHasBrandAliasToken,
  SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN,
  type BrandAliasIndex,
} from "./matchingUtils";
import { compareTwoStrings } from "string-similarity";

/** Hard cap for scripts. Admin HTTP uses MATCHES_ADMIN_DEFAULT_LIMIT. */
export const MATCHES_PAGE_LIMIT = 15000;
/** Rows returned to admin after ranking the larger scored pool. */
export const MATCHES_ADMIN_DEFAULT_LIMIT = 80;
/** Score this many unmatched rows (not first-by-id page), then keep the highest-scoring 80. */
const MATCHES_ADMIN_SCORE_POOL = 800;
const MAX_MATCH_CANDIDATES = 80;

export type ProductMatchesFilters = {
  standardizedMainCategory?: string;
  productCategory?: string;
  store?: string;
  /**
   * SimilarityBrandAlias.matchName (e.g. "Carn").
   * When set: only Products whose name contains that token, matched against
   * StandardizedProducts with brand = alias canonical name (e.g. Carnex).
   */
  brandAliasMatch?: string;
  limit?: number;
};

export type ProductMatchRow = {
  product: {
    id: number;
    name: string;
    category: string;
    store: string;
    image: string;
    price: string | null;
  };
  standardizedProduct: {
    id: number;
    name: string;
    brand: string | null;
    volume: string | null;
    image: string;
    mainCategory: string | null;
  } | null;
  similarity: number;
  fuzzyScore: number;
  volumeScore: number;
  brandMatch: number;
  categoryScore: number;
  finalScore: number;
  lowConfidence: boolean;
  /** Best-effort match below normal confidence threshold. */
  weakSuggestion?: boolean;
  /** No standardized product candidate met even the weak threshold. */
  noSuggestion?: boolean;
};

export type ProductMatchesResult = {
  matches: ProductMatchRow[];
  /** Unmatched products considered (same as product filter). */
  eligible: number;
  /** Rows with a normal suggestion (finalScore >= MIN_MATCH_SCORE). */
  withSuggestion: number;
  /** Rows with only a weak best-effort suggestion. */
  weakSuggestion: number;
  /** Rows with no suggestion at all. */
  withoutSuggestion: number;
  total: number;
  limit: number;
  truncated: boolean;
};

export type MatchCategoryMeta = {
  standardizedMainCategories: string[];
  productCategories: string[];
  stores: string[];
  maxStoreLinksPerStandard: number;
};

type ScrapedMatchRow = ProductMatchRow["product"];

type StandardForMatch = {
  id: number;
  name: string;
  brand: string | null;
  volume: string | null;
  image: string | null;
  mainCategory: string | null;
  products: { store: string }[];
};

function distinctSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && String(v).trim() !== ""))].sort(
    (a, b) => a.localeCompare(b),
  );
}

/** Product.category → Cenoteka mainCategory labels (case-insensitive key match). */
function mappedMainCategoriesForProductCategory(
  productCategory?: string,
): string[] {
  const raw = productCategory?.trim();
  if (!raw) return [];
  const direct = SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN[raw];
  if (direct?.length) return direct;
  const key = Object.keys(SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN).find(
    (k) => k.toLowerCase() === raw.toLowerCase(),
  );
  return key ? SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN[key] ?? [] : [];
}

/**
 * Load SP candidates for matching.
 * - Explicit SP mainCategory filter, or
 * - When "All main categories" + Product category: map scraped category → SP mains
 *   (otherwise standards stay empty and every row becomes "No suggestion found").
 */
async function loadStandardsForMatching(
  standardizedMainCategory?: string,
  standardizedBrand?: string,
  productCategory?: string,
): Promise<{
  standards: StandardForMatch[];
  standardsById: Map<number, StandardForMatch>;
  allStandardIds: number[];
  tokenIndex: ReturnType<typeof buildStandardizedTokenIndex>;
}> {
  const spWhere: Prisma.StandardizedProductWhereInput = {};
  const explicitMain = standardizedMainCategory?.trim() || "";

  if (explicitMain) {
    spWhere.mainCategory = {
      equals: explicitMain,
      mode: Prisma.QueryMode.insensitive,
    };
  } else {
    const mapped = mappedMainCategoriesForProductCategory(productCategory);
    if (!mapped.length) {
      return {
        standards: [],
        standardsById: new Map(),
        allStandardIds: [],
        tokenIndex: buildStandardizedTokenIndex([]),
      };
    }
    // Avoid loading the entire SP table (OOM on Render). Scope via scraped→SP map.
    spWhere.OR = mapped.map((main) => ({
      mainCategory: {
        equals: main,
        mode: Prisma.QueryMode.insensitive,
      },
    }));
  }

  if (standardizedBrand?.trim()) {
    spWhere.brand = {
      equals: standardizedBrand.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const allStandards = await prisma.standardizedProduct.findMany({
    where: spWhere,
    select: {
      id: true,
      name: true,
      brand: true,
      volume: true,
      mainCategory: true,
    },
  });

  // Occupancy is filled later for the unmatched page's stores only.
  // Loading every Product linked to the whole category OOMs Render (512MB).
  const standards: StandardForMatch[] = allStandards.map((sp) => ({
    ...sp,
    image: null,
    products: [],
  }));

  return {
    standards,
    standardsById: new Map(standards.map((sp) => [sp.id, sp])),
    allStandardIds: standards.map((sp) => sp.id),
    tokenIndex: buildStandardizedTokenIndex(standards),
  };
}

async function fillStoreOccupancyForPage(
  standardsById: Map<number, StandardForMatch>,
  unmatchedProducts: ScrapedMatchRow[],
): Promise<void> {
  const stores = [
    ...new Set(unmatchedProducts.map((p) => p.store).filter(Boolean)),
  ];
  if (!stores.length || standardsById.size === 0) return;

  const rows = await prisma.product.findMany({
    where: {
      store: { in: stores },
      standardizedProductId: { not: null },
    },
    select: { standardizedProductId: true, store: true },
  });

  for (const row of rows) {
    if (row.standardizedProductId == null) continue;
    const sp = standardsById.get(row.standardizedProductId);
    if (!sp) continue;
    if (!sp.products.some((p) => p.store === row.store)) {
      sp.products.push({ store: row.store });
    }
  }

  for (const [id, sp] of [...standardsById.entries()]) {
    if (linkedStoreCount(sp.products) >= MAX_STORE_LINKS_PER_STANDARD) {
      standardsById.delete(id);
    }
  }
}

function combinedStandardName(sp: StandardForMatch): string {
  return `${sp.brand ?? ""} ${sp.name} ${sp.volume ?? ""}`;
}

function buildSpNormById(
  standardsById: Map<number, StandardForMatch>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const [id, sp] of standardsById) {
    map.set(id, normalizeText(combinedStandardName(sp)));
  }
  return map;
}

function buildSpVolsById(
  standardsById: Map<number, StandardForMatch>,
): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [id, sp] of standardsById) {
    map.set(
      id,
      extractVolumesNormalized(`${sp.volume ?? ""} ${sp.name}`),
    );
  }
  return map;
}

function pickCandidateIds(
  scrapedName: string,
  allStandardIds: number[],
  spNormById: Map<number, string>,
  spVolsById: Map<number, number[]>,
  brandAliases?: BrandAliasIndex | null,
): number[] {
  if (!allStandardIds.length) return [];
  const scrapedForMatch = expandScrapedNameWithBrandAliases(
    scrapedName,
    brandAliases,
  );
  const scrapedNorm = normalizeText(scrapedForMatch);
  const scrapedVols = extractVolumesNormalized(scrapedName);
  return allStandardIds
    .map((id) => {
      const fuzzy = compareTwoStrings(scrapedNorm, spNormById.get(id) ?? "");
      const spVols = spVolsById.get(id) ?? [];
      const vol = getBestVolumeScore(scrapedVols, spVols);
      const bothVolumesKnown = scrapedVols.length > 0 && spVols.length > 0;
      // Prefer same quantity heavily when both sides have a parseable volume.
      const rank = bothVolumesKnown
        ? fuzzy * 0.4 + vol * 0.6
        : fuzzy * 0.85 + vol * 0.15;
      return { id, rank };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_MATCH_CANDIDATES)
    .map((row) => row.id);
}

function buildMatchesForScrapedRows(
  unmatchedProducts: ScrapedMatchRow[],
  standards: StandardForMatch[],
  standardsById: Map<number, StandardForMatch>,
  allStandardIds: number[],
  _tokenIndex: ReturnType<typeof buildStandardizedTokenIndex>,
  limit: number,
  brandAliases?: BrandAliasIndex | null,
): ProductMatchesResult {
  const matches: ProductMatchRow[] = [];
  const spNormById = buildSpNormById(standardsById);
  const spVolsById = buildSpVolsById(standardsById);
  const scoreOpts = { brandAliases: brandAliases ?? null };

  for (const scraped of unmatchedProducts) {
    const candidateIds = pickCandidateIds(
      scraped.name,
      allStandardIds,
      spNormById,
      spVolsById,
      brandAliases,
    );

    let bestSp: StandardForMatch | null = null;
    let bestScored: NonNullable<ReturnType<typeof scoreProductMatch>> | null =
      null;
    let weakSp: StandardForMatch | null = null;
    let weakScored: NonNullable<ReturnType<typeof scoreProductMatch>> | null =
      null;

    for (const spId of candidateIds) {
      const sp = standardsById.get(spId);
      if (!sp) continue;
      if (sp.products.some((p) => p.store === scraped.store)) continue;

      const scored = scoreProductMatch(
        {
          scrapedName: scraped.name,
          scrapedCategory: scraped.category,
          standardizedBrand: sp.brand,
          standardizedName: sp.name,
          standardizedVolume: sp.volume,
          standardizedMainCategory: sp.mainCategory,
        },
        scoreOpts,
      );

      if (
        scored &&
        (!bestScored || scored.finalScore > bestScored.finalScore)
      ) {
        bestSp = sp;
        bestScored = scored;
      }
    }

    if (!bestSp) {
      for (const spId of candidateIds) {
        const sp = standardsById.get(spId);
        if (!sp) continue;
        if (sp.products.some((p) => p.store === scraped.store)) continue;

        const weak = computeMatchScore(
          {
            scrapedName: scraped.name,
            scrapedCategory: scraped.category,
            standardizedBrand: sp.brand,
            standardizedName: sp.name,
            standardizedVolume: sp.volume,
            standardizedMainCategory: sp.mainCategory,
          },
          {
            relaxed: true,
            minScore: MIN_WEAK_MATCH_SCORE,
            brandAliases: brandAliases ?? null,
          },
        );

        if (weak && (!weakScored || weak.finalScore > weakScored.finalScore)) {
          weakSp = sp;
          weakScored = weak;
        }
      }
    }

    if (bestSp && bestScored) {
      matches.push({
        product: scraped,
        standardizedProduct: {
          id: bestSp.id,
          name: bestSp.name,
          brand: bestSp.brand,
          volume: bestSp.volume,
          image: bestSp.image ?? "",
          mainCategory: bestSp.mainCategory,
        },
        similarity: bestScored.similarity,
        fuzzyScore: bestScored.fuzzyScore,
        volumeScore: bestScored.volumeScore,
        brandMatch: bestScored.brandMatch,
        categoryScore: bestScored.categoryScore,
        finalScore: bestScored.finalScore,
        lowConfidence: bestScored.finalScore < 0.62,
      });
    } else if (weakSp && weakScored) {
      matches.push({
        product: scraped,
        standardizedProduct: {
          id: weakSp.id,
          name: weakSp.name,
          brand: weakSp.brand,
          volume: weakSp.volume,
          image: weakSp.image ?? "",
          mainCategory: weakSp.mainCategory,
        },
        similarity: weakScored.similarity,
        fuzzyScore: weakScored.fuzzyScore,
        volumeScore: weakScored.volumeScore,
        brandMatch: weakScored.brandMatch,
        categoryScore: weakScored.categoryScore,
        finalScore: weakScored.finalScore,
        lowConfidence: true,
        weakSuggestion: true,
      });
    } else {
      matches.push({
        product: scraped,
        standardizedProduct: null,
        similarity: 0,
        fuzzyScore: 0,
        volumeScore: 0,
        brandMatch: 0,
        categoryScore: 0,
        finalScore: 0,
        lowConfidence: true,
        noSuggestion: true,
      });
    }
  }

  matches.sort((a, b) => {
    if (a.noSuggestion !== b.noSuggestion) return a.noSuggestion ? 1 : -1;
    if (a.weakSuggestion !== b.weakSuggestion) return a.weakSuggestion ? 1 : -1;
    return b.finalScore - a.finalScore;
  });

  const strong = matches.filter((m) => !m.noSuggestion && !m.weakSuggestion);
  const weak = matches.filter((m) => m.weakSuggestion);
  const none = matches.filter((m) => m.noSuggestion);
  const ranked = [...strong, ...weak, ...none];
  const page = ranked.slice(0, limit);

  return {
    matches: page,
    eligible: unmatchedProducts.length,
    withSuggestion: page.filter((m) => !m.noSuggestion && !m.weakSuggestion).length,
    weakSuggestion: page.filter((m) => m.weakSuggestion).length,
    withoutSuggestion: page.filter((m) => m.noSuggestion).length,
    total: ranked.length,
    limit,
    truncated: ranked.length > page.length,
  };
}

type MetaKindRow = { kind: string; value: string | null };

function metaFromRows(rows: MetaKindRow[]): Omit<MatchCategoryMeta, "maxStoreLinksPerStandard"> {
  const standardizedMainCategories: string[] = [];
  const productCategories: string[] = [];
  const stores: string[] = [];

  for (const row of rows) {
    const value = row.value?.trim();
    if (!value) continue;
    if (row.kind === "sp_main") standardizedMainCategories.push(value);
    else if (row.kind === "cat" && value !== ">") productCategories.push(value);
    else if (row.kind === "store") stores.push(value);
  }

  return {
    standardizedMainCategories: distinctSorted(standardizedMainCategories),
    productCategories: distinctSorted(productCategories),
    stores: distinctSorted(stores),
  };
}

let matchCategoryMetaCache: { at: number; value: MatchCategoryMeta } | null = null;
const MATCH_CATEGORY_META_TTL_MS = 5 * 60_000;

export async function getMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  if (
    matchCategoryMetaCache &&
    Date.now() - matchCategoryMetaCache.at < MATCH_CATEGORY_META_TTL_MS
  ) {
    return matchCategoryMetaCache.value;
  }

  // SELECT DISTINCT — without it we materialize every Product row in Node (~OOM on Render 512MB).
  const rows = await prisma.$queryRaw<MetaKindRow[]>`
    SELECT DISTINCT 'sp_main'::text AS kind, "mainCategory"::text AS value
    FROM "StandardizedProduct"
    WHERE "mainCategory" IS NOT NULL AND TRIM("mainCategory") <> ''
    UNION ALL
    SELECT DISTINCT 'cat'::text, category::text
    FROM "Product"
    WHERE category IS NOT NULL AND TRIM(category) <> '' AND category <> '>'
    UNION ALL
    SELECT DISTINCT 'store'::text, store::text
    FROM "Product"
    WHERE store IS NOT NULL AND TRIM(store) <> ''
  `;

  const value = {
    ...metaFromRows(rows),
    maxStoreLinksPerStandard: MAX_STORE_LINKS_PER_STANDARD,
  };
  matchCategoryMetaCache = { at: Date.now(), value };
  return value;
}

export async function getNewProductMatchCategoryMeta(): Promise<MatchCategoryMeta> {
  const rows = await prisma.$queryRaw<MetaKindRow[]>`
    SELECT DISTINCT 'sp_main'::text AS kind, "mainCategory"::text AS value
    FROM "StandardizedProduct"
    WHERE "mainCategory" IS NOT NULL AND TRIM("mainCategory") <> ''
    UNION ALL
    SELECT DISTINCT 'cat'::text, category::text
    FROM "NewProducts"
    WHERE "processedAt" IS NULL AND category IS NOT NULL AND TRIM(category) <> '' AND category <> '>'
    UNION ALL
    SELECT DISTINCT 'store'::text, store::text
    FROM "NewProducts"
    WHERE "processedAt" IS NULL AND store IS NOT NULL AND TRIM(store) <> ''
  `;

  return {
    ...metaFromRows(rows),
    maxStoreLinksPerStandard: MAX_STORE_LINKS_PER_STANDARD,
  };
}

async function matchScrapedRows(
  unmatchedProducts: ScrapedMatchRow[],
  filters: ProductMatchesFilters,
  limit: number,
  eligible: number,
  logLabel: string,
): Promise<ProductMatchesResult> {
  if (!unmatchedProducts.length) {
    return {
      matches: [],
      eligible,
      withSuggestion: 0,
      weakSuggestion: 0,
      withoutSuggestion: 0,
      total: eligible,
      limit,
      truncated: false,
    };
  }

  const similarityAliases = await prisma.similarityBrandAlias.findMany({
    select: { name: true, matchName: true },
  });
  const brandAliases = buildBrandAliasIndex(similarityAliases);

  const aliasMatchRaw = filters.brandAliasMatch?.trim() || "";
  let aliasCanonicalBrand: string | undefined;
  if (aliasMatchRaw) {
    const aliasNorm = normalizeText(aliasMatchRaw);
    const row = similarityAliases.find(
      (a) => normalizeText(a.matchName) === aliasNorm,
    );
    aliasCanonicalBrand = row?.name?.trim() || undefined;
  }

  const { standardsById, tokenIndex } = await loadStandardsForMatching(
    filters.standardizedMainCategory,
    aliasCanonicalBrand,
    filters.productCategory,
  );
  const remainingIds = [...standardsById.keys()];

  if (
    !filters.standardizedMainCategory?.trim() &&
    filters.productCategory?.trim() &&
    remainingIds.length === 0
  ) {
    console.warn(
      `[${logLabel}] All SP mains + productCategory="${filters.productCategory}" mapped to 0 standards — check SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN`,
    );
  }

  console.log(
    `[${logLabel}] sp=${filters.standardizedMainCategory ?? "(all→map)"} cat=${filters.productCategory ?? ""} store=${filters.store ?? ""} alias=${aliasMatchRaw || "-"}→${aliasCanonicalBrand || "-"} unmatched=${unmatchedProducts.length}/${eligible} standards=${remainingIds.length} brandAliases=${brandAliases.entries.length} rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  );

  const result = buildMatchesForScrapedRows(
    unmatchedProducts,
    [...standardsById.values()],
    standardsById,
    remainingIds,
    tokenIndex,
    limit,
    brandAliases,
  );
  result.eligible = eligible;
  result.total = eligible;
  result.truncated = eligible > result.matches.length;
  await attachStandardImages(result.matches);
  return result;
}

function poolSizeForLimit(_limit: number): number {
  return Math.min(MATCHES_ADMIN_SCORE_POOL, MATCHES_PAGE_LIMIT);
}

export async function getProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(
      filters.limit ?? MATCHES_ADMIN_DEFAULT_LIMIT,
      MATCHES_PAGE_LIMIT,
    ),
  );

  const productWhere: Prisma.ProductWhereInput = {
    standardizedProductId: null,
    category: { not: ">" },
  };
  if (filters.productCategory?.trim()) {
    productWhere.category = {
      equals: filters.productCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }
  if (filters.store?.trim()) {
    productWhere.store = {
      equals: filters.store.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const aliasMatchRaw = filters.brandAliasMatch?.trim() || "";
  if (aliasMatchRaw) {
    productWhere.name = {
      contains: aliasMatchRaw,
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const poolTake = aliasMatchRaw
    ? Math.min(MATCHES_PAGE_LIMIT, Math.max(poolSizeForLimit(limit), 2000))
    : poolSizeForLimit(limit);

  const eligible = await prisma.product.count({ where: productWhere });
  let unmatchedProducts = await prisma.product.findMany({
    where: productWhere,
    orderBy: { id: "asc" },
    take: poolTake,
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  // Whole-token filter (contains "Carn" must not keep "Carnival").
  if (aliasMatchRaw) {
    unmatchedProducts = unmatchedProducts.filter((p) =>
      scrapedNameHasBrandAliasToken(p.name, aliasMatchRaw),
    );
  }

  return matchScrapedRows(
    unmatchedProducts,
    filters,
    limit,
    aliasMatchRaw ? unmatchedProducts.length : eligible,
    "matches",
  );
}

async function attachStandardImages(matches: ProductMatchRow[]): Promise<void> {
  const ids = [
    ...new Set(
      matches
        .map((m) => m.standardizedProduct?.id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  if (!ids.length) return;
  const rows = await prisma.standardizedProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, image: true },
  });
  const imageById = new Map(rows.map((row) => [row.id, row.image ?? ""]));
  for (const match of matches) {
    if (match.standardizedProduct) {
      match.standardizedProduct.image =
        imageById.get(match.standardizedProduct.id) ?? "";
    }
  }
}

export async function getNewProductMatches(
  filters: ProductMatchesFilters = {},
): Promise<ProductMatchesResult> {
  const limit = Math.max(
    1,
    Math.min(
      filters.limit ?? MATCHES_ADMIN_DEFAULT_LIMIT,
      MATCHES_PAGE_LIMIT,
    ),
  );

  const newProductWhere: Prisma.NewProductsWhereInput = {
    processedAt: null,
    category: { not: ">" },
  };
  if (filters.productCategory?.trim()) {
    newProductWhere.category = {
      equals: filters.productCategory.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }
  if (filters.store?.trim()) {
    newProductWhere.store = {
      equals: filters.store.trim(),
      mode: Prisma.QueryMode.insensitive,
    };
  }

  const eligible = await prisma.newProducts.count({ where: newProductWhere });
  const pendingNewProducts = await prisma.newProducts.findMany({
    where: newProductWhere,
    orderBy: { id: "asc" },
    take: poolSizeForLimit(limit),
    select: {
      id: true,
      name: true,
      category: true,
      store: true,
      image: true,
      price: true,
    },
  });

  return matchScrapedRows(
    pendingNewProducts,
    filters,
    limit,
    eligible,
    "new-product-matches",
  );
}
