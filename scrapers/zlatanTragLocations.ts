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
  /** Match Store.address (case-insensitive). */
  addressPattern: RegExp;
};

/** Official Niš objects we have (or should have) in Store. */
export const ZLATAN_TRAG_NIS_LOCATIONS: ZlatanTragLocation[] = [
  {
    org: 6,
    label: "B6 SUPER MARKET NOVO SELO",
    addressPattern: /novo\s*selo|9\.?\s*maj|pasja[cč]kih\s*partizana/i,
  },
  {
    org: 28,
    label: "B28 SUPER MARKET BRZI BROD",
    addressPattern: /brzi\s*brod/i,
  },
  {
    org: 47,
    label: "B47 SUPER MARKET SOMBORSKA",
    addressPattern: /somborsk/i,
  },
  {
    org: 49,
    label: "D49 MINI MARKET KRUZNI",
    addressPattern: /kralja\s*aleksandra|trg/i,
  },
  {
    org: 53,
    label: "E53 MINI MARKET COKOT",
    addressPattern: /[cč]okot/i,
  },
  {
    org: 55,
    label: "A55 SUPERMARKET VAGRES",
    addressPattern: /zetska/i,
  },
  {
    org: 56,
    label: "B\+56 SUPERMARKET SAVA",
    addressPattern: /zorana|đini|djindj|dindic/i,
  },
];

/** Default scrape set: all mapped Niš objects. */
export const ZLATAN_TRAG_ORGS = ZLATAN_TRAG_NIS_LOCATIONS.map((l) => l.org);

export function matchZlatanTragOrg(address: string): number | null {
  const hit = ZLATAN_TRAG_NIS_LOCATIONS.find((l) => l.addressPattern.test(address));
  return hit?.org ?? null;
}
