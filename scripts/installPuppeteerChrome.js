/**
 * Download Puppeteer-managed Chrome into backend/.cache/puppeteer
 * Run once after npm install: npm run puppeteer:install
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cacheDir = path.join(__dirname, "..", ".cache", "puppeteer");
fs.mkdirSync(cacheDir, { recursive: true });

process.env.PUPPETEER_CACHE_DIR = cacheDir;

console.log(`Installing Chrome for Puppeteer into ${cacheDir} …`);
execSync("npx puppeteer browsers install chrome", {
  stdio: "inherit",
  env: process.env,
  cwd: path.join(__dirname, ".."),
});
console.log("Done.");
