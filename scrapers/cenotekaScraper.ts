import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

puppeteer.use(StealthPlugin());

interface standardizedProduct {
  name: string;
  mainCategory: string;
  midCategory: string;
  subCategory: string;
  brand: string;
  volume: string;
}

async function saveProducts(products: standardizedProduct[]) {
  for (const product of products) {
    await prisma.standardizedProduct.create({
      data: {
        name: product.name,
        mainCategory: product.mainCategory,
        midCategory: product.midCategory,
        subCategory: product.subCategory,
        brand: product.brand,
        volume: product.volume,
      }
    });
  }
}

// Volume extractor
function extractVolumeFromName(name: string): string | null {
  const regex = /(\d+[.,]?\d*)\s?(l|litara|litar|ml|mililitar|mililitara|g|grama|kg|kilograma)/i;
  const match = name.match(regex);
  if (!match) return null;

  let amount = parseFloat(match[1].replace(',', '.'));
  let unit = match[2].toLowerCase();

  if (unit === 'ml' || unit.includes('milil')) {
    amount /= 1000;
    unit = 'L';
  } else if (unit === 'g' || unit.includes('grama')) {
    amount /= 1000;
    unit = 'kg';
  } else if (unit === 'kg' || unit.includes('kilograma')) {
    unit = 'kg';
  }

  return `${amount}${unit}`;
}

// Brand keyword mapping
const brandMap: Record<string, string> = {
  Zdravo: "Mlekara Subotica",
  Imlek: "Imlek",
  Dukat: "Dukat",
  Zottis: "Zott",
  Zott: "Zott",
  "Dr. Milk": "Dr Milk",
  Meggle: "Meggle",
  Grekos: "Imlek",
  Fruttis: "Fruttis",
  DAR: "DAR",
  JOTOGO: "JoToGo"
};


function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function scrapeCentotekaProducts(url: string): Promise<standardizedProduct[]> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait 5 seconds for JS to load products
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Scroll down to trigger lazy load
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Now wait for the products
  await page.waitForSelector('.product_wrap.product_wrap_grid.d-flex.flex-column', { timeout: 20000 });

  const products = await page.$$eval(
    ".product_wrap.product_wrap_grid.d-flex.flex-column",
    nodes => nodes.map(node => {
      const nameElement = node.querySelector(".product_info.text-center.pt-2.pb-4 a");
      const name = nameElement?.textContent?.trim() || '';
      return { name };
    })
  );

  const formatted: standardizedProduct[] = products.map(p => {
    const originalName = p.name.trim();
    let name = originalName;
    let brand = "";

    for (const keyword in brandMap) {
  if (originalName.toLowerCase().includes(keyword.toLowerCase())) {
    brand = brandMap[keyword];
    // Remove keyword from name if it appears
    const regex = new RegExp(escapeRegex(keyword), 'i');
    name = name.replace(regex, ' ').replace(/\s+/g, ' ').trim();
    break;
  }
}

    const volume = extractVolumeFromName(originalName) || '';

    return {
      name: name,
      mainCategory: "Mlečni proizvodi i jaja",
      midCategory: "Kiselo-mlečni proizvodi",
      subCategory: "Voćni jogurt",
      brand,
      volume,
    };
  });

  await browser.close();
  return formatted;
}

// Example usage
scrapeCentotekaProducts("https://cenoteka.rs/vocni-jogurt/").then(async (products) => {
  console.log(products);
  await saveProducts(products);
  console.log("Products saved to DB");
});