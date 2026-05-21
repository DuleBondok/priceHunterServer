/**
 * Maxi GraphQL persisted query `GetStoreSearch` — paginated store list with {@link geoPoint}.
 * @see https://www.maxi.rs/storelocator
 */

export const GET_STORE_SEARCH_PERSISTED_HASH =
  "9dc67fed7b358c14d80bbd04c6524ef76f4298a142ed7ab86732442271f4ad46";

export type MaxiApiStoreAddress = {
  formattedAddress?: string;
  line1?: string;
  town?: string;
};

export type MaxiApiStore = {
  id?: string;
  urlName?: string;
  description?: string;
  groceryStoreType?: string;
  address?: MaxiApiStoreAddress;
  geoPoint?: { latitude?: number; longitude?: number };
};

export function buildGetStoreSearchUrl(
  searchQuery: string,
  currentPage: number,
): string {
  const variables = {
    pageSize: 30,
    lang: "sr",
    query: searchQuery,
    currentPage,
    options: "STORELOCATOR_MINIFIED",
  };
  return `https://www.maxi.rs/api/v1/?operationName=GetStoreSearch&variables=${encodeURIComponent(
    JSON.stringify(variables),
  )}&extensions=${encodeURIComponent(
    JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: GET_STORE_SEARCH_PERSISTED_HASH,
      },
    }),
  )}`;
}
