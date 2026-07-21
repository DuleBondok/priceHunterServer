export function parseElakolijePrice(
  cena: string | null | undefined,
  cenaCeo: number | null | undefined,
): number | null {
  const whole = Number(cenaCeo);
  const raw = String(cena ?? "")
    .replace(/[^\d.,]/g, "")
    .trim();

  if (!raw) {
    return Number.isFinite(whole) && whole > 0 ? whole : null;
  }

  // API format: cena_ceo = integer dinars, cena display = "36.322" or "36,32"
  if (Number.isFinite(whole) && whole > 0) {
    const fracMatch = raw.match(/[.,](\d+)$/);
    if (fracMatch) {
      const fracDigits = fracMatch[1];
      return whole + Number(fracDigits) / Math.pow(10, fracDigits.length);
    }
    if (/^\d+$/.test(raw)) {
      const asInt = Number(raw);
      // Avoid concatenated "36322" when display lost the decimal separator.
      if (asInt >= whole * 100) return whole;
      return asInt;
    }
  }

  // Comma decimal without cena_ceo (e.g. "36,32")
  const commaDecimal = raw.match(/^(\d+),(\d{1,3})$/);
  if (commaDecimal) {
    return Number(`${commaDecimal[1]}.${commaDecimal[2]}`);
  }

  // Integer fallback
  if (/^\d+$/.test(raw)) {
    const asInt = Number(raw);
    return asInt > 0 ? asInt : null;
  }

  return null;
}

/** Parse standalone display price (e.g. stara_cena) without cena_ceo. */
export function parseElakolijeDisplayPrice(
  raw: string | null | undefined,
): number | null {
  const cleaned = String(raw ?? "")
    .replace(/[^\d.,]/g, "")
    .trim();
  if (!cleaned) return null;

  const decimal = cleaned.match(/^(\d+)[.,](\d+)$/);
  if (decimal) {
    return Number(`${decimal[1]}.${decimal[2]}`);
  }

  if (/^\d+$/.test(cleaned)) {
    const asInt = Number(cleaned);
    return asInt > 0 ? asInt : null;
  }

  return null;
}

export function formatPriceRsd(value: number): string {
  return `${value.toFixed(2)} RSD`;
}
