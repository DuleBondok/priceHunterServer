/**
 * Re-sync Univerexport prices from Elakolije API (fixes inflated + false-positive /1000 fixes).
 *
 * Run: npx ts-node scripts/refreshUniverexportPrices.ts
 * Dry: npx ts-node scripts/refreshUniverexportPrices.ts --dry-run
 */
import axios from "axios";
import prisma from "../prismaClient";
import { UNIVEREXPORT_COMPLETE_CATEGORIES } from "../scrapers/univerexportCategories";
import {
  formatPriceRsd,
  parseElakolijeDisplayPrice,
  parseElakolijePrice,
} from "../scrapers/univerexportPriceUtils";

const API_URL = "https://elakolije.rs/api/api.php?action=artikli";
const API_KEY =
  "Vi3NmguyYAnZKTgBdFPOgIEls0gNYrMF97w4l9L5YvYiBaeEh3SgkBFSX8RKmCMhJzDqulrklCXtppjSpt6he0x7iOYU7hUxvxAlnr54dUUhgcHziMdiopaPR8gSLIji";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 120;

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`"´¿]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Article = {
  naziv: string;
  cena: string | null;
  stara_cena: string | null;
  cena_ceo: number | null;
};

async function fetchPage(sifkla: string, offset: number): Promise<Article[]> {
  const { data } = await axios.post(
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
      limit: PAGE_SIZE,
    },
    {
      headers: { "Content-Type": "application/json", "X-API-KEY": API_KEY },
      timeout: 45000,
    },
  );
  return data.response ?? [];
}

async function fetchAllPrices(): Promise<
  Map<string, { price: string | null; priceBeforeDiscount: number | null }>
> {
  const priceByKey = new Map<
    string,
    { price: string | null; priceBeforeDiscount: number | null }
  >();

  for (let i = 0; i < UNIVEREXPORT_COMPLETE_CATEGORIES.length; i++) {
    const entry = UNIVEREXPORT_COMPLETE_CATEGORIES[i];
    console.log(
      `[${i + 1}/${UNIVEREXPORT_COMPLETE_CATEGORIES.length}] ${entry.sifkla} — ${entry.label}`,
    );

    let offset = 0;
    while (true) {
      const articles = await fetchPage(entry.sifkla, offset);
      if (!articles.length) break;

      for (const a of articles) {
        const name = String(a.naziv || "").trim();
        if (!name) continue;
        const saleNum = parseElakolijePrice(a.cena, a.cena_ceo);
        const oldNum = parseElakolijeDisplayPrice(a.stara_cena);
        priceByKey.set(normalizeName(name), {
          price: saleNum != null ? formatPriceRsd(saleNum) : null,
          priceBeforeDiscount:
            oldNum != null && saleNum != null && oldNum > saleNum ? oldNum : null,
        });
      }

      if (articles.length < PAGE_SIZE) break;
      offset += articles.length;
      await sleep(REQUEST_DELAY_MS);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return priceByKey;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const priceByKey = await fetchAllPrices();
  console.log(`Fetched ${priceByKey.size} unique product prices from API.`);

  const existing = await prisma.product.findMany({
    where: { store: "Univerexport" },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      price: true,
      priceBeforeDiscount: true,
    },
  });

  let updated = 0;
  for (const row of existing) {
    const key = row.normalizedName ?? normalizeName(row.name);
    const fresh = priceByKey.get(key);
    if (!fresh?.price) continue;

    const beforeSame =
      fresh.price === row.price &&
      (fresh.priceBeforeDiscount ?? null) ===
        (row.priceBeforeDiscount != null ? Number(row.priceBeforeDiscount) : null);
    if (beforeSame) continue;

    console.log(
      `[${row.id}] ${row.name}\n  ${row.price} -> ${fresh.price}${
        fresh.priceBeforeDiscount != null
          ? ` | before: ${row.priceBeforeDiscount} -> ${fresh.priceBeforeDiscount}`
          : ""
      }`,
    );

    if (!dryRun) {
      await prisma.product.update({
        where: { id: row.id },
        data: {
          price: fresh.price,
          priceBeforeDiscount: fresh.priceBeforeDiscount,
        },
      });
    }
    updated++;
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${updated} products.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
