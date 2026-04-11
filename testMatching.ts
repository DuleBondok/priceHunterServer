import { PrismaClient } from '@prisma/client';
import stringSimilarity from 'string-similarity';

const prisma = new PrismaClient();

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
 * Extract ALL volumes and normalize to liters (number)
 * Handles messy strings like: 0.335KG0,355ml
 */
function extractVolumesNormalized(text: string): number[] {
  const regex = /(\d+[.,]?\d*)(\s)?(l|ml|kg|g)/gi;
  const matches = [...text.matchAll(regex)];

  const results: number[] = [];

  for (const m of matches) {
    let amount = parseFloat(m[1].replace(',', '.'));
    let unit = m[3].toLowerCase();

    if (unit === 'ml') {
      results.push(amount / 1000);
    } else if (unit === 'l') {
      results.push(amount);
    } else if (unit === 'g') {
      // assume liquid-like products
      results.push(amount / 1000);
    } else if (unit === 'kg') {
      results.push(amount);
    }
  }

  return results;
}

/**
 * Find best volume match between two arrays
 */
function getBestVolumeScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;

  let bestDiff = Infinity;

  for (const v1 of a) {
    for (const v2 of b) {
      const diff = Math.abs(v1 - v2);
      if (diff < bestDiff) bestDiff = diff;
    }
  }

  // Convert difference to score (0–1)
  return Math.max(0, 1 - bestDiff); // tolerance built-in
}

export async function getProductMatches() {
  const allStandards = await prisma.standardizedProduct.findMany({
    include: {
      products: true,
    },
  });

  const standards = allStandards.filter(
    (sp) => sp.products.length <= 2
  );

  const unmatchedProducts = await prisma.product.findMany({
    where: {
      standardizedProductId: null,
    },
  });

  const matches: any[] = [];

  for (const scraped of unmatchedProducts) {
    const normalizedScraped = normalizeText(scraped.name);
    const scrapedVolumes = extractVolumesNormalized(scraped.name);

    let bestMatch: any = null;

    for (const sp of standards) {
      const combined = `${sp.brand ?? ''} ${sp.name}`;
      const normalizedCombined = normalizeText(combined);

      const similarity = stringSimilarity.compareTwoStrings(
        normalizedScraped,
        normalizedCombined
      );

      const spVolumes = extractVolumesNormalized(sp.volume ?? '');

      const volumeScore = getBestVolumeScore(
        scrapedVolumes,
        spVolumes
      );

      // 🔥 FINAL SCORE (tweak weights if needed)
      const finalScore = similarity * 0.8 + volumeScore * 0.2;

      if (!bestMatch || finalScore > bestMatch.finalScore) {
        bestMatch = {
          product: scraped,
          standardizedProduct: sp,
          similarity,
          volumeScore,
          finalScore,
        };
      }
    }

    // threshold
    if (bestMatch && bestMatch.finalScore > 0.45) {
      matches.push(bestMatch);
    }
  }

  return matches.sort((a, b) => b.finalScore - a.finalScore);
}