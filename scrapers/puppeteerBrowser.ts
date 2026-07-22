import "./puppeteerEnv";
import puppeteer, { Browser, LaunchOptions } from "puppeteer";
import {
  ensurePuppeteerCacheDir,
  PUPPETEER_CACHE_DIR,
  scraperProcessEnv,
} from "./puppeteerEnv";

export { PUPPETEER_CACHE_DIR, scraperProcessEnv, ensurePuppeteerCacheDir };

/** Lean Chromium flags for Docker / Render (limited RAM). */
const DOCKER_CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--mute-audio",
  "--no-first-run",
  "--no-zygote",
  // Lower renderer memory; avoid loading huge tabs in parallel elsewhere.
  "--js-flags=--max-old-space-size=256",
];

export async function launchBrowser(
  options: LaunchOptions = {},
): Promise<Browser> {
  ensurePuppeteerCacheDir();
  const { args: extraArgs, ...rest } = options;
  return puppeteer.launch({
    headless: true,
    args: [...DOCKER_CHROME_ARGS, ...(extraArgs ?? [])],
    ...rest,
  });
}
