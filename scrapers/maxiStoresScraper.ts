/**
 * Scrapes Maxi stores from [store locator](https://www.maxi.rs/storelocator) and syncs
 * `Store` rows (name **Maxi**, city, address, coordinates).
 *
 * When `apiSearchQuery` is set, all pages are loaded via the site’s GraphQL `GetStoreSearch`
 * API (same as the website: 30 per page, paginated). Coordinates come from the API
 * `geoPoint` (no Nominatim for those rows). The visible HTML list alone only shows the first page (~30).
 *
 * Shop&Go: use `storeType:MAXI` in the search query; API rows with `groceryStoreType !== MAXI`
 * or “Shop&Go” in the description are skipped.
 *
 * Run from `backend`:
 *   npx ts-node scrapers/maxiStoresScraper.ts              # Niš + Novi Sad + Beograd
 *   npx ts-node scrapers/maxiStoresScraper.ts novi-sad
 *   npx ts-node scrapers/maxiStoresScraper.ts beograd
 *   npx ts-node scrapers/maxiStoresScraper.ts nis
 *
 * Scrape only: SKIP_DB_SAVE=1 …
 * Skip geocoding: SKIP_GEOCODE=1 …
 */
import { launchBrowser } from "./puppeteerBrowser";
import prisma from "../prismaClient";
import {
  geocodeWithNominatim,
  sleepMs,
} from "../utils/nominatimGeocode";
import {
  type MaxiApiStore,
  GET_STORE_SEARCH_PERSISTED_HASH,
} from "./maxiStoreSearchApi";

const STORE_NAME = "Maxi";

const PLACEHOLDER_LAT = 0;
const PLACEHOLDER_LNG = 0;
const NOMINATIM_GAP_MS = 1100;

export type MaxiLocatorConfig = {
  /** Matched against CLI args (e.g. `novi-sad`, `nis`). */
  id: string;
  url: string;
  city: string;
  /**
   * When set, all matching stores are fetched via GraphQL `GetStoreSearch` (paginated).
   * Must match the `q` search string (e.g. `Beograd:relevance:storeType:MAXI`).
   */
  apiSearchQuery?: string;
  /**
   * When true, scraped `Street, City` becomes `Street` in the DB (suffix matches `city`);
   * geocoding still uses `Street, {city}, Serbia` when appropriate.
   */
  saveAddressWithoutCitySuffix: boolean;
};

export const MAXI_LOCATOR_CONFIGS: MaxiLocatorConfig[] = [
  {
    id: "nis",
    url: "https://www.maxi.rs/storelocator?q=Nis",
    city: "Niš",
    apiSearchQuery: "Nis:relevance:storeType:MAXI",
    saveAddressWithoutCitySuffix: false,
  },
  {
    id: "novi-sad",
    url: "https://www.maxi.rs/storelocator?q=Novi%20Sad:relevance:storeType:MAXI",
    city: "Novi Sad",
    apiSearchQuery: "Novi Sad:relevance:storeType:MAXI",
    saveAddressWithoutCitySuffix: true,
  },
  {
    id: "beograd",
    url: "https://www.maxi.rs/storelocator?q=Beograd:relevance:storeType:MAXI",
    city: "Beograd",
    apiSearchQuery: "Beograd:relevance:storeType:MAXI",
    saveAddressWithoutCitySuffix: true,
  },
];

export type MaxiStoreRow = {
  detailPath: string;
  /** Saved to DB (for Novi Sad: city suffix removed when it was `, Novi Sad`). */
  address: string;
  /** Original locator text; used to build a correct Nominatim query. */
  rawAddress: string;
  /** From GraphQL `geoPoint` when using {@link MaxiLocatorConfig.apiSearchQuery}. */
  sourceLatitude?: number;
  sourceLongitude?: number;
};

function shouldSkipDbSave(): boolean {
  const v = process.env.SKIP_DB_SAVE?.toLowerCase();
  return v === "1" || v === "true" || process.argv.includes("--no-save");
}

function shouldSkipGeocode(): boolean {
  const v = process.env.SKIP_GEOCODE?.toLowerCase();
  return v === "1" || v === "true";
}

/** Normalize spaces and remove a trailing `, {city}` segment (e.g. `… 18, Novi Sad`). */
export function stripTrailingCityFromAddress(
  address: string,
  city: string,
): string {
  let s = address.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const target = city.trim().replace(/\s+/g, " ").toLowerCase();
  if (!target) {
    return s;
  }
  let parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  while (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === target) {
    parts.pop();
  }
  return parts.join(", ").trim();
}

