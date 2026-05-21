/**
 * Run from the backend folder (use a real path, not @backend/...):
 *   npx ts-node runIdeaCompleteScrape.ts
 *   npx ts-node scrapers/ideaCompleteScraper.ts
 *
 * Scrape only (no DB): SKIP_DB_SAVE=1 npx ts-node runIdeaCompleteScrape.ts
 *   or: npx ts-node runIdeaCompleteScrape.ts --no-save
 */
import { scrapeIdeaProducts } from "./scrapers/ideaCompleteScraper";
import { saveIdeaScrapeResults } from "./ideaScrapePersist";

console.log("Idea scraper starting… (first page load can take 30–60s)\n");

scrapeIdeaProducts()
  .then(async (data) => {
    await saveIdeaScrapeResults(data);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
