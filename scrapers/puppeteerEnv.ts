import fs from "fs";
import path from "path";

const BACKEND_ROOT = path.resolve(__dirname, "..");

/** Stable cache dir under the backend project (not Cursor sandbox temp). */
export const PUPPETEER_CACHE_DIR = path.join(BACKEND_ROOT, ".cache", "puppeteer");

function shouldOverrideCacheDir(): boolean {
  const current = process.env.PUPPETEER_CACHE_DIR?.trim();
  if (!current) return true;
  return (
    current.includes("cursor-sandbox") ||
    current.includes("Temp\\cursor-sandbox-cache")
  );
}

/** Pin Puppeteer browser cache before puppeteer module loads. */
export function ensurePuppeteerCacheDir(): string {
  if (shouldOverrideCacheDir()) {
    process.env.PUPPETEER_CACHE_DIR = PUPPETEER_CACHE_DIR;
  }
  fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR!, { recursive: true });
  return process.env.PUPPETEER_CACHE_DIR!;
}

/** Env for scraper child processes spawned by the orchestrator. */
export function scraperProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.PUPPETEER_CACHE_DIR = PUPPETEER_CACHE_DIR;
  // Keep child Node heaps smaller so parent API + Chrome fit on Render.
  if (!env.NODE_OPTIONS?.includes("max-old-space-size")) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, "--max-old-space-size=512"]
      .filter(Boolean)
      .join(" ");
  }
  return env;
}

ensurePuppeteerCacheDir();
