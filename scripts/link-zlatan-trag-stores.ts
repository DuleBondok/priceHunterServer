/**
 * Fill Store.storeCode for Zlatan Trag Niš objects (org on proveracena).
 *   npx tsx scripts/link-zlatan-trag-stores.ts
 */
import "dotenv/config";
import prisma from "../prismaClient";
import {
  matchZlatanTragOrg,
  ZLATAN_TRAG_NIS_LOCATIONS,
  ZLATAN_TRAG_STORE_NAME,
} from "../scrapers/zlatanTragLocations";

async function main() {
  const stores = await prisma.store.findMany({
    where: { name: { equals: ZLATAN_TRAG_STORE_NAME, mode: "insensitive" } },
    orderBy: { id: "asc" },
  });
  console.log(`[pre] Zlatan Trag Store rows: ${stores.length}`);

  let linked = 0;
  let skipped = 0;
  for (const store of stores) {
    const org = matchZlatanTragOrg(store.address);
    if (org == null) {
      skipped++;
      console.log(`  skip id=${store.id} ${store.city} ${store.address}`);
      continue;
    }
    const code = String(org);
    if (store.storeCode === code) {
      linked++;
      continue;
    }
    await prisma.store.update({
      where: { id: store.id },
      data: { storeCode: code },
    });
    linked++;
    console.log(
      `  linked id=${store.id} org=${code} ${store.address} (${store.city})`,
    );
  }

  const withCode = await prisma.store.findMany({
    where: { name: ZLATAN_TRAG_STORE_NAME, storeCode: { not: null } },
    select: { id: true, storeCode: true, address: true, city: true },
    orderBy: { storeCode: "asc" },
  });
  console.log(`[post] linked=${linked} unmatched=${skipped}`);
  console.log("mapped", withCode);
  const expected = ZLATAN_TRAG_NIS_LOCATIONS.map((l) => String(l.org));
  const have = new Set(withCode.map((s) => s.storeCode));
  const missing = expected.filter((c) => !have.has(c));
  if (missing.length) console.log("missing org codes in Store:", missing);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
