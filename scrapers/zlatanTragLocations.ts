/**
 * Zlatan Trag physical objects (`org` on proveracena.zlatantrag.rs)
 * mapped to Store rows (name = "Zlatan Trag").
 *
 * Join path:
 *   Store.name + Store.storeCode
 *     → StoreLocationPrice.store + StoreLocationPrice.storeCode
 *     → Product.store + Product.normalizedName
 */
export const ZLATAN_TRAG_STORE_NAME = "Zlatan Trag";

export type ZlatanTragLocation = {
  org: number;
  label: string;
  /** Official listing exists, but proveracena has no `org` option. */
  scrape?: boolean;
  /** Match Store.address (case-insensitive). Skip if two objects share a street. */
  addressPattern?: RegExp;
};

export const ZLATAN_TRAG_LOCATIONS: ZlatanTragLocation[] = [
  { org: 1, label: "A+1 HIPERMARKET ZLATAN TRAG", addressPattern: /tekstilna/i },
  { org: 2, label: "A2 SUPER MARKET DUBOCICA", addressPattern: /kuna|dubo[cč]ica/i },
  { org: 6, label: "B6 SUPER MARKET NOVO SELO", addressPattern: /novo\s*selo|9\.?\s*maj|pasja[cč]kih\s*partizana/i },
  { org: 8, label: "A8 SUPER MARKET VIDIK", addressPattern: /stanoja\s*glava[sš]a|vidik/i },
  { org: 10, label: "D10 SUPER MARKET RADNI^KO" },
  { org: 15, label: "C15 SUPER MARKET D.ZDRAVLJA", addressPattern: /svilara|rade svilara/i },
  { org: 28, label: "B28 SUPER MARKET BRZI BROD", addressPattern: /brzi\s*brod/i },
  { org: 29, label: "D29 MINI MARKET RADNICKO 2", addressPattern: /radni[cč]ka\s*5/i },
  { org: 30, label: "Norvežanska 34 (nema na proveracena)", scrape: false, addressPattern: /norve[zž]anska/i },
  { org: 31, label: "B+31 SUPER MARKET HEBA", addressPattern: /ni[sš]ka\s*bb/i },
  { org: 32, label: "C32 MINI MARKET CC32", addressPattern: /[zž]ikice/i },
  { org: 33, label: "C33 MINI MARKET 33 BAMBI" },
  { org: 35, label: "C35 MINI MARKET PODRUM 2", addressPattern: /poga[cč]arevi/i },
  { org: 39, label: "C39 MINI MARKET C.MARKO", addressPattern: /pana\s*[đdj]uki/i },
  { org: 40, label: "B40 MINI MARKET BATA DJ", addressPattern: /[zž]uni/i },
  { org: 41, label: "C41 SUPER MARKET NISIC", addressPattern: /svetoilijska/i },
  { org: 43, label: "D43 MINI MARKET P.GROS", addressPattern: /milutinovi/i },
  { org: 47, label: "B47 SUPER MARKET SOMBORSKA", addressPattern: /somborsk/i },
  { org: 49, label: "D49 MINI MARKET KRUZNI", addressPattern: /kralja\s*aleksandra/i },
  { org: 51, label: "B51 SUPER MARKET VLAJKOVA 2", addressPattern: /vlajkova/i },
  { org: 53, label: "E53 MINI MARKET COKOT", addressPattern: /[cč]okot/i },
  { org: 55, label: "A55 SUPERMARKET VAGRES", addressPattern: /zetska/i },
  { org: 56, label: "B+56 SUPERMARKET SAVA", addressPattern: /zorana|đini|djindj|dindic/i },
];

/** Default scrape set: mapped objects that proveracena actually lists. */
export const ZLATAN_TRAG_ORGS = ZLATAN_TRAG_LOCATIONS.filter((l) => l.scrape !== false).map(
  (l) => l.org,
);

export const ZLATAN_TRAG_NIS_LOCATIONS = ZLATAN_TRAG_LOCATIONS.filter((l) =>
  [6, 28, 47, 49, 53, 55, 56].includes(l.org),
);

export function matchZlatanTragOrg(address: string): number | null {
  const hit = ZLATAN_TRAG_LOCATIONS.find((l) => l.addressPattern?.test(address));
  return hit?.org ?? null;
}
