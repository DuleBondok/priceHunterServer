/**
 * Daily catalog-home shelves (Najveća ušteda, Najveći popusti, Popularno među kupcima).
 * Runs automatically after the 05:00 scrape (and after a manual complete-scrape run)
 * and writes one row to Neon so the Pricely API can serve it without the full catalog.
 *
 * Optionally mirrors the snapshot into the mobile app asset tree so the next
 * Metro/OTA/APK build ships yesterday's shelves offline — no manual
 * `npm run home:shelves` in the app repo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import prisma from "./prismaClient";

const HOME_POPULAR_AMONG_CUSTOMERS_IDS = [
  "48",
  "1551",
  "8957",
  "8674",
  "4344",
  "2364",
  "4174",
] as const;
const HOME_SHELF_SEE_ALL_LIMIT = 80;
const SNAPSHOT_ID = "catalog";
const TEKIJANKA_TEST_STORE = "Tekijanka";
const TEKIJANKA_OFFER_ID_OFFSET = 2_000_000_000;

export type HomeShelfOfferRow = {
  id: number;
  store: string;
  price: string | null;
  priceBeforeDiscount: unknown;
  image: string;
};

export type HomeShelfProductRow = {
  id: number;
  name: string;
  image: string | null;
  mainCategory: string | null;
  midCategory: string | null;
  subCategory: string | null;
  brand: string | null;
  volume: string | null;
  attributes: unknown;
  products: HomeShelfOfferRow[];
};

export type HomeShelvesSnapshot = {
  computedAt: string;
  popularAmongCustomers: HomeShelfProductRow[];
  biggestSavings: HomeShelfProductRow[];
  topDiscountsToday: HomeShelfProductRow[];
};

type SlimOffer = {
  spId: number;
  store: string;
  price: number;
  before: number;
};

type Agg = {
  storeBest: Map<string, number>;
  maxDiscountPct: number;
  maxAbsSavings: number;
};

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePrice(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const cleaned = String(raw)
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function storeKey(name: string): string {
  return name.trim().toLowerCase();
}

function emptyAgg(): Agg {
  return { storeBest: new Map(), maxDiscountPct: 0, maxAbsSavings: 0 };
}

function addOffer(agg: Agg, offer: SlimOffer): void {
  const key = storeKey(offer.store);
  if (!key || offer.price <= 0) return;
  const prev = agg.storeBest.get(key);
  if (prev == null || offer.price < prev) agg.storeBest.set(key, offer.price);
  if (offer.before > offer.price && offer.before > 0) {
    const pct = ((offer.before - offer.price) / offer.before) * 100;
    if (pct > agg.maxDiscountPct) agg.maxDiscountPct = pct;
    const abs = offer.before - offer.price;
    if (abs > agg.maxAbsSavings) agg.maxAbsSavings = abs;
  }
}

function parsePopularIds(): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const raw of HOME_POPULAR_AMONG_CUSTOMERS_IDS) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function loadRegisteredStoreNames(db: PrismaClient): Promise<string[]> {
  const rows = await db.store.findMany({ select: { name: true } });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function loadTekijankaSlimOffers(db: PrismaClient): Promise<SlimOffer[]> {
  try {
    const tekijanka = await db.$queryRaw<
      Array<{
        standardizedProductId: number;
        store: string | null;
        price: string | null;
        priceBeforeDiscount: unknown;
      }>
    >`
      SELECT "standardizedProductId", store, price, "priceBeforeDiscount"
      FROM "TekijankaProduct"
      WHERE "standardizedProductId" IS NOT NULL
        AND "isAvailable" = true
        AND "flaggedForReview" = false
        AND "orgJed" = 50
    `;
    const out: SlimOffer[] = [];
    for (const row of tekijanka) {
      const spId = Number(row.standardizedProductId);
      if (!Number.isInteger(spId) || spId <= 0) continue;
      out.push({
        spId,
        store: (row.store || TEKIJANKA_TEST_STORE).trim() || TEKIJANKA_TEST_STORE,
        price: parsePrice(row.price),
        before: parsePrice(row.priceBeforeDiscount),
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[HOME_SHELVES] Tekijanka offers skipped:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function loadSlimOffers(
  db: PrismaClient,
  registeredNames: string[],
): Promise<SlimOffer[]> {
  if (registeredNames.length === 0) return [];
  const rows = await db.product.findMany({
    where: {
      isAvailable: true,
      flaggedForReview: false,
      standardizedProductId: { not: null },
      OR: registeredNames.map((name) => ({
        store: { equals: name, mode: "insensitive" as const },
      })),
    },
    select: {
      standardizedProductId: true,
      store: true,
      price: true,
      priceBeforeDiscount: true,
    },
  });
  const out: SlimOffer[] = [];
  for (const row of rows) {
    const spId = Number(row.standardizedProductId);
    if (!Number.isInteger(spId) || spId <= 0) continue;
    out.push({
      spId,
      store: row.store,
      price: parsePrice(row.price),
      before: parsePrice(row.priceBeforeDiscount),
    });
  }
  out.push(...(await loadTekijankaSlimOffers(db)));
  return out;
}

function rankShelfIds(
  offers: SlimOffer[],
  limit: number,
): { biggestSavings: number[]; topDiscountsToday: number[] } {
  const byId = new Map<number, Agg>();
  for (const offer of offers) {
    const agg = byId.get(offer.spId) ?? emptyAgg();
    addOffer(agg, offer);
    byId.set(offer.spId, agg);
  }

  const savings = [...byId.entries()]
    .map(([id, agg]) => {
      if (agg.storeBest.size < 2) return null;
      const prices = [...agg.storeBest.values()];
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const spread = max - min;
      if (!(spread > 0)) return null;
      return { id, spread, stores: agg.storeBest.size };
    })
    .filter((row): row is { id: number; spread: number; stores: number } => row != null)
    .sort((a, b) => b.spread - a.spread || b.stores - a.stores || a.id - b.id)
    .slice(0, limit)
    .map((row) => row.id);

  const discounts = [...byId.entries()]
    .map(([id, agg]) => ({
      id,
      pct: agg.maxDiscountPct,
      abs: agg.maxAbsSavings,
    }))
    .filter((row) => row.pct > 0)
    .sort((a, b) => b.pct - a.pct || b.abs - a.abs || a.id - b.id)
    .slice(0, limit)
    .map((row) => row.id);

  return { biggestSavings: savings, topDiscountsToday: discounts };
}

function mergeTekijankaOffers(
  row: HomeShelfProductRow,
  extraBySpId: Map<number, HomeShelfOfferRow[]>,
): HomeShelfProductRow {
  const extra = extraBySpId.get(row.id) ?? [];
  if (extra.length === 0) return row;
  const merged = [...(row.products ?? [])];
  for (const offer of extra) {
    const already = merged.some(
      (existing) => existing.store.trim().toLowerCase() === offer.store.toLowerCase(),
    );
    if (already) continue;
    merged.push(offer);
  }
  merged.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  return { ...row, products: merged };
}

async function hydrateProducts(
  db: PrismaClient,
  ids: number[],
  registeredNames: string[],
): Promise<Map<number, HomeShelfProductRow>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();

  const offerWhere: Prisma.ProductWhereInput = {
    AND: [
      { standardizedProductId: { not: null } },
      { flaggedForReview: false },
      { isAvailable: true },
      registeredNames.length === 0
        ? { id: { in: [] } }
        : {
            OR: registeredNames.map((name) => ({
              store: { equals: name, mode: "insensitive" as const },
            })),
          },
    ],
  };

  const rows = await db.standardizedProduct.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      name: true,
      image: true,
      mainCategory: true,
      midCategory: true,
      subCategory: true,
      brand: true,
      volume: true,
      attributes: true,
      products: {
        where: offerWhere,
        orderBy: { price: "asc" },
        select: {
          id: true,
          store: true,
          price: true,
          priceBeforeDiscount: true,
          image: true,
        },
      },
    },
  });

  const extraBySpId = new Map<number, HomeShelfOfferRow[]>();
  try {
    const tekijanka = await db.$queryRaw<
      Array<{
        id: number;
        standardizedProductId: number;
        store: string | null;
        price: string | null;
        priceBeforeDiscount: unknown;
        image: string | null;
      }>
    >(Prisma.sql`
      SELECT
        id,
        "standardizedProductId",
        store,
        price,
        "priceBeforeDiscount",
        image
      FROM "TekijankaProduct"
      WHERE "standardizedProductId" IN (${Prisma.join(unique)})
        AND "isAvailable" = true
        AND "flaggedForReview" = false
        AND "orgJed" = 50
      ORDER BY price ASC NULLS LAST
    `);
    for (const row of tekijanka) {
      const spId = Number(row.standardizedProductId);
      if (!Number.isFinite(spId)) continue;
      const list = extraBySpId.get(spId) ?? [];
      list.push({
        id: TEKIJANKA_OFFER_ID_OFFSET + Number(row.id),
        store: (row.store || TEKIJANKA_TEST_STORE).trim() || TEKIJANKA_TEST_STORE,
        price: row.price,
        priceBeforeDiscount: row.priceBeforeDiscount,
        image: row.image ?? "",
      });
      extraBySpId.set(spId, list);
    }
  } catch (err) {
    console.warn(
      "[HOME_SHELVES] Tekijanka hydrate skipped:",
      err instanceof Error ? err.message : err,
    );
  }

  const byId = new Map<number, HomeShelfProductRow>();
  for (const row of rows) {
    const mapped: HomeShelfProductRow = {
      id: row.id,
      name: row.name,
      image: row.image,
      mainCategory: row.mainCategory,
      midCategory: row.midCategory,
      subCategory: row.subCategory,
      brand: row.brand,
      volume: row.volume,
      attributes: row.attributes,
      products: row.products.map((offer) => ({
        id: offer.id,
        store: offer.store,
        price: offer.price,
        priceBeforeDiscount: offer.priceBeforeDiscount,
        image: offer.image,
      })),
    };
    const merged = mergeTekijankaOffers(mapped, extraBySpId);
    if (merged.products.length === 0) continue;
    byId.set(merged.id, jsonSafe(merged));
  }
  return byId;
}

function pickOrdered(
  ids: number[],
  byId: Map<number, HomeShelfProductRow>,
): HomeShelfProductRow[] {
  const out: HomeShelfProductRow[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

async function ensureSnapshotTable(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HomeShelfSnapshot" (
      id TEXT PRIMARY KEY,
      "computedAt" TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function saveSnapshotToDb(db: PrismaClient, snap: HomeShelvesSnapshot): Promise<void> {
  await ensureSnapshotTable(db);
  await db.$executeRawUnsafe(
    `INSERT INTO "HomeShelfSnapshot" (id, "computedAt", payload, "updatedAt")
     VALUES ($1, $2::timestamptz, $3::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "computedAt" = EXCLUDED."computedAt",
       payload = EXCLUDED.payload,
       "updatedAt" = NOW()`,
    SNAPSHOT_ID,
    snap.computedAt,
    JSON.stringify(snap),
  );
}

function asSnapshot(value: unknown): HomeShelvesSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<HomeShelvesSnapshot>;
  if (typeof parsed.computedAt !== "string") return null;
  if (!Array.isArray(parsed.popularAmongCustomers)) return null;
  if (!Array.isArray(parsed.biggestSavings)) return null;
  if (!Array.isArray(parsed.topDiscountsToday)) return null;
  return parsed as HomeShelvesSnapshot;
}

/** Read the latest Neon snapshot (no recompute). */
export async function readHomeShelvesFromDb(
  db: PrismaClient = prisma,
): Promise<HomeShelvesSnapshot | null> {
  try {
    await ensureSnapshotTable(db);
    const rows = await db.$queryRawUnsafe<Array<{ payload: unknown }>>(
      `SELECT payload FROM "HomeShelfSnapshot" WHERE id = $1`,
      SNAPSHOT_ID,
    );
    const raw = rows[0]?.payload;
    if (typeof raw === "string") {
      try {
        return asSnapshot(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    return asSnapshot(raw);
  } catch (err) {
    console.warn(
      "[HOME_SHELVES] Neon read skipped:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Serve shelves for GET /api/home-shelves.
 * Prefer Neon (written after 05:00 scrape). If missing, compute once and keep it.
 */
export async function getHomeShelvesForServe(
  db: PrismaClient = prisma,
): Promise<HomeShelvesSnapshot> {
  const fromDb = await readHomeShelvesFromDb(db);
  if (fromDb) return fromDb;
  return computeAndSaveHomeShelves(db);
}

export async function computeHomeShelvesSnapshot(
  db: PrismaClient = prisma,
): Promise<HomeShelvesSnapshot> {
  const started = Date.now();
  const registeredNames = await loadRegisteredStoreNames(db);
  const offers = await loadSlimOffers(db, registeredNames);
  const ranked = rankShelfIds(offers, HOME_SHELF_SEE_ALL_LIMIT);
  const popularIds = parsePopularIds();
  const hydrateIds = [...popularIds, ...ranked.biggestSavings, ...ranked.topDiscountsToday];
  const byId = await hydrateProducts(db, hydrateIds, registeredNames);
  const snap: HomeShelvesSnapshot = {
    computedAt: new Date().toISOString(),
    popularAmongCustomers: pickOrdered(popularIds, byId),
    biggestSavings: pickOrdered(ranked.biggestSavings, byId),
    topDiscountsToday: pickOrdered(ranked.topDiscountsToday, byId),
  };
  console.log(
    `[HOME_SHELVES] computed in ${Date.now() - started}ms ` +
      `(offers=${offers.length}, popular=${snap.popularAmongCustomers.length}, ` +
      `savings=${snap.biggestSavings.length}, discounts=${snap.topDiscountsToday.length})`,
  );
  return snap;
}

/**
 * Where to mirror the snapshot for the Expo app bundle.
 * Set `PRICELY_HOME_SHELVES_ASSET_PATH` to an absolute file path, or leave unset
 * to use the sibling Desktop layout:
 *   ../PricelyUpdate/Pricely-Update-1/assets/data/home-shelves.json
 * Also writes `server/cache/home-shelves.json` next to that asset when possible.
 */
function resolveAppShelfPaths(): { asset: string; cache: string | null } | null {
  const fromEnv = (process.env.PRICELY_HOME_SHELVES_ASSET_PATH || "").trim();
  if (fromEnv) {
    const asset = path.resolve(fromEnv);
    const appRoot = path.resolve(path.dirname(asset), "..", "..");
    return {
      asset,
      cache: path.join(appRoot, "server", "cache", "home-shelves.json"),
    };
  }
  // priceHunterBackend/backend → Desktop → PricelyUpdate/Pricely-Update-1
  const defaultAsset = path.resolve(
    __dirname,
    "..",
    "..",
    "PricelyUpdate",
    "Pricely-Update-1",
    "assets",
    "data",
    "home-shelves.json",
  );
  const appRoot = path.resolve(defaultAsset, "..", "..", "..");
  return {
    asset: defaultAsset,
    cache: path.join(appRoot, "server", "cache", "home-shelves.json"),
  };
}

async function mirrorSnapshotToAppFiles(snap: HomeShelvesSnapshot): Promise<void> {
  const paths = resolveAppShelfPaths();
  if (!paths) return;
  const body = JSON.stringify(snap);
  try {
    await mkdir(path.dirname(paths.asset), { recursive: true });
    await writeFile(paths.asset, body, "utf8");
    console.log(`[HOME_SHELVES] mirrored app asset ${paths.asset}`);
  } catch (err) {
    console.warn(
      "[HOME_SHELVES] app asset mirror skipped:",
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (!paths.cache) return;
  try {
    await mkdir(path.dirname(paths.cache), { recursive: true });
    await writeFile(paths.cache, body, "utf8");
    console.log(`[HOME_SHELVES] mirrored API cache ${paths.cache}`);
  } catch (err) {
    console.warn(
      "[HOME_SHELVES] API cache mirror skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function computeAndSaveHomeShelves(
  db: PrismaClient = prisma,
): Promise<HomeShelvesSnapshot> {
  const snap = await computeHomeShelvesSnapshot(db);
  await saveSnapshotToDb(db, snap);
  console.log(`[HOME_SHELVES] wrote Neon HomeShelfSnapshot computedAt=${snap.computedAt}`);
  await mirrorSnapshotToAppFiles(snap);
  return snap;
}

/** After daily/manual complete scrape — never fail the scrape run if this throws. */
export async function refreshHomeShelvesAfterScrape(): Promise<void> {
  try {
    await computeAndSaveHomeShelves();
  } catch (err) {
    console.error(
      "[HOME_SHELVES] Refresh after scrape failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
