/** Idea listing id embedded in its image path, e.g. `images/products/535/535104721_1.jpg` → `535104721`. */
export function ideaProductIdFromImage(image: string | null | undefined): string | null {
  const match = String(image ?? "").match(/images\/products\/\d+\/(\d+)_/i);
  return match ? match[1] : null;
}
