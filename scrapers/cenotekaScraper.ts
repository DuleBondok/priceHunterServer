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
  image: string;
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
        image: product.image,
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
  "Mlekara Šabac": "Mlekara Šabac",
  "Mlekara Subotica": "Mlekara Subotica",
  Biser: "Biser",
  Vindija: "Vindija",
  "Mama's Toast": "Mama's Toast",
  Paladin: "Paladin",
  "Mlekovita": "Mlekovita",
  Casttelo: "Casttelo",
  Zanetti: "Zanetti",
  Galbani: "Galbani",
  Arla: "Arla",
  "V gusto": "Gusto Dairy",
  Frico: "Frico",
  "Ille De France": "Ile De France",
  "Mama's Pizza": "Mama's Pizza",
  Capone: "Capone",
  Viofast: "Viofast",
  "Ile De France":"Ile De France",
  Perffeta: "Biser",
  Alambra: "Alambra",
  Pastir: "Pastir",
  Rougette: "Rougette",
  "Gusto Dairy": "Gusto Dairy",
  "Olimp Ex": "Olimp Ex",
  Korab: "Korab Trnica",
  President: "President",
  "CARPE DIEM": "Carpe Diem",
  Yomleko: "YoMleko",
  Imlek: "Imlek",
  Dukat: "Dukat",
  Dukatos: "Dukat",
  "Vegan Gourmet": "Gusto Dairy",
  "Happy Cow": "Happy Cow",
  "Farma Parnasos": "Farma Parnasos",
  Violife: "Violife",
  Hofmeister: "Hofmeister",
  Dorblu: "Dorblu",
  Belje: "Belje",
  Kasereim:"Kaserei Champignon",
  Trevalli: "Trevalli",
  "Green Vie": "Green Vie",
  Biraghi: "Biraghi",
  "Vasa Mlekara": "Vaša Mlekara",
  "PK Zlatibor": "PK Zlatibor",
  Corpezza: "Corpezza",
  "Le Rustique": "Le Rustique",
  Lovilio: "Lovilio",
  Milbona: "Milbona",
  Bluedino: "Bluedino",
  Corp: "Corp",
  Zottis: "Zott",
  Zott: "Zott",
  "DR.MILK": "Dr Milk",
  Meggle: "Meggle",
  Grekos: "Imlek",
  Fruttis: "Fruttis",
  DAR: "DAR",
  JOTOGO: "JoToGo",
  "Balans+":"Imlek",
  Granice: "Mlekara Granice",
  "Zapis Tare": "Zapis Tare",
  Premia: "Maxi",
  "K Plus": "K Plus",
  UMK:"UMK",
  "Nature's Promise": "Nature's Promise",
  Dobro: "Dobro",
  Biomlek: "Biomlek",
  Pilos: "Pilos",
  "Select Milk": "Select Milk",
  "Lučar" : "Lučar",
  Olympus: "Olympus",
  Jager: "Jager",
  "Mlekara Homolje": "Mlekara Homolje",
  Dodoni: "Dodoni",
  "Z'Bregov": "Z Bregov",
  "MULLER": "Muller",
  "Mlekara Pančevo": "Mlekara Pančevo",
  Bergarder: "Bergarder",
  "Lazar Blace": "Mlekara Lazar Blace",
  Steffel: "Steffel",
  Yayla: "Yayla",
  Kolios: "Kolios",
  Leerdammer: "Leerdammer",
  Castello: "Castello",
  Snack: "Hofmeister",
  Sirko: "Mlekara Šabac",
  Abc: "ABC",
  Kremsi: "Mlekara Subotica",
  Lurpak: "Lurpak",
  Dijamant: "Dijamant",
  Vital: "Vital",
  Polimark: "Polimark",
  Halta: "Halta",
  Puddis: "Campina",
  Neoburger: "Neoburger",
  "Dr.Oetker": "Dr. Oetker",

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

      const imgElement = node.querySelector("img");
      const image = imgElement ? 'https://www.cenoteka.rs' + imgElement.getAttribute("src") : '';
      return { name, image };
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
      midCategory: "Deserti",
      subCategory: "Sutlijaš",
      brand,
      volume,
      image: p.image,
    };
  });

  await browser.close();
  return formatted;
}

// Example usage
scrapeCentotekaProducts("https://cenoteka.rs/sutlijas/").then(async (products) => {
  console.log(products);
  await saveProducts(products);
  console.log("Products saved to DB");
});