/**
 * Scrapes physical Idea store addresses from public “Prodavnice …” pages
 * and syncs them into the `Store` table (name Idea, per-city rows).
 *
 * Default URLs: Beograd + Novi Sad. Optional CLI filter matches part of the URL slug, e.g.:
 *   npx ts-node scrapers/ideaStoresScraper.ts Novi-Sad
 *   npx ts-node scrapers/ideaStoresScraper.ts Beograd
 *
 * Coordinates: see `utils/nominatimGeocode.ts` (Nominatim; listing HTML has no per-store lat/lng).
 *
 * Run from the `backend` folder:
 *   npx ts-node scrapers/ideaStoresScraper.ts
 *
 * Scrape only (no DB): SKIP_DB_SAVE=1 npx ts-node scrapers/ideaStoresScraper.ts
 * Skip geocoding (fast, stores 0,0): SKIP_GEOCODE=1 npx ts-node scrapers/ideaStoresScraper.ts
 */
import { launchBrowser } from "./puppeteerBrowser";
import prisma from "../prismaClient";
import {
  geocodeWithNominatim,
  sleepMs,
} from "../utils/nominatimGeocode";

export type IdeaStoreListing = {
  url: string;
  city: string;
  /** Substring that appears in the real store table (not the map widget). */
  tableMarker: string;
};

/** [Prodavnice Beograd](https://www.idea.rs/Prodavnice/Prodavnice-Beograd), [Novi Sad](https://www.idea.rs/Prodavnice/Prodavnice-Novi-Sad) */
export const IDEA_STORE_LISTINGS: IdeaStoreListing[] = [
  {
    url: "https://www.idea.rs/Prodavnice/Prodavnice-Beograd",
    city: "Beograd",
    tableMarker: "Aleksinačkih",
  },
  {
    url: "https://www.idea.rs/Prodavnice/Prodavnice-Novi-Sad",
    city: "Novi Sad",
    tableMarker: "Fruškogorska",
  },
];

const STORE_NAME = "Idea";

const PLACEHOLDER_LAT = 0;
const PLACEHOLDER_LNG = 0;

/** Nominatim bulk policy: stay ≥ ~1 request/second. */
const NOMINATIM_GAP_MS = 1100;

export function normalizeIdeaStreetAddress(linkText: string): string {
  return linkText
    .replace(/\s+IDEA\s+organic\s*$/i, "")
    .replace(/\s+IDEA\s+super\s*$/i, "")
    .replace(/\s+IDEA\s*$/i, "")
    .trim();
}

function shouldSkipDbSave(): boolean {
  const v = process.env.SKIP_DB_SAVE?.toLowerCase();
  return v === "1" || v === "true" || process.argv.includes("--no-save");
}

function shouldSkipGeocode(): boolean {
  const v = process.env.SKIP_GEOCODE?.toLowerCase();
  return v === "1" || v === "true";
}

/** Optional argv tokens (not `--` flags): match if URL contains token (case-insensitive). */
function listingsForCliArgs(): IdeaStoreListing[] {
  const tokens = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));
  if (tokens.length === 0) {
    return [...IDEA_STORE_LISTINGS];
  }
  const normalized = tokens.map((t) => t.toLowerCase().replace(/\s+/g, ""));
  const picked = IDEA_STORE_LISTINGS.filter((loc) =>
    normalized.some((tok) => {
      const slug = loc.url.replace(/^https?:\/\/[^/]+\//i, "").toLowerCase();
      return slug.includes(tok) || loc.city.toLowerCase().replace(/\s+/g, "") === tok;
    }),
  );
  return picked;
}

export async function geocodeIdeaStoreAddresses(
  addresses: string[],
  city: string,
): Promise<{ lat: number; lng: number }[]> {
  if (shouldSkipGeocode()) {
    return addresses.map(() => ({
      lat: PLACEHOLDER_LAT,
      lng: PLACEHOLDER_LNG,
    }));
  }

  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const q = `${address}, ${city}, Serbia`;
    const coords = await geocodeWithNominatim(q);
    if (coords) {
      out.push(coords);
    } else {
      console.warn(`Geocode miss (${i + 1}/${addresses.length}): ${q}`);
      out.push({ lat: PLACEHOLDER_LAT, lng: PLACEHOLDER_LNG });
    }
    if (i < addresses.length - 1) {
      await sleepMs(NOMINATIM_GAP_MS);
    }
  }
  return out;
}

/** @deprecated Use {@link geocodeIdeaStoreAddresses} with city `"Beograd"`. */
export async function geocodeIdeaBeogradAddresses(
  addresses: string[],
): Promise<{ lat: number; lng: number }[]> {
  return geocodeIdeaStoreAddresses(addresses, "Beograd");
}

export async function scrapeIdeaStoreAddresses(
  listing: IdeaStoreListing,
): Promise<string[]> {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const marker = listing.tableMarker;

  try {
    await page.goto(listing.url, {
      waitUntil: "networkidle0",
      timeout: 120000,
    });

    await page.waitForFunction(
      (m: string) =>
        [...document.querySelectorAll("table")].some((t) =>
          (t.textContent ?? "").includes(m),
        ),
      { timeout: 60000 },
      marker,
    );

    const rawTexts = await page.evaluate((tableMarker: string) => {
      function findStoreTable(): HTMLTableElement | null {
        const tables = [...document.querySelectorAll("table")];
        return (
          (tables.find((t) => {
            const txt = t.textContent ?? "";
            return (
              txt.includes("Grad/Mesto") &&
              txt.includes("Adresa") &&
              txt.includes(tableMarker)
            );
          }) as HTMLTableElement | undefined) ?? null
        );
      }

      const table = findStoreTable();
      if (!table) {
        return [];
      }

      const out: string[] = [];
      for (const a of table.querySelectorAll("a")) {
        const text = a.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (/\S.+\s+IDEA(\s+(organic|super))?$/i.test(text)) {
          out.push(text);
        }
      }
      return out;
    }, marker);

    const normalized = rawTexts.map(normalizeIdeaStreetAddress).filter(Boolean);
    return [...new Set(normalized)];
  } finally {
    await browser.close();
  }
}

