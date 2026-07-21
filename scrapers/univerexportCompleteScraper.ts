import axios from "axios";
import { ProductData, saveProducts } from "../productService";
import {
  formatPriceRsd,
  parseElakolijeDisplayPrice,
  parseElakolijePrice,
} from "./univerexportPriceUtils";
import {
  UNIVEREXPORT_COMPLETE_CATEGORIES,
  UniverexportCategoryEntry,
} from "./univerexportCategories";

const STORE_NAME = "Univerexport";
const API_URL = "https://elakolije.rs/api/api.php?action=artikli";
const API_KEY =
  "Vi3NmguyYAnZKTgBdFPOgIEls0gNYrMF97w4l9L5YvYiBaeEh3SgkBFSX8RKmCMhJzDqulrklCXtppjSpt6he0x7iOYU7hUxvxAlnr54dUUhgcHziMdiopaPR8gSLIji";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 120;

type ElakolijeArticle = {
  si_art: string;
  naziv: string;
  cena: string | null;
  stara_cena: string | null;
  zavrsetak: string | null;
  zavrsetak_akcije: string | null;
  slika: string | null;
  link: string | null;
  cena_ceo: number | null;
  kolicina?: number;
};

type ElakolijeApiResponse = {
  error?: number;
  status?: string;
  response?: ElakolijeArticle[] | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOfferEndDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  }
  const dotted = trimmed.match(/(\d{2}\.\d{2}\.\d{4})/);
  return dotted ? dotted[1] : null;
}

function isArticleAvailable(article: ElakolijeArticle): boolean {
  const wholePart = Number(article.cena_ceo);
  if (Number.isFinite(wholePart) && wholePart === 0) {
    return false;
  }
  const price = parseElakolijePrice(article.cena, article.cena_ceo);
  return price != null;
}

function mapArticleToProduct(
  article: ElakolijeArticle,
  category: string,
): ProductData | null {
  const name = String(article.naziv || "").trim();
  if (!name) return null;

  const saleNum = parseElakolijePrice(article.cena, article.cena_ceo);
  const oldNum = parseElakolijeDisplayPrice(article.stara_cena);
  const available = isArticleAvailable(article);

  return {
    name,
    price: saleNum != null ? formatPriceRsd(saleNum) : null,
    priceBeforeDiscount:
      oldNum != null && saleNum != null && oldNum > saleNum ? oldNum : null,
    availability: available ? "in_stock" : "out_of_stock",
    image: article.slika ? String(article.slika).trim() : "",
    store: STORE_NAME,
    category,
    offerEndsOn: formatOfferEndDate(article.zavrsetak),
  };
}

async function fetchArticlesPage(
  sifkla: string,
  offset: number,
  limit: number,
): Promise<ElakolijeArticle[]> {
  const { data } = await axios.post<ElakolijeApiResponse>(
    API_URL,
    {
      sifkla,
      si_kat: "",
      datum: "",
      p_nadji: "",
      sort: "",
      si_art: "",
      ulogovan_kor: "",
      offset,
      limit,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      timeout: 45000,
    },
  );

  if (data.error === 1) {
    throw new Error(`Elakolije API error for sifkla=${sifkla} offset=${offset}`);
  }

  const rows = data.response;
  if (!rows || !rows.length) return [];
  return rows;
}

async function scrapeUniverexportCategory(
  entry: UniverexportCategoryEntry,
): Promise<ProductData[]> {
  const category = entry.category || entry.label;
  const unique = new Map<string, ProductData>();
  let offset = 0;

  while (true) {
    const articles = await fetchArticlesPage(entry.sifkla, offset, PAGE_SIZE);
    if (!articles.length) break;

    for (const article of articles) {
      const product = mapArticleToProduct(article, category);
      if (!product) continue;

      const key = String(article.si_art || product.name).trim();
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, product);
        continue;
      }

      if (!existing.price && product.price) {
        unique.set(key, product);
      }
    }

    if (articles.length < PAGE_SIZE) break;
    offset += articles.length;
    await sleep(REQUEST_DELAY_MS);
  }

  return Array.from(unique.values());
}

export async function scrapeUniverexportCompleteProducts(): Promise<ProductData[]> {
  const globalUnique = new Map<string, ProductData>();
  const allCategories = UNIVEREXPORT_COMPLETE_CATEGORIES;
  const limitRaw = process.env.UNIVEREXPORT_CATEGORY_LIMIT;
  const limit =
    limitRaw != null && String(limitRaw).trim() !== ""
      ? Math.max(1, Number.parseInt(String(limitRaw), 10) || allCategories.length)
      : allCategories.length;
  const categories = allCategories.slice(0, limit);

  console.log(`[Univerexport] Starting scrape of ${categories.length} categories…`);

  for (let i = 0; i < categories.length; i++) {
    const entry = categories[i];
    const label = entry.label || entry.sifkla;
    console.log(
      `[Univerexport] (${i + 1}/${categories.length}) ${entry.sifkla} — ${label}`,
    );

    try {
      const products = await scrapeUniverexportCategory(entry);
      for (const product of products) {
        const key = `${product.name}`.toLowerCase();
        if (!globalUnique.has(key)) {
          globalUnique.set(key, product);
        }
      }
      console.log(`[Univerexport] ${entry.sifkla}: ${products.length} products`);
    } catch (err) {
      console.error(`[Univerexport] ${entry.sifkla} failed:`, err);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const allProducts = Array.from(globalUnique.values());
  console.log(`[Univerexport] Total collected: ${allProducts.length}`);

  await saveProducts(allProducts, {
    clearMissingForStore: true,
    clearMissingOnlyForCategories: [
      ...new Set(categories.map((c) => c.category || c.label)),
    ],
  });

  return allProducts;
}

export default {
  scrapeUniverexportCompleteProducts,
  UNIVEREXPORT_COMPLETE_CATEGORIES,
};

function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("univerexportCompleteScraper")) {
    return;
  }

  console.log("Univerexport complete scraper starting…");

  scrapeUniverexportCompleteProducts()
    .then((products) => {
      console.log(`Univerexport complete scraping finished (${products.length} products).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Univerexport complete scraping failed:", err);
      process.exit(1);
    });
}

runIfExecutedDirectly();
