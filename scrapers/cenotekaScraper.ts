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
  "Mlekara Šabac": "Mlekara sabac",
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
  "Vasa Mlekara": "Vasa Mlekara",
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
  "Mlekara Pančevo": "Mlekara Pancevo",
  Bergarder: "Bergarder",
  "Lazar Blace": "Mlekara Lazar Blace",
  Steffel: "Steffel",
  Yayla: "Yayla",
  Kolios: "Kolios",
  Leerdammer: "Leerdammer",
  Castello: "Castello",
  Snack: "Hofmeister",
  Sirko: "Mlekara Sabac",
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
  "Aqua Viva": "Aqua Viva",
  Rosa: "Rosa",
  "Mivela": "Mg Mivela",
  Prolom: "Prolom voda",
  "Voda Voda": "Voda Voda",
  Jana: "Jana",
  Jazak: "Jazak Voda",
  "Life Spring": "Nectar",
  Donat: "Donat",
  Fiji: "Fiji Water",
  "Vrnjci": "Voda Vrnjci",
  "Acqua Panna": "Acqua Panna",
  "San Benedetto": "San Benedetto",
  "Radenska": "Radenska Voda",
  "Na Eks": "Na Eks",
  Saguaro: "Saguaro",
  Evian: "Evian",
  Gala: "Aqua Gala",
  Tronoša: "Tronoša Voda",
  "Knjaz Miloš": "Knjaz Milos",
  Powerade: "Powerade",
  Nutrend: "Nutrend",
  "Moj Dan": "Moj Dan",
  "San Pellegrino": "San Pellegrino",
  Heba: "Heba",
  Perrier: "Perrier",
  Ivorell: "Ivorell",
  Minaqua: "Minaqua",
  Karađorđe: "Palanacki Kiseljak",
  "Vitamin Well": "Vitamin Well",
  Dana: "Dana",
  Fructal: "Fructal",
  Oshee: "Oshee",
  Reload: "Reload",
  Romerquelle: "Romerquelle",
  Rauch: "Rauch",
  Cedevita: "Cedevita",
  Guarana: "Guarana",
  "Red Bull": "Red Bull",
  "Ultra Energy": "Ultra Energy",
  "Monster":"Monster",
  Hell: "Hell",
  Booster: "Booster",
  Nocco: "Nocco",
  Battery: "Battery",
  "G Drive": "G Drive",
  Baka: "Baka",
  Hollinger: "Hollinger",
  Sinalco: "Sinalco",
  Excess: "Excess",
  Grand: "Grand",
  Jacobs: "Jacobs",
  Doncafe: "Doncafe",
  "C Kafa": "C Kafa",
  Franck: "Franck",
  Bonito: "Bonito",
  ARA: "Ara",
  Kafeterija: "Kafetereija",
  Kafica: "Kafica",
  Perla: "Perla",
  Przionicar: "Przionicar",
  Caffico: "Caffico",
  Ritual: "Ritaul",
  Kraljica: "Kraljica",
  "Extra Arabica": "Extra Arabica",
  "Dobro jutro": "Dobro jutro",
  "Drive Cafe": "Drive Cafe",
  "DM Bio": "DM BIO",
  "All caffe": "All caffe",
  Sunga: "Sunga",
  Nescafe: "Nescafe",
  "La Festa": "La Festa",
  Ristora: "Ristora",
  Bellarom: "Bellarom",
  Illy:"Illy",
  Kimbo: "Kimbo",
  Starbucks: "Starbucks",
  Hochwald: "Hochwald",
  Parmalat: "Parmalat",
  Landessa: "Landessa",
  Cafemio: "Cafemio",
  "Lavazza": "Lavazza",
  Segafredo: "Segafredo",
  Hausbrandt: "Hausbrandt",
  Amigos: "Amigos",
  "Barcaffe": "Barcaffe",
  Rivolta: "Rivolta",
  Kilo: "Kilo",
  Carraro: "Carraro",
  Pera: "Pera",
  Dimello: "Dimello",
  Gimoka: "Gimoka",
  Covim: "Covim",
  









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
      mainCategory: "Pica",
      midCategory: "Kafa",
      subCategory: "Espresso kafa",
      brand,
      volume,
      image: p.image,
    };
  });

  await browser.close();
  return formatted;
}

// Example usage
scrapeCentotekaProducts("https://cenoteka.rs/espresso-kafa/p/9/").then(async (products) => {
  console.log(products);
  await saveProducts(products);
  console.log("Products saved to DB");
});