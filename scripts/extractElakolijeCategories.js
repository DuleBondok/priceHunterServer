const fs = require("fs");
const path = require("path");
const https = require("https");

const SIFKLA_IN_URL = "(?:[a-z]\\d+|\\d+)";
const POLICA_PATH = `(https:\\/\\/elakolije\\.rs\\/${SIFKLA_IN_URL}\\/polica[^']*)`;

const LINK_PATTERNS = [
  new RegExp(`pocetna_meni_stop'[^>]*href='${POLICA_PATH}'[^>]*>([^<]+)`, "gi"),
  new RegExp(`href='${POLICA_PATH}'[^>]*pocetna_meni_stop[^>]*>([^<]+)`, "gi"),
  new RegExp(
    `pocetna_meni_stop' href='${POLICA_PATH}'>([^<]+)`,
    "gi",
  ),
  new RegExp(
    `href='${POLICA_PATH}' class='pocetna_meni_kliktav_ceo pocetna_meni_stop'>([^<]+)`,
    "gi",
  ),
  new RegExp(
    `class='pocetna_meni_kliktav_ceo pocetna_meni_stop' href='${POLICA_PATH}'>([^<]+)`,
    "gi",
  ),
];

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function normalizeLabel(raw) {
  return String(raw || "")
    .replace(/\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sifklaFromUrl(url) {
  const match = String(url).match(/elakolije\.rs\/((?:[a-z]\d+|\d+))\/polica/i);
  return match ? match[1] : null;
}

function extractCategories(html) {
  const all = new Map();
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(html))) {
      const url = match[1];
      const label = normalizeLabel(match[2]);
      if (!label || label === ">") continue;
      const sifkla = sifklaFromUrl(url);
      if (!sifkla) continue;
      const key = sifkla.toLowerCase();
      if (!all.has(key)) {
        all.set(key, { sifkla, url, label });
      }
    }
  }
  return [...all.values()].sort((a, b) =>
    a.sifkla.localeCompare(b.sifkla, undefined, { numeric: true }),
  );
}

function loadExistingCategoryMap(tsPath) {
  const map = new Map();
  if (!fs.existsSync(tsPath)) return map;
  const content = fs.readFileSync(tsPath, "utf8");
  const re =
    /sifkla:\s*"([^"]+)"[\s\S]*?label:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(content))) {
    map.set(match[1].toLowerCase(), {
      label: match[2],
      category: match[3],
    });
  }
  return map;
}

function defaultCategoryForSifkla(sifkla, label) {
  const key = String(sifkla).toLowerCase();
  if (key.startsWith("a")) return "Personal Care";
  if (key.startsWith("b")) return "Home Care";
  if (key.startsWith("c")) return "Home Care";
  return label;
}

function resolveCategory(entry, existingMap) {
  const existing = existingMap.get(entry.sifkla.toLowerCase());
  if (existing) return existing.category;
  return defaultCategoryForSifkla(entry.sifkla, entry.label);
}

(async () => {
  const html = await get("https://elakolije.rs/");
  const list = extractCategories(html);
  const jsonPath = path.join(__dirname, "elakolije-categories.json");
  const tsPath = path.join(__dirname, "..", "scrapers", "univerexportCategories.ts");
  const existingMap = loadExistingCategoryMap(tsPath);

  fs.writeFileSync(jsonPath, JSON.stringify(list, null, 2), "utf8");

  const header = `/**
 * Elakolije / Univerexport leaf categories.
 * Edit \`category\` per row to match Pricely labels (Groceries, Drinks, Alcohol, …).
 * Regenerate (keeps your category mappings by sifkla): node scripts/extractElakolijeCategories.js
 */
export type UniverexportCategoryEntry = {
  sifkla: string;
  label: string;
  category: string;
};

export const UNIVEREXPORT_COMPLETE_CATEGORIES: UniverexportCategoryEntry[] = [
`;

  const rows = list
    .map((entry) => {
      const label = normalizeLabel(entry.label);
      const category = resolveCategory({ ...entry, label }, existingMap);
      return `  { sifkla: ${JSON.stringify(entry.sifkla)}, label: ${JSON.stringify(label)}, category: ${JSON.stringify(category)} },`;
    })
    .join("\n");

  fs.writeFileSync(tsPath, `${header}${rows}\n];\n`, "utf8");

  const added = list.filter((e) => !existingMap.has(e.sifkla.toLowerCase())).length;
  console.error("count:", list.length);
  console.error("new since last file:", added);
  console.error(
    "personal care (a*):",
    list.filter((e) => /^a/i.test(e.sifkla)).length,
  );
  console.error(
    "home care (b*):",
    list.filter((e) => /^b/i.test(e.sifkla)).length,
  );
  console.error("wrote:", tsPath);
})();