function configsForCliArgs(): MaxiLocatorConfig[] {
  const tokens = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (tokens.length === 0) {
    return [...MAXI_LOCATOR_CONFIGS];
  }
  const norm = tokens.map((t) => t.toLowerCase().replace(/\s+/g, ""));
  const picked = MAXI_LOCATOR_CONFIGS.filter((c) =>
    norm.some((tok) => c.id.replace(/-/g, "") === tok.replace(/-/g, "")),
  );
  return picked;
}

function rawEndsWithCity(raw: string, city: string): boolean {
  const target = city.trim().replace(/\s+/g, " ").toLowerCase();
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.length >= 1 && parts[parts.length - 1] === target;
}

function nominatimQuery(row: MaxiStoreRow, config: MaxiLocatorConfig): string {
  const raw = row.rawAddress.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (config.saveAddressWithoutCitySuffix) {
    const alreadyHasLocality = row.address.includes(",");
    if (alreadyHasLocality) {
      return `${row.address}, Serbia`;
    }
    if (rawEndsWithCity(raw, config.city)) {
      return `${row.address}, ${config.city}, Serbia`;
    }
    return `${row.address}, Serbia`;
  }
  if (/serbia\s*$/i.test(row.address)) {
    return row.address;
  }
  return `${row.address}, Serbia`;
}

