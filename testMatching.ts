import stringSimilarity from 'string-similarity';

type StandardProduct = {
  id: number;
  name: string;
  volume: string; // example: "1L", "1.5L", "0.5L"
};

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

// Extracts volume and converts to liters as a string like "1L", "1.5L"
function extractVolumeFromName(name: string): string | null {
  const regex = /(\d+(\.\d+)?)(\s)?(l|litara|litar|ml|mililitar|mililitara)/i;
  const match = name.match(regex);
  if (!match) return null;

  let amount = parseFloat(match[1]);
  const unit = match[4].toLowerCase();

  if (unit === 'ml' || unit.includes('milil')) {
    amount = amount / 1000;
  }

  return `${amount}L`;
}

function matchStandardProduct(
  scrapedName: string,
  standardProducts: StandardProduct[]
): StandardProduct | null {
  const normalizedScraped = normalizeText(scrapedName);
  const extractedVolume = extractVolumeFromName(scrapedName);

  if (!extractedVolume) {
    console.log('❌ Could not extract volume from scraped name.');
    return null;
  }

  const candidates = standardProducts.filter(
    sp => normalizeText(sp.volume) === normalizeText(extractedVolume)
  );

  if (candidates.length === 0) {
    console.log(`❌ No standardized products found with volume: ${extractedVolume}`);
    return null;
  }

  const matches = candidates
    .map(sp => {
      const similarity = stringSimilarity.compareTwoStrings(normalizedScraped, normalizeText(sp.name));
      return { ...sp, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const bestMatch = matches[0];

  if (bestMatch && bestMatch.similarity > 0.5) {
    console.log(`✅ Best match: ${bestMatch.name} (Similarity: ${bestMatch.similarity.toFixed(2)})`);
    return bestMatch;
  } else {
    console.log('❌ No good name match found (even with same volume).');
    return null;
  }
}

// ✅ Test it manually
const scrapedProductName = "Imlek Napitak od badema Oaza Imlek 1l TB";

const standardizedProducts: StandardProduct[] = [
  { id: 1, name: "Nature's Promise Napitak od badema bez glutena BIO 1L TP", volume: "1L" },
  { id: 2, name: "Joya Napitak od soje sa kalcijumom 1L TP", volume: "1L" },
  { id: 3, name: "Alpro Napitak badem bez šećera 1L", volume: "1L" },
  { id: 4, name: "Boom Box Ovseni napitak badem BIO 1L TP", volume: "1L" },
  { id: 5, name: "Alpro Napitak badem 1L TP", volume: "1L" },
  { id: 6, name: "Nature's Promise Napitak od soje bez glutena BIO 1L TP", volume: "1L" },
  { id: 7, name: "Alpro Sojin napitak vanila 1L TP", volume: "1L" },
  { id: 8, name: "Alpro Sojin napitak protein 1L TP", volume: "1L" },
  { id: 9, name: "Alpro Napitak kokos badem 1L TP", volume: "1L" },
  { id: 10, name: "Imlek Oaza napitak od badema 1L TP", volume: "1L" },
  { id: 11, name: "Alpro Napitak Not Milk 3.5% 1L TP", volume: "1L" },
  { id: 12, name: "Alpro Napitak lešnik 1L TP", volume: "1L" },
  { id: 13, name: "Alpro Napitak kokos i pirinač 1L TP", volume: "1L" },
  { id: 14, name: "Nature's Promise Napitak od spelte BIO 1L TP", volume: "1L" },
  { id: 15, name: "Alpro Barista ovseno mleko 1L TP", volume: "1L" },
  { id: 16, name: "Alpro Sojino mleko vanila 250ml TP", volume: "0.25L" },
  { id: 17, name: "Riso Scotti Napitak od pirinča 1L TP", volume: "1L" },
  { id: 18, name: "Alpro Napitak kokos bez šećera 1L TP", volume: "1L" },
  { id: 19, name: "Boom Box Ovseni napitak sa lešnikom 500ml TP", volume: "0.5L" },
  { id: 20, name: "Boom Box Ovseni napitak sa vanilom 1L TP", volume: "1L" },
  { id: 21, name: "Imlek Oaza napitak od ovsa 1L Tp", volume: "1L" },
  { id: 22, name: "Joya Napitak od badema 1L TP", volume: "1L" },
  { id: 23, name: "Alpro Mleko ukus čokolade Soja 250ml TP", volume: "0.25L" },
  { id: 24, name: "Nature's Promise Napitak od ovsa BIO 1L TP", volume: "1L" },
];

// Run the test
const matched = matchStandardProduct(scrapedProductName, standardizedProducts);
console.log('Matched product:', matched);