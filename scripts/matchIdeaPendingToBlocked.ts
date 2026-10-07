/**
 * Idea renamed listings, so BlockedProduct rows (keyed by old normalizedName) no longer
 * catch them. Find pending Idea NewProducts that look like a blocked Idea listing.
 *
 * Usage (from backend):
 *   npx ts-node --transpile-only scripts/matchIdeaPendingToBlocked.ts            (dry-run)
 *   npx ts-node --transpile-only scripts/matchIdeaPendingToBlocked.ts --apply --min=0.8
 *
 * --apply blocks the new name (keeps the old BlockedProduct row) and deletes the NewProducts row.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../prismaClient";

const apply = process.argv.includes("--apply");
const minArg = process.argv.find((a) => a.startsWith("--min="));
const MIN_SCORE = minArg ? Number(minArg.slice(6)) : 0.6;
const excludeArg = process.argv.find((a) => a.startsWith("--exclude="));
const EXCLUDE_IDS = new Set((excludeArg?.slice(10) ?? "").split(",").filter(Boolean).map(Number));
const REPORT_PATH = resolve(__dirname, "matchIdeaPendingToBlocked.report.json");

const UNIT_RE = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|kom|x)\b/g;

function tokens(name: string): Set<string> {
  const s = name
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(UNIT_RE, "$1$2");
  return new Set(s.split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t.length > 1 || /\d/.test(t)));
}

/** Sizes, shade numbers, pack counts — must agree exactly. */
function numericTokens(t: Set<string>): string[] {
  return [...t].filter((x) => /\d/.test(x)).sort();
}

function dice(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size || 1);
}

async function main() {
  const pending = await prisma.newProducts.findMany({
    where: { store: "Idea", processedAt: null },
    select: { id: true, name: true, normalizedName: true, category: true },
  });
  const blocked = await prisma.blockedProduct.findMany({
    where: { store: "Idea" },
    select: { id: true, name: true, normalizedName: true, category: true, reason: true },
  });
  const blockedTokens = blocked.map((b) => ({ b, t: tokens(b.name), nums: numericTokens(tokens(b.name)).join() }));

  const matches: {
    newProductId: number;
    newName: string;
    normalizedName: string;
    category: string | null;
    blockedId: number;
    blockedName: string;
    reason: string | null;
    score: number;
  }[] = [];

  for (const row of pending) {
    if (EXCLUDE_IDS.has(row.id)) continue;
    const t = tokens(row.name);
    const nums = numericTokens(t).join();
    let best: { b: (typeof blocked)[number]; score: number } | null = null;
    for (const cand of blockedTokens) {
      if (nums !== cand.nums) continue;
      const score = dice(t, cand.t);
      if (!best || score > best.score) best = { b: cand.b, score };
    }
    if (best && best.score >= MIN_SCORE) {
      matches.push({
        newProductId: row.id,
        newName: row.name,
        normalizedName: row.normalizedName,
        category: row.category,
        blockedId: best.b.id,
        blockedName: best.b.name,
        reason: best.b.reason,
        score: Math.round(best.score * 100) / 100,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  const usedBlocked = new Set<number>();
  for (let i = 0; i < matches.length; i++) {
    if (usedBlocked.has(matches[i].blockedId)) matches.splice(i--, 1);
    else usedBlocked.add(matches[i].blockedId);
  }

  const buckets = { ">=0.9": 0, "0.8-0.9": 0, "0.7-0.8": 0, "0.6-0.7": 0 };
  for (const m of matches) {
    if (m.score >= 0.9) buckets[">=0.9"]++;
    else if (m.score >= 0.8) buckets["0.8-0.9"]++;
    else if (m.score >= 0.7) buckets["0.7-0.8"]++;
    else buckets["0.6-0.7"]++;
  }
  console.log(`Pending Idea NewProducts: ${pending.length}, Idea BlockedProduct rows: ${blocked.length}`);
  console.log(`Matches >= ${MIN_SCORE}: ${matches.length}`, buckets);
  writeFileSync(REPORT_PATH, JSON.stringify(matches, null, 2));
  console.log(`Report: ${REPORT_PATH}`);

  if (!apply) return;

  const created = await prisma.blockedProduct.createMany({
    data: matches.map((m) => ({
      normalizedName: m.normalizedName,
      store: "Idea",
      name: m.newName,
      category: m.category,
      reason: `Idea rename of blocked #${m.blockedId}${m.reason ? `: ${m.reason}` : ""}`,
    })),
    skipDuplicates: true,
  });
  const removed = await prisma.newProducts.deleteMany({
    where: { id: { in: matches.map((m) => m.newProductId) } },
  });
  console.log(`Blocked new names: ${created.count}, NewProducts deleted: ${removed.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