function mapApiStoreToRow(
  s: MaxiApiStore,
  config: MaxiLocatorConfig,
): MaxiStoreRow | null {
  const gtype = String(s.groceryStoreType ?? "").toUpperCase();
  if (gtype && gtype !== "MAXI") {
    return null;
  }
  if (/shop\s*&\s*go|shop\s+go/i.test(s.description ?? "")) {
    return null;
  }

  const line1 = (s.address?.line1 ?? "").replace(/\s+/g, " ").trim();
  const formatted = (s.address?.formattedAddress ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const raw =
    formatted ||
    [line1, s.address?.town].filter(Boolean).join(", ").trim();
  if (!raw && !line1) {
    return null;
  }

  let address: string;
  if (config.saveAddressWithoutCitySuffix) {
    const base = line1 || raw;
    address = stripTrailingCityFromAddress(base, config.city);
  } else {
    address = formatted || raw || line1;
  }
  if (!address) {
    return null;
  }

  const slug = s.urlName ?? s.id ?? "";
  const detailPath = slug ? `/storedetails/${slug}` : "/storedetails/unknown";

  const lat = s.geoPoint?.latitude;
  const lng = s.geoPoint?.longitude;

  return {
    detailPath,
    address,
    rawAddress: (raw || line1).replace(/\s+/g, " ").trim(),
    sourceLatitude:
      typeof lat === "number" && Number.isFinite(lat) ? lat : undefined,
    sourceLongitude:
      typeof lng === "number" && Number.isFinite(lng) ? lng : undefined,
  };
}

async function fetchStoresViaGraphqlApi(
  page: import("puppeteer").Page,
  searchQuery: string,
): Promise<MaxiApiStore[]> {
  const persistedHash = GET_STORE_SEARCH_PERSISTED_HASH;
  const stores = await page.evaluate(
    (sq: string, ph: string) => {
      function buildUrl(currentPage: number): string {
        const variables = {
          pageSize: 30,
          lang: "sr",
          query: sq,
          currentPage,
          options: "STORELOCATOR_MINIFIED",
        };
        return (
          "https://www.maxi.rs/api/v1/?operationName=GetStoreSearch&variables=" +
          encodeURIComponent(JSON.stringify(variables)) +
          "&extensions=" +
          encodeURIComponent(
            JSON.stringify({
              persistedQuery: { version: 1, sha256Hash: ph },
            }),
          )
        );
      }

      return fetch(buildUrl(0), {
        credentials: "include",
        headers: { "x-apollo-operation-name": "GetStoreSearch" },
      })
        .then((r) => r.json())
        .then((first: {
          data?: {
            storeSearchJSON?: {
              pagination?: { totalPages?: number };
              stores?: unknown[];
            };
          };
        }) => {
          const ss = first.data?.storeSearchJSON;
          if (!ss?.stores) {
            return [];
          }
          const totalPages = ss.pagination?.totalPages ?? 1;
          const acc: unknown[] = [...ss.stores];
          function chain(p: number): Promise<unknown[]> {
            if (p >= totalPages) {
              return Promise.resolve(acc);
            }
            return fetch(buildUrl(p), {
              credentials: "include",
              headers: { "x-apollo-operation-name": "GetStoreSearch" },
            })
              .then((r) => r.json())
              .then((j: typeof first) => {
                const next = j.data?.storeSearchJSON?.stores ?? [];
                for (let i = 0; i < next.length; i++) {
                  acc.push(next[i]);
                }
                return chain(p + 1);
              });
          }
          return chain(1);
        })
        .then((acc) => acc as MaxiApiStore[]);
    },
    searchQuery,
    persistedHash,
  );
  return stores;
}

export async function scrapeMaxiStores(
  config: MaxiLocatorConfig,
): Promise<MaxiStoreRow[]> {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(config.url, {
      waitUntil: "networkidle0",
      timeout: 120000,
    });

    if (config.apiSearchQuery) {
      await sleepMs(500);
      const apiStores = await fetchStoresViaGraphqlApi(page, config.apiSearchQuery);
      const seen = new Set<string>();
      const out: MaxiStoreRow[] = [];
      for (const raw of apiStores) {
        const row = mapApiStoreToRow(raw, config);
        if (!row || seen.has(row.detailPath)) {
          continue;
        }
        seen.add(row.detailPath);
        out.push(row);
      }
      return out;
    }

    await page.waitForFunction(
      () => document.querySelectorAll('a[href^="/storedetails/"]').length > 0,
      { timeout: 60000 },
    );

    await sleepMs(1500);

    const raw = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="store-item"]');
      const rows: { href: string; address: string }[] = [];
      items.forEach((item) => {
        const title =
          item
            .querySelector('[data-testid="store-title"]')
            ?.textContent?.replace(/\s+/g, " ")
            .trim() ?? "";
        if (/shop\s*&\s*go|shop\s+go/i.test(title)) {
          return;
        }

        const link = item.querySelector<HTMLAnchorElement>(
          'a[href^="/storedetails/"]',
        );
        const addrEl = item.querySelector('[data-testid="store-address"]');
        const href = link?.getAttribute("href")?.trim() ?? "";
        let address =
          addrEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (href && address) {
          rows.push({ href, address });
        }
      });
      return rows;
    });

    const seen = new Set<string>();
    const out: MaxiStoreRow[] = [];
    for (const { href, address: rawAddr } of raw) {
      if (seen.has(href)) {
        continue;
      }
      seen.add(href);
      const address = config.saveAddressWithoutCitySuffix
        ? stripTrailingCityFromAddress(rawAddr, config.city)
        : rawAddr;
      if (!address) {
        continue;
      }
      out.push({
        detailPath: href,
        address,
        rawAddress: rawAddr.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(),
      });
    }

    return out;
  } finally {
    await browser.close();
  }
}

async function geocodeStores(
  stores: MaxiStoreRow[],
  config: MaxiLocatorConfig,
): Promise<{ lat: number; lng: number }[]> {
  if (shouldSkipGeocode()) {
    return stores.map(() => ({
      lat: PLACEHOLDER_LAT,
      lng: PLACEHOLDER_LNG,
    }));
  }

  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    const apiLat = s.sourceLatitude;
    const apiLng = s.sourceLongitude;
    if (
      apiLat != null &&
      apiLng != null &&
      Number.isFinite(apiLat) &&
      Number.isFinite(apiLng)
    ) {
      out.push({ lat: apiLat, lng: apiLng });
      continue;
    }

    const q = nominatimQuery(s, config);
    const coords = await geocodeWithNominatim(q);
    if (coords) {
      out.push(coords);
    } else {
      console.warn(`Geocode miss (${i + 1}/${stores.length}): ${q}`);
      out.push({ lat: PLACEHOLDER_LAT, lng: PLACEHOLDER_LNG });
    }
    if (i < stores.length - 1) {
      await sleepMs(NOMINATIM_GAP_MS);
    }
  }
  return out;
}

