import axios from "axios";

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";

/** Nominatim requires a valid User-Agent identifying your app. */
const DEFAULT_USER_AGENT = "priceHunterBackend/1.0 (Idea store sync)";

export type GeocodeResult = { lat: number; lng: number };

/**
 * Forward-geocode a free-text address via [Nominatim](https://nominatim.org/).
 * Respect their usage policy: at most ~1 request/second for bulk use.
 */
export async function geocodeWithNominatim(
  query: string,
): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const userAgent =
    process.env.NOMINATIM_USER_AGENT?.trim() || DEFAULT_USER_AGENT;

  const { data, status } = await axios.get<unknown>(NOMINATIM_SEARCH, {
    params: {
      q: trimmed,
      format: "json",
      limit: 1,
    },
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
    timeout: 25000,
    validateStatus: () => true,
  });

  if (status !== 200 || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const row = data[0] as { lat?: string; lon?: string };
  const lat = parseFloat(row.lat ?? "");
  const lng = parseFloat(row.lon ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
