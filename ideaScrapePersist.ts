import { saveProducts, ProductData } from "./productService";
import { IDEA_COMPLETE_LISTINGS } from "./scrapers/ideaCompleteScraper";

const IDEA_CLEAR_CATEGORIES = [
  ...new Set(
    IDEA_COMPLETE_LISTINGS.map((e) => e.category).filter((c) => c.length > 0),
  ),
];

export function shouldSkipIdeaDbSave(): boolean {
  const v = process.env.SKIP_DB_SAVE?.toLowerCase();
  return v === "1" || v === "true" || process.argv.includes("--no-save");
}

/**
 * Persists Idea scrape results unless SKIP_DB_SAVE=1, SKIP_DB_SAVE=true, or --no-save.
 */
export async function saveIdeaScrapeResults(
  products: ProductData[],
): Promise<void> {
  if (shouldSkipIdeaDbSave()) {
    console.log(
      `Done. Scraped ${products.length} products (not saving — SKIP_DB_SAVE or --no-save).`,
    );
    return;
  }

  try {
    const {
      created,
      updated,
      newProductsUpdated,
      missingMarked,
      availabilityHidden,
      totalInDb,
    } = await saveProducts(products, {
      clearMissingForStore: true,
      clearMissingOnlyForCategories: IDEA_CLEAR_CATEGORIES,
    });
    console.log(
      `Done. Scraped ${products.length} rows → ${created} new (NewProducts), ${newProductsUpdated} NewProducts updated, ${updated} Product updates, ${missingMarked} missing this run, ${availabilityHidden} hidden (14d+), ${totalInDb} products in DB.`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Database save failed:\n", msg);
    console.error(
      "\nTip: Start your Neon database (dashboard → resume if paused), check DATABASE_URL in .env, or run with SKIP_DB_SAVE=1 or --no-save to scrape only.",
    );
    throw err;
  }
}
