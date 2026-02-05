

function toNum(v: unknown): number | null {
  if (v == null) return null;

  const n = Number(
    String(v)
      .replace(",", ".")
      .replace(/[^\d.]/g, "")
  );

  return Number.isFinite(n) ? n : null;
}

export function calcDiscountPercent(price: unknown, before: unknown): number | null {
  const p = toNum(price);
  const b = toNum(before);

  if (p == null || b == null) return null;
  if (b <= 0 || b <= p) return null;

  return Math.round(((b - p) / b) * 100);
}

export function addDiscountFields<T extends { products: any[] }>(items: T[]): T[] {
  return items.map((sp) => ({
    ...sp,
    products: sp.products.map((p) => {
      const discountPercent = calcDiscountPercent(
        p.price,
        p.priceBeforeDiscount
      );

      return {
        ...p,
        discountPercent,
        hasDiscount: discountPercent != null,
      };
    }),
  }));
}