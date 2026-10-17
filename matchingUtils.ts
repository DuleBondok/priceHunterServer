import { compareTwoStrings } from "string-similarity";

/** Product.category (English scraper labels) → StandardizedProduct.mainCategory (Cenoteka). */
export const SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN: Record<string, string[]> = {
  Groceries: ["Namirnice", "Namirnice "],
  Drinks: ["Bezalkoholna pića"],
  Alcohol: ["Alkoholna pića"],
  "Milk and egg products": ["Mlečni proizvodi i jaja"],
  Bakery: ["Pekara, torte i kolači"],
  "Frozen products": ["Smrznuti proizvodi"],
  "Fruits & Vegetables": ["Voće i povrće"],
  "Healthy Food": ["Zdrava hrana"],
  "Sweets and Snacks": ["Slatkiši i grickalice"],
  // Cenoteka: paštete/salame/riba = Meso i riba; gotova jela (Carnex sarma, gulaš…) = Namirnice.
  "Meat & Fish": ["Meso i riba", "Namirnice", "Namirnice "],
  "Personal Care": ["Licna higijena"],
  "Home Care": ["Kućna hemija"],
  "Baby Care": ["Kutak za bebe"],
  "Pet Care": ["Kućni ljubimci"],
};

const STOP_TOKENS = new Set([
  "i",
  "sa",
  "od",
  "za",
  "u",
  "na",
  "po",
  "do",
  "bez",
  "plus",
  "extra",
  "new",
  "novo",
  "pak",
  "kom",
  "the",
  "and",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "dj")
    // 10gr / 10 gr → 10g so tokens and volume parsing stay aligned
    .replace(/(\d+[.,]?\d*)\s*gr\.?\b/g, "$1g")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    // light Serbian morphology for matching (zrnu ≈ zrno)
    .replace(/\bzrnu\b/g, "zrno")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

export function significantTokens(text: string): string[] {
  return tokenize(text).filter(
    (t) => t.length >= 3 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t),
  );
}

export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;
  const intersection = [...tokensA].filter((x) => tokensB.has(x)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

export function extractVolumesNormalized(text: string): number[] {
  // Longer units first so "10gr" is not parsed as "10g" + leftover "r".
  const regex = /(\d+[.,]?\d*)\s*(kg|ml|lit|cl|gr|g|l)\b/gi;
  const matches = [...text.matchAll(regex)];
  const results: number[] = [];

  for (const m of matches) {
    const amount = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    if (Number.isNaN(amount)) continue;
    if (unit === "ml" || unit === "cl") results.push(amount / 1000);
    else if (unit === "l" || unit === "lit") results.push(amount);
    else if (unit === "g" || unit === "gr") results.push(amount / 1000);
    else if (unit === "kg") results.push(amount);
  }

  return results;
}

/**
 * Relative volume similarity. Absolute liter/kg diffs are too small for grams
 * (10g vs 20g = 0.01 → almost no penalty with the old exp(-diff*3)).
 */
export function getBestVolumeScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.5;
  let best = 0;
  for (const v1 of a) {
    for (const v2 of b) {
      const denom = Math.max(v1, v2, 1e-9);
      const relative = Math.abs(v1 - v2) / denom;
      const score = Math.exp(-relative * 4);
      if (score > best) best = score;
    }
  }
  return best;
}

export function categoryAlignmentScore(
  productCategory: string | null | undefined,
  standardizedMainCategory: string | null | undefined,
): number {
  const scraped = String(productCategory ?? "").trim();
  const main = String(standardizedMainCategory ?? "").trim();
  if (!scraped || !main || scraped === ">") return 0.5;
  const allowed = SCRAPED_CATEGORY_TO_STANDARDIZED_MAIN[scraped];
  if (!allowed) return 0.5;
  const normMain = normalizeText(main);
  return allowed.some((a) => normalizeText(a) === normMain) ? 1 : 0;
}

/** Max distinct store listings linked to one standardized product. */
export const MAX_STORE_LINKS_PER_STANDARD = 6;

