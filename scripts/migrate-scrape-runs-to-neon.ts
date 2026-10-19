/**
 * One-shot: copy local data/scrape-runs.json into Neon ScrapeRunRecord.
 *   npx tsx scripts/migrate-scrape-runs-to-neon.ts
 */
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import prisma from "../prismaClient";

type ScrapeRun = {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};

async function main() {
  const filePath = path.join(__dirname, "..", "data", "scrape-runs.json");
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as { runs?: ScrapeRun[] };
  const runs = (parsed.runs ?? []).slice(0, 60);
  console.log(`Local runs: ${runs.length}`);

  let upserted = 0;
  for (const run of runs) {
    await prisma.scrapeRunRecord.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        startedAt: new Date(run.startedAt),
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        durationMs: run.durationMs ?? null,
        payload: run as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: run.status,
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        durationMs: run.durationMs ?? null,
        payload: run as unknown as Prisma.InputJsonValue,
      },
    });
    upserted++;
  }

  const total = await prisma.scrapeRunRecord.count();
  console.log(`Upserted ${upserted}; Neon total=${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