export async function syncMaxiStoresToDatabase(
  config: MaxiLocatorConfig,
): Promise<{
  city: string;
  deleted: number;
  inserted: number;
  geocoded: number;
  geocodeFailed: number;
  geocodeSkipped: boolean;
}> {
  const stores = await scrapeMaxiStores(config);
  if (stores.length === 0) {
    throw new Error(
      `No Maxi “${config.city}” stores parsed — store locator layout may have changed.`,
    );
  }

  const geocodeSkipped = shouldSkipGeocode();
  const coordsList = await geocodeStores(stores, config);
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
    where: { name: STORE_NAME, city: config.city },
  });

  await prisma.store.createMany({
    data: stores.map((s, i) => ({
      name: STORE_NAME,
      city: config.city,
      address: s.address,
      latitude: coordsList[i].lat,
      longitude: coordsList[i].lng,
    })),
  });

  return {
    city: config.city,
    deleted: del.count,
    inserted: stores.length,
    geocoded,
    geocodeFailed,
    geocodeSkipped,
  };
}

/** @deprecated Use {@link scrapeMaxiStores} with {@link MAXI_LOCATOR_CONFIGS}[0]. */
export async function scrapeMaxiNisStores(): Promise<MaxiStoreRow[]> {
  const c = MAXI_LOCATOR_CONFIGS.find((x) => x.id === "nis");
  if (!c) {
    throw new Error("Niš config missing.");
  }
  return scrapeMaxiStores(c);
}

/** @deprecated Use {@link syncMaxiStoresToDatabase} with Niš config. */
export async function syncMaxiNisStoresToDatabase(): Promise<{
  deleted: number;
  inserted: number;
  geocoded: number;
  geocodeFailed: number;
  geocodeSkipped: boolean;
}> {
  const c = MAXI_LOCATOR_CONFIGS.find((x) => x.id === "nis");
  if (!c) {
    throw new Error("Niš config missing.");
  }
  const r = await syncMaxiStoresToDatabase(c);
  return {
    deleted: r.deleted,
    inserted: r.inserted,
    geocoded: r.geocoded,
    geocodeFailed: r.geocodeFailed,
    geocodeSkipped: r.geocodeSkipped,
  };
}

function runIfExecutedDirectly(): void {
  const entryBase = (process.argv[1] ?? "").split(/[/\\]/).pop() ?? "";
  if (!entryBase.includes("maxiStoresScraper")) {
    return;
  }

  (async () => {
    const toRun = configsForCliArgs();
    if (toRun.length === 0) {
      console.error(
        "No config matched CLI args. Use: nis, novi-sad, beograd, or omit for all.",
      );
      process.exit(1);
      return;
    }

    if (shouldSkipDbSave()) {
      for (const cfg of toRun) {
        const stores = await scrapeMaxiStores(cfg);
        console.log(
          `\n=== Maxi ${cfg.city} (${stores.length}) — not saving ===\n`,
        );
        for (const s of stores) {
          console.log(`${s.detailPath} → ${s.address}`);
        }
        if (!shouldSkipGeocode() && stores.length > 0) {
          console.log("\nSample coords (first 2)…");
          const n = Math.min(2, stores.length);
          for (let i = 0; i < n; i++) {
            const s = stores[i];
            if (
              s.sourceLatitude != null &&
              s.sourceLongitude != null
            ) {
              console.log(
                `  ${s.address} → API ${s.sourceLatitude}, ${s.sourceLongitude}`,
              );
            } else {
              const q = nominatimQuery(s, cfg);
              const c = await geocodeWithNominatim(q);
              console.log(`  ${q} → ${c ? `${c.lat}, ${c.lng}` : "miss"}`);
              if (i < n - 1) {
                await sleepMs(NOMINATIM_GAP_MS);
              }
            }
          }
        }
      }
      process.exit(0);
      return;
    }

    try {
      for (const cfg of toRun) {
        const r = await syncMaxiStoresToDatabase(cfg);
        const geoPart = r.geocodeSkipped
          ? "geocoding skipped (0,0)"
          : `${r.geocoded} geocoded, ${r.geocodeFailed} fallback 0,0`;
        console.log(
          `Synced Maxi ${r.city}: removed ${r.deleted} old row(s), inserted ${r.inserted} (${geoPart}).`,
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
  MAXI_LOCATOR_CONFIGS,
  scrapeMaxiStores,
  scrapeMaxiNisStores,
  syncMaxiStoresToDatabase,
  syncMaxiNisStoresToDatabase,
  stripTrailingCityFromAddress,
};