/** @deprecated Use {@link scrapeIdeaStoreAddresses} with the Beograd listing. */
export async function scrapeIdeaBeogradStoreAddresses(): Promise<string[]> {
  const loc = IDEA_STORE_LISTINGS.find((l) => l.city === "Beograd");
  if (!loc) {
    throw new Error("Beograd listing config missing.");
  }
  return scrapeIdeaStoreAddresses(loc);
}

export type IdeaStoreSyncResult = {
  city: string;
  deleted: number;
  inserted: number;
  geocoded: number;
  geocodeFailed: number;
  geocodeSkipped: boolean;
};

export async function syncIdeaStoresToDatabase(
  listing: IdeaStoreListing,
): Promise<IdeaStoreSyncResult> {
  const addresses = await scrapeIdeaStoreAddresses(listing);
  if (addresses.length === 0) {
    throw new Error(
      `No Idea “${listing.city}” addresses parsed — page structure may have changed.`,
    );
  }

  const geocodeSkipped = shouldSkipGeocode();
  const coordsList = await geocodeIdeaStoreAddresses(addresses, listing.city);
  let geocoded = 0;
  let geocodeFailed = 0;
  if (!geocodeSkipped) {
    for (const c of coordsList) {
      if (c.lat === PLACEHOLDER_LAT && c.lng === PLACEHOLDER_LNG) {
        geocodeFailed++;
      } else {
        geocoded++;
      }
    }
  }

  const del = await prisma.store.deleteMany({
    where: { name: STORE_NAME, city: listing.city },
  });

  await prisma.store.createMany({
    data: addresses.map((address, i) => ({
      name: STORE_NAME,
      city: listing.city,
      address,
      latitude: coordsList[i].lat,
      longitude: coordsList[i].lng,
    })),
  });

  return {
    city: listing.city,
    deleted: del.count,
    inserted: addresses.length,
    geocoded,
    geocodeFailed,
    geocodeSkipped,
  };
}

/** @deprecated Use {@link syncIdeaStoresToDatabase} with the Beograd listing. */
export async function syncIdeaBeogradStoresToDatabase(): Promise<{
  deleted: number;
  inserted: number;
  geocoded: number;
  geocodeFailed: number;
  geocodeSkipped: boolean;
}> {
  const loc = IDEA_STORE_LISTINGS.find((l) => l.city === "Beograd");
  if (!loc) {
    throw new Error("Beograd listing config missing.");
  }
  const r = await syncIdeaStoresToDatabase(loc);
  return {
    deleted: r.deleted,
    inserted: r.inserted,
    geocoded: r.geocoded,
    geocodeFailed: r.geocodeFailed,
    geocodeSkipped: r.geocodeSkipped,
  };
}

export async function syncAllIdeaStoreListings(
  listings: IdeaStoreListing[],
): Promise<IdeaStoreSyncResult[]> {
  const results: IdeaStoreSyncResult[] = [];
  for (const loc of listings) {
    results.push(await syncIdeaStoresToDatabase(loc));
  }
  return results;
}

function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("ideaStoresScraper")) {
    return;
  }

  (async () => {
    const toRun = listingsForCliArgs();
    if (toRun.length === 0) {
      console.error(
        "No listing matched CLI args. Try: Novi-Sad, Beograd, or omit args for all.",
      );
      process.exit(1);
      return;
    }

    if (shouldSkipDbSave()) {
      for (const loc of toRun) {
        const addresses = await scrapeIdeaStoreAddresses(loc);
        console.log(`\n=== ${loc.city} (${addresses.length}) — not saving ===\n`);
        console.log(addresses.join("\n"));
        if (!shouldSkipGeocode() && addresses.length > 0) {
          console.log("\nGeocoding first 3 (full run uses ~1.1s per store)…");
          const n = Math.min(3, addresses.length);
          for (let i = 0; i < n; i++) {
            const q = `${addresses[i]}, ${loc.city}, Serbia`;
            const c = await geocodeWithNominatim(q);
            console.log(`  ${q} → ${c ? `${c.lat}, ${c.lng}` : "miss"}`);
            if (i < n - 1) {
              await sleepMs(NOMINATIM_GAP_MS);
            }
          }
        }
      }
      process.exit(0);
      return;
    }

    try {
      for (const loc of toRun) {
        const r = await syncIdeaStoresToDatabase(loc);
        const geoPart = r.geocodeSkipped
          ? "geocoding skipped (0,0)"
          : `${r.geocoded} geocoded, ${r.geocodeFailed} fallback 0,0`;
        console.log(
          `Synced Idea ${r.city}: removed ${r.deleted} old row(s), inserted ${r.inserted} (${geoPart}).`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
    process.exit(0);
  })().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}

runIfExecutedDirectly();

export default {
  IDEA_STORE_LISTINGS,
  scrapeIdeaStoreAddresses,
  scrapeIdeaBeogradStoreAddresses,
  syncIdeaStoresToDatabase,
  syncIdeaBeogradStoresToDatabase,
  syncAllIdeaStoreListings,
  geocodeIdeaStoreAddresses,
  geocodeIdeaBeogradAddresses,
  normalizeIdeaStreetAddress,
};
