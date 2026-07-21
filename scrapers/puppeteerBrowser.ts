import "./puppeteerEnv";
import puppeteer, { Browser, LaunchOptions } from "puppeteer";
import { ensurePuppeteerCacheDir, PUPPETEER_CACHE_DIR, scraperProcessEnv } from "./puppeteerEnv";

export { PUPPETEER_CACHE_DIR, scraperProcessEnv, ensurePuppeteerCacheDir };

export async function launchBrowser(
  options: LaunchOptions = {},
): Promise<Browser> {
  ensurePuppeteerCacheDir();
  const { args: extraArgs, ...rest } = options;
  return puppeteer.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", ...(extraArgs ?? [])],
    ...rest,
  });
}