export function linkedStoreCount(products: Array<{ store: string }>): number {
  return new Set(products.map((p) => p.store)).size;
}

/** Minimum score to count as a confident suggestion. */
export const MIN_MATCH_SCORE = 0.48;

/** Minimum score for a weak / best-effort suggestion when nothing passes MIN_MATCH_SCORE. */
export const MIN_WEAK_MATCH_SCORE = 0.32;

/** Short / alias brand forms that should count as the same brand (e.g. C ≈ CP). */
const BRAND_EQUIVALENTS: Record<string, string[]> = {
  c: ["c", "cp"],
  cp: ["c", "cp"],
};

function brandMatchVariants(normalizedBrand: string): string[] {
  return BRAND_EQUIVALENTS[normalizedBrand] ?? [normalizedBrand];
}

/**
 * SimilarityBrandAlias rows (Similarity matches only — not Brand promote).
 * matchName appears in Product.name, name is StandardizedProduct.brand.
 * Example: matchName "Podr" → name "Podravka".
 */
export type BrandAliasRow = {
  matchName: string;
  name: string;
};

export type BrandAliasIndex = {
  /** Longest matchName first — used to rewrite scraped names. */
  entries: Array<{ matchNorm: string; canonicalNorm: string; canonicalRaw: string }>;
  /** normalized canonical brand → normalized Product-name aliases */
  canonicalToMatches: Map<string, string[]>;
};

