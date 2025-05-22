import { PrismaClient } from '@prisma/client';
import stringSimilarity from 'string-similarity';

const prisma = new PrismaClient();

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

function extractVolumeFromName(name: string): string | null {
  const regex = /(\d+[.,]?\d*)(\s)?(l|litara|litar|ml|mililitar|mililitara|g|grama|kg|kilograma|kom|komada)/i;
  const match = name.match(regex);
  if (!match) return null;

  let amount = parseFloat(match[1].replace(',', '.'));
  let unit = match[3].toLowerCase();

  if (unit === 'ml' || unit.includes('milil')) {
    amount /= 1000;
    unit = 'L';
  } else if (unit === 'g' || unit.includes('grama')) {
    amount /= 1000;
    unit = 'kg';
  } else if (unit.startsWith('kom')) {
    unit = 'kom';
  }

  return `${amount}${unit}`;
}

function extractEggCount(name: string): string | null {
  // Match a number followed by / and a number (e.g. 10/1, 30/1)
  // We extract the first number as the count
  const regex = /(\d+)\/\d+/;
  const match = name.match(regex);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  return `${count}kom`;
}

export async function getProductMatches() {
  const allStandards = await prisma.standardizedProduct.findMany({
  include: {
    products: true, // Load all linked products
  },
});

const standards = allStandards.filter(
  (sp) => sp.products.length <= 2 // Keep only those with 0-2 products
);

  const unmatchedProducts = await prisma.product.findMany({
    where: {
      standardizedProductId: null,
    },
  });

  const matches: any[] = [];

  for (const scraped of unmatchedProducts) {
    const normalizedScraped = normalizeText(scraped.name);
    const extractedVolume = extractVolumeFromName(scraped.name);
    if (!extractedVolume) continue;

    const normalizedVolume = normalizeText(extractedVolume);

    const candidates = standards.filter(sp => {
      if (!sp.volume) return false;
      return normalizeText(sp.volume) === normalizedVolume;
    });

    const scored = candidates
      .map(sp => {
        const combined = `${sp.brand ?? ''} ${sp.name}`;
        const normalizedCombined = normalizeText(combined);
        const similarity = stringSimilarity.compareTwoStrings(normalizedScraped, normalizedCombined);
        return { product: scraped, standardizedProduct: sp, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity);

    const best = scored[0];

    if (best && best.similarity > 0.5) {
      matches.push(best);
    }
  }

  return matches;
}