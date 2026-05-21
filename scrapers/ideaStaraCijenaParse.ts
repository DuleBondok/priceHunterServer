/**
 * Parses Idea `.stara-cijena` text. Mixed formats:
 * - `1.944,99` — EU: dot = thousands, comma = decimals → 1944.99
 * - `1,944.99` — US-style: comma = thousands, dot = decimals → 1944.99
 * - `549,99` / `549.99` — only one kind of separator
 * - `1.067` — thousands without cents (three digits after single dot)
 */
export function parseIdeaStaraCijenaRsd(
  raw: string | null | undefined,
): number | null {
  if (raw == null || raw === "") {
    return null;
  }

  const stripped = raw
    .replace(/din\/kom/gi, "")
    .replace(/din/gi, "")
    .trim();

  const m = stripped.match(/[\d.,]+/);
  if (!m) {
    return null;
  }

  const s = m[0];

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastDot > lastComma) {
      // Dot is the decimal separator (e.g. 1,944.99)
      const cleaned = s.replace(/,/g, "");
      const n = Number(cleaned);
      return isNaN(n) ? null : n;
    }
    // Comma is the decimal separator (e.g. 1.944,99)
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }

  if (hasComma && !hasDot) {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
  }

  if (!hasDot) {
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  const parts = s.split(".");
  if (parts.length === 2) {
    const frac = parts[1];
    if (frac.length <= 2) {
      const n = Number(s);
      return isNaN(n) ? null : n;
    }
    if (frac.length === 3) {
      const n = Number(parts[0] + frac);
      return isNaN(n) ? null : n;
    }
  }
  if (parts.length > 2) {
    const n = Number(parts.join(""));
    return isNaN(n) ? null : n;
  }

  const n = Number(s);
  return isNaN(n) ? null : n;
}
