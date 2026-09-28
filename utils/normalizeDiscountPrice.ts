import { formatPriceRsd } from "../scrapers/univerexportPriceUtils";

/** Parse display prices like `1984.75 RSD`, `1.299`, `1299`. */
export function parseDisplayPrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  const s = String(raw)
    .replace(/din\/kom/gi, "")
    .replace(/din/gi, "")
    .replace(/rsd/gi, "")
    .trim();
  if (!s) return null;

  const m = s.match(/[\d.,]+/);
  if (!m) return null;

  const token = m[0];
  const hasComma = token.includes(",");
  const hasDot = token.includes(".");

  if (hasComma && hasDot) {
    const lastComma = token.lastIndexOf(",");
    const lastDot = token.lastIndexOf(".");
    const cleaned =
      lastDot > lastComma
        ? token.replace(/,/g, "")
        : token.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  if (hasComma && !hasDot) {
    const n = Number(token.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  if (hasDot) {
    const parts = token.split(".");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      // `1.299` thousands without cents
      const n = Number(parts[0] + parts[1]);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  const n = Number(token.replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ensure `priceBeforeDiscount` is strictly greater than `price`.
 *
 * Idea MPC (loyalty) cards often expose `.cijena` = regular (higher) and
 * `.stara-cijena` = club price (lower). Any inverted pair is swapped so:
 * - price = sale / loyalty (lower)
 * - priceBeforeDiscount = regular / strikethrough (higher)
 *
 * Equal values drop `priceBeforeDiscount` (no real discount).
 */
export function normalizeDiscountPair(args: {
  price: string | null | undefined;
  priceBeforeDiscount: number | null | undefined;
  requiresLoyaltyCard?: boolean;
}): { price: string | null; priceBeforeDiscount: number | null } {
  const price =
    args.price == null || String(args.price).trim() === ""
      ? null
      : String(args.price).trim();
  const sale = parseDisplayPrice(price);
  const beforeRaw = args.priceBeforeDiscount;
  const before =
    beforeRaw == null || !Number.isFinite(Number(beforeRaw))
      ? null
      : Number(beforeRaw);

  if (sale == null) {
    return { price, priceBeforeDiscount: before };
  }
  if (before == null) {
    return { price, priceBeforeDiscount: null };
  }
  if (before > sale) {
    return { price, priceBeforeDiscount: before };
  }
  if (before < sale) {
    return {
      price: formatPriceRsd(before),
      priceBeforeDiscount: sale,
    };
  }
  return { price, priceBeforeDiscount: null };
}