export function buildBrandAliasIndex(
  rows: Array<BrandAliasRow | { matchName: string; name: string }>,
): BrandAliasIndex {
  const canonicalToMatches = new Map<string, string[]>();
  const entries: BrandAliasIndex["entries"] = [];

  for (const row of rows || []) {
    const matchRaw = String(row.matchName || "").trim().replace(/\s+/g, " ");
    const canonicalRaw = String(row.name || "").trim().replace(/\s+/g, " ");
    if (!matchRaw || !canonicalRaw) continue;
    const matchNorm = normalizeText(matchRaw);
    const canonicalNorm = normalizeText(canonicalRaw);
    if (!matchNorm || !canonicalNorm) continue;

    entries.push({ matchNorm, canonicalNorm, canonicalRaw });
    const list = canonicalToMatches.get(canonicalNorm) ?? [];
    if (!list.includes(matchNorm)) list.push(matchNorm);
    canonicalToMatches.set(canonicalNorm, list);

    // Also index hard-coded equivalents of the canonical brand.
    for (const variant of brandMatchVariants(canonicalNorm)) {
      if (variant === canonicalNorm) continue;
      const alt = canonicalToMatches.get(variant) ?? [];
      if (!alt.includes(matchNorm)) alt.push(matchNorm);
      canonicalToMatches.set(variant, alt);
    }
  }

  entries.sort((a, b) => b.matchNorm.length - a.matchNorm.length);
  return { entries, canonicalToMatches };
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite Product-name brand aliases to the canonical StandardizedProduct.brand
 * so similarity / fuzzy / brand scoring can align (e.g. "Podr Vegeta" → "podravka vegeta").
 * Returns normalized text (safe to feed back into computeMatchScore).
 */
export function expandScrapedNameWithBrandAliases(
  scrapedName: string,
  aliasIndex?: BrandAliasIndex | null,
): string {
  if (!aliasIndex?.entries.length) return scrapedName;
  let norm = normalizeText(scrapedName);
  if (!norm) return scrapedName;

  for (const entry of aliasIndex.entries) {
    const token = escapeRegexLiteral(entry.matchNorm);
    const pattern = new RegExp(`(?:^|\\s)${token}(?=\\s|$)`);
    if (!pattern.test(norm)) continue;
    norm = norm
      .replace(pattern, ` ${entry.canonicalNorm} `)
      .replace(/\s+/g, " ")
      .trim();
  }
  return norm;
}

export function brandMatchScore(
  scrapedName: string,
  brand: string | null | undefined,
  aliasIndex?: BrandAliasIndex | null,
): number {
  const normalizedScraped = normalizeText(scrapedName);
  const normalizedBrand = brand ? normalizeText(brand) : "";
  if (!normalizedBrand) return 0;

  const scrapedTokens = new Set(tokenize(scrapedName));
  for (const variant of brandMatchVariants(normalizedBrand)) {
    if (!variant) continue;
    // Whole-token match (needed for short brands like "C" / "CP").
    if (scrapedTokens.has(variant)) return 1;
    if (variant.length >= 3 && normalizedScraped.includes(variant)) return 1;
  }

  // Similarity brand aliases: Product has "Podr", SP.brand is "Podravka".
  if (aliasIndex) {
    const aliases = aliasIndex.canonicalToMatches.get(normalizedBrand) ?? [];
    for (const alias of aliases) {
      if (!alias) continue;
      if (scrapedTokens.has(alias)) return 1;
      if (alias.length >= 2) {
        const aliasPattern = new RegExp(`(?:^|\\s)${escapeRegexLiteral(alias)}(?=\\s|$)`);
        if (aliasPattern.test(normalizedScraped)) return 1;
      }
    }
  }

  const brandTokens = significantTokens(brand ?? "");
  if (!brandTokens.length) return 0;
  return brandTokens.every((token) => normalizedScraped.includes(token)) ? 1 : 0;
}

export type MatchScoreInput = {
  scrapedName: string;
  scrapedCategory?: string | null;
  standardizedBrand?: string | null;
  standardizedName: string;
  standardizedVolume?: string | null;
  standardizedMainCategory?: string | null;
};

export type MatchScoreResult = {
  similarity: number;
  fuzzyScore: number;
  volumeScore: number;
  brandMatch: number;
  categoryScore: number;
  finalScore: number;
};

export type MatchScoreOptions = {
  /** Skip token-overlap pre-filters (for best-effort fallback). */
  relaxed?: boolean;
  /** Return null when finalScore is below this (default MIN_MATCH_SCORE). */
  minScore?: number;
  /** SimilarityBrandAlias map (Product name token → StandardizedProduct.brand). */
  brandAliases?: BrandAliasIndex | null;
};

export function computeMatchScore(
  input: MatchScoreInput,
  options: MatchScoreOptions = {},
): MatchScoreResult | null {
  const minScore = options.minScore ?? MIN_MATCH_SCORE;
  const relaxed = options.relaxed ?? false;
  const brandAliases = options.brandAliases ?? null;

  // Expand Product-name brand aliases before scoring (Podr → Podravka).
  const scrapedForMatch = expandScrapedNameWithBrandAliases(
    input.scrapedName,
    brandAliases,
  );

  const normalizedScraped = normalizeText(scrapedForMatch);
  const normalizedSpName = normalizeText(input.standardizedName);
  const normalizedCombined = normalizeText(
    `${input.standardizedBrand ?? ""} ${input.standardizedName}`,
  );

  if (!relaxed) {
    const sigScraped = significantTokens(scrapedForMatch);
    const sigCombined = significantTokens(normalizedCombined);
    const sigOverlap = sigScraped.filter((t) => sigCombined.includes(t));

    if (!sigOverlap.length) {
      const fuzzyOnly = compareTwoStrings(normalizedScraped, normalizedCombined);
      if (fuzzyOnly < 0.72) return null;
    } else if (sigScraped.length >= 2 && sigOverlap.length < 2) {
      const fuzzyCheck = compareTwoStrings(normalizedScraped, normalizedCombined);
      if (fuzzyCheck < 0.6) return null;
    }
  }

  const tokenSimCombined = tokenSimilarity(normalizedScraped, normalizedCombined);
  const tokenSimNameOnly = tokenSimilarity(normalizedScraped, normalizedSpName);
  const similarity = Math.max(tokenSimCombined, tokenSimNameOnly);

  const fuzzyCombined = compareTwoStrings(normalizedScraped, normalizedCombined);
  const fuzzyNameOnly = compareTwoStrings(normalizedScraped, normalizedSpName);
  const fuzzyScore = Math.max(fuzzyCombined, fuzzyNameOnly);

  const scrapedVolumes = extractVolumesNormalized(input.scrapedName);
  const spVolumes = extractVolumesNormalized(
    `${input.standardizedVolume ?? ""} ${input.standardizedName}`,
  );
  const volumeScore = getBestVolumeScore(scrapedVolumes, spVolumes);
  const bothVolumesKnown = scrapedVolumes.length > 0 && spVolumes.length > 0;

  // Hard reject clear quantity mismatches (e.g. 10g vs 20g) once both sides parse.
  if (bothVolumesKnown && volumeScore < 0.4) {
    return null;
  }

  const brandMatch = brandMatchScore(
    input.scrapedName,
    input.standardizedBrand,
    brandAliases,
  );

  const categoryScore = categoryAlignmentScore(
    input.scrapedCategory,
    input.standardizedMainCategory,
  );

  if (categoryScore === 0) {
    return null;
  }

  // Exact quantity match (28g↔28g, 1l↔1l) should dominate ranking.
  const exactVolume = bothVolumesKnown && volumeScore >= 0.98;
  const volumeWeight = exactVolume ? 0.45 : bothVolumesKnown ? 0.28 : 0.12;
  const nameWeight = exactVolume ? 0.2 : bothVolumesKnown ? 0.37 : 0.53;
  let finalScore =
    Math.max(similarity, fuzzyScore * 0.95) * nameWeight +
    fuzzyScore * 0.15 +
    volumeScore * volumeWeight +
    brandMatch * 0.1 +
    categoryScore * 0.1;

  if (exactVolume) {
    finalScore = Math.min(1, finalScore + 0.12);
  }

  if (finalScore < minScore) return null;

  return {
    similarity,
    fuzzyScore,
    volumeScore,
    brandMatch,
    categoryScore,
    finalScore,
  };
}

export function scoreProductMatch(
  input: MatchScoreInput,
  options: MatchScoreOptions = {},
): MatchScoreResult | null {
  return computeMatchScore(input, options);
}

/** Stable tokens for inverted index: words plus normalized volume (vol180 for 180g). */
export function volumeIndexTokens(text: string): string[] {
  return extractVolumesNormalized(text).map(
    (liters) => `vol${Math.round(liters * 1000)}`,
  );
}

export function lookupTokens(text: string): string[] {
  return [...new Set([...significantTokens(text), ...volumeIndexTokens(text)])];
}

export function buildStandardizedTokenIndex(
  standards: Array<{
    id: number;
    brand: string | null;
    name: string;
    volume?: string | null;
  }>,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const sp of standards) {
    const tokens = lookupTokens(
      `${sp.brand ?? ""} ${sp.name} ${sp.volume ?? ""}`,
    );
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      const list = index.get(token);
      if (list) list.push(sp.id);
      else index.set(token, [sp.id]);
    }
  }
  return index;
}

export function candidateStandardizedIds(
  scrapedName: string,
  tokenIndex: Map<string, number[]>,
  _allIds: number[],
): number[] {
  const tokens = lookupTokens(scrapedName);
  if (!tokens.length) return [];

  const counts = new Map<number, number>();
  for (const token of tokens) {
    const ids = tokenIndex.get(token);
    if (!ids) continue;
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  if (!counts.size) return [];

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export function rankStandardIdsByNameSimilarity(
  scrapedName: string,
  ids: number[],
  combinedNameById: (id: number) => string,
): number[] {
  const scrapedNorm = normalizeText(scrapedName);
  return ids
    .map((id) => ({
      id,
      fuzzy: compareTwoStrings(
        scrapedNorm,
        normalizeText(combinedNameById(id)),
      ),
    }))
    .sort((a, b) => b.fuzzy - a.fuzzy)
    .map((row) => row.id);
}
