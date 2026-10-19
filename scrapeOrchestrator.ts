import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import cron from "node-cron";
import { Prisma } from "@prisma/client";
import prisma from "./prismaClient";
import { scraperProcessEnv } from "./scrapers/puppeteerEnv";
import { refreshHomeShelvesAfterScrape } from "./homeShelves";

type StepStatus = "success" | "failed";
type RunStatus = "running" | "success" | "partial" | "failed";

export type ScrapeStore =
  | "Idea"
  | "Maxi"
  | "DIS"
  | "Univerexport"
  | "AS"
  | "Zlatan Trag";

export type ScrapeRunStep = {
  store: ScrapeStore;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: StepStatus;
  exitCode: number;
  command: string;
  logs: string[];
  finalInfo?: {
    scraped?: number;
    created?: number;
    updated?: number;
    priceCleared?: number;
    totalInDb?: number;
  };
  errorMessage?: string;
};

export type ScrapeRun = {
  id: string;
  trigger: "manual" | "scheduled";
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  steps: ScrapeRunStep[];
  summary: {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
  };
};

export type ScrapeProblem = {
  runId: string;
  trigger: "manual" | "scheduled";
  store: ScrapeStore;
  status: StepStatus | RunStatus;
  finishedAt?: string;
  errorMessage: string;
};

/** Backend package root — avoids empty history when `app.ts` is started from a different cwd. */
const BACKEND_ROOT = __dirname;
/** Legacy local file — migrated once into Neon, then kept as optional backup. */
const RUNS_FILE_PATH = path.join(BACKEND_ROOT, "data", "scrape-runs.json");
const MAX_LOG_LINES_PER_STEP = 250;
const MAX_RUNS_TO_KEEP = 60;

let isRunInProgress = false;
let scheduledInitialized = false;
let fileMigratedToDb = false;
let activeRunLiveState: {
  runId: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  currentStore?: ScrapeStore;
  currentCommand?: string;
  currentStepStartedAt?: string;
  currentStepLogs: string[];
  completedSteps: ScrapeRunStep[];
  plannedStores: ScrapeStore[];
} | null = null;

const SCRAPER_STEPS: Array<{
  store: ScrapeStore;
  command: string;
  args: string[];
}> = [
  {
    store: "Idea",
    command: "npx",
    args: ["ts-node", "runIdeaCompleteScrape.ts"],
  },
  {
    store: "Maxi",
    command: "npx",
    args: ["ts-node", "scrapers/maxiCompleteScraper.ts"],
  },
  {
    store: "DIS",
    command: "npx",
    args: ["ts-node", "scrapers/disCompleteScraper.ts"],
  },
  {
    store: "Univerexport",
    command: "npx",
    args: ["ts-node", "scrapers/univerexportCompleteScraper.ts"],
  },
  {
    store: "AS",
    command: "npx",
    args: ["ts-node", "scrapers/asCompleteScraper.ts"],
  },
  {
    store: "Zlatan Trag",
    command: "npx",
    args: ["ts-node", "scrapers/zlatanTragCompleteScraper.ts"],
  },
];

const STORE_ALIASES: Record<string, ScrapeStore> = {
  idea: "Idea",
  maxi: "Maxi",
  dis: "DIS",
  univerexport: "Univerexport",
  as: "AS",
  "zlatan trag": "Zlatan Trag",
  zlatantrag: "Zlatan Trag",
  zlatan: "Zlatan Trag",
};

export function listCompleteScraperStores(): Array<{
  store: ScrapeStore;
  command: string;
}> {
  return SCRAPER_STEPS.map((s) => ({
    store: s.store,
    command: [s.command, ...s.args].join(" "),
  }));
}

export function resolveScrapeStores(
  input?: string | string[] | null,
): ScrapeStore[] {
  if (input == null) return SCRAPER_STEPS.map((s) => s.store);
  const raw = Array.isArray(input) ? input : [input];
  const resolved: ScrapeStore[] = [];
  for (const item of raw) {
    const key = String(item || "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const store =
      STORE_ALIASES[key] ||
      (SCRAPER_STEPS.find((s) => s.store.toLowerCase() === key)?.store);
    if (!store) {
      throw new Error(
        `Unknown store "${item}". Allowed: ${SCRAPER_STEPS.map((s) => s.store).join(", ")}`,
      );
    }
    if (!resolved.includes(store)) resolved.push(store);
  }
  if (resolved.length === 0) {
    throw new Error("Provide at least one store");
  }
  return resolved;
}

function trimLogs(logs: string[]): string[] {
  if (logs.length <= MAX_LOG_LINES_PER_STEP) return logs;
  return logs.slice(logs.length - MAX_LOG_LINES_PER_STEP);
}

function extractErrorFromLogs(logs: string[]): string | undefined {
  const errorish = logs.filter((line) =>
    /\b(error|failed|exception|fatal|econnreset|timeout|oom)\b/i.test(line),
  );
  if (errorish.length === 0) return undefined;
  const last = errorish[errorish.length - 1];
  return last.length > 400 ? `${last.slice(0, 397)}...` : last;
}

function runScraperStep(
  store: ScrapeStore,
  command: string,
  args: string[],
  onLog?: (line: string) => void,
): Promise<ScrapeRunStep> {
  return new Promise((resolve) => {
    const startedAtDate = new Date();
    const logs: string[] = [];

    const child = spawn(command, args, {
      cwd: BACKEND_ROOT,
      shell: process.platform === "win32",
      env: scraperProcessEnv(),
    });

    const addLog = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      text.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trimEnd();
        if (!trimmed) return;
        logs.push(trimmed);
        onLog?.(trimmed);
      });
      if (logs.length > MAX_LOG_LINES_PER_STEP) {
        logs.splice(0, logs.length - MAX_LOG_LINES_PER_STEP);
      }
    };

    child.stdout.on("data", addLog);
    child.stderr.on("data", addLog);

    child.on("error", (err) => {
      const finishedAtDate = new Date();
      logs.push(`spawn error: ${err.message}`);
      resolve({
        store,
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        status: "failed",
        exitCode: -1,
        command: [command, ...args].join(" "),
        logs: trimLogs(logs),
        errorMessage: err.message,
      });
    });

    child.on("close", (exitCodeRaw) => {
      const finishedAtDate = new Date();
      const exitCode = exitCodeRaw ?? -1;
      const finalInfo = extractFinalInfoFromLogs(logs);
      const logError = extractErrorFromLogs(logs);
      const step: ScrapeRunStep = {
        store,
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        status: exitCode === 0 ? "success" : "failed",
        exitCode,
        command: [command, ...args].join(" "),
        logs: trimLogs(logs),
        finalInfo,
        errorMessage:
          exitCode === 0
            ? undefined
            : logError || `Step failed with exit code ${exitCode}`,
      };

      resolve(step);
    });
  });
}

function extractFinalInfoFromLogs(
  logs: string[],
):
  | {
      scraped?: number;
      created?: number;
      updated?: number;
      priceCleared?: number;
      totalInDb?: number;
    }
  | undefined {
  const joined = logs.join("\n");

  const createdUpdatedClearedTotal = joined.match(
    /Created:\s*(\d+),\s*Updated:\s*(\d+),\s*Price cleared:\s*(\d+),\s*Total:\s*(\d+)/i,
  );

  const createdUpdatedMissingHidden = joined.match(
    /Created:\s*(\d+),\s*Updated:\s*(\d+),\s*Missing marked:\s*(\d+),\s*Hidden \(14d\+\):\s*(\d+),\s*Total:\s*(\d+)/i,
  );

  const productNewProductsMissingHidden = joined.match(
    /Product updated:\s*(\d+),\s*NewProducts created:\s*(\d+),\s*NewProducts updated:\s*(\d+),\s*Missing marked:\s*(\d+),\s*Hidden \(14d\+\):\s*(\d+),\s*Products in DB:\s*(\d+)/i,
  );

  const createdUpdatedTotal = joined.match(
    /Created:\s*(\d+),\s*Updated:\s*(\d+),\s*Total:\s*(\d+)/i,
  );

  const ideaPersistNewProducts = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new \(NewProducts\),\s*(\d+)\s*NewProducts updated,\s*(\d+)\s*Product updates/i,
  );

  const ideaPersistAvail = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new,\s*(\d+)\s*price updates,\s*(\d+)\s*missing this run,\s*(\d+)\s*hidden \(14d\+\),\s*(\d+)\s*products in DB/i,
  );

  const ideaPersistNew = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new,\s*(\d+)\s*price updates,\s*(\d+)\s*price cleared,\s*(\d+)\s*products in DB/i,
  );

  const ideaPersist = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new,\s*(\d+)\s*price updates,\s*(\d+)\s*products in DB/i,
  );

  const disCollected = joined.match(/\[DIS\]\s*Total collected:\s*(\d+)/i);
  const maxiCollected = joined.match(/Total products collected:\s*(\d+)/i);
  const univerexportCollected = joined.match(
    /\[Univerexport\]\s*Total collected:\s*(\d+)/i,
  );
  const asCollected = joined.match(/\[AS\]\s*Total collected:\s*(\d+)/i);
  const zlatanTragCollected = joined.match(
    /\[Zlatan Trag\]\s*Total collected:\s*(\d+)/i,
  );

  const info: {
    scraped?: number;
    created?: number;
    updated?: number;
    priceCleared?: number;
    totalInDb?: number;
  } = {};

  if (productNewProductsMissingHidden) {
    info.updated = Number(productNewProductsMissingHidden[1]);
    info.created = Number(productNewProductsMissingHidden[2]);
    info.priceCleared = Number(productNewProductsMissingHidden[4]);
    info.totalInDb = Number(productNewProductsMissingHidden[6]);
  } else if (createdUpdatedMissingHidden) {
    info.created = Number(createdUpdatedMissingHidden[1]);
    info.updated = Number(createdUpdatedMissingHidden[2]);
    info.priceCleared = Number(createdUpdatedMissingHidden[3]);
    info.totalInDb = Number(createdUpdatedMissingHidden[5]);
  } else if (createdUpdatedClearedTotal) {
    info.created = Number(createdUpdatedClearedTotal[1]);
    info.updated = Number(createdUpdatedClearedTotal[2]);
    info.priceCleared = Number(createdUpdatedClearedTotal[3]);
    info.totalInDb = Number(createdUpdatedClearedTotal[4]);
  } else if (createdUpdatedTotal) {
    info.created = Number(createdUpdatedTotal[1]);
    info.updated = Number(createdUpdatedTotal[2]);
    info.totalInDb = Number(createdUpdatedTotal[3]);
  }

  if (ideaPersistNewProducts) {
    info.scraped = Number(ideaPersistNewProducts[1]);
    info.created = Number(ideaPersistNewProducts[2]);
    info.updated = Number(ideaPersistNewProducts[4]);
  } else if (ideaPersistAvail) {
    info.scraped = Number(ideaPersistAvail[1]);
    info.created = Number(ideaPersistAvail[2]);
    info.updated = Number(ideaPersistAvail[3]);
    info.priceCleared = Number(ideaPersistAvail[4]);
    info.totalInDb = Number(ideaPersistAvail[6]);
  } else if (ideaPersistNew) {
    info.scraped = Number(ideaPersistNew[1]);
    info.created = Number(ideaPersistNew[2]);
    info.updated = Number(ideaPersistNew[3]);
    info.priceCleared = Number(ideaPersistNew[4]);
    info.totalInDb = Number(ideaPersistNew[5]);
  } else if (ideaPersist) {
    info.scraped = Number(ideaPersist[1]);
    info.created = Number(ideaPersist[2]);
    info.updated = Number(ideaPersist[3]);
    info.totalInDb = Number(ideaPersist[4]);
  }

  if (info.scraped == null && disCollected) {
    info.scraped = Number(disCollected[1]);
  }

  if (info.scraped == null && maxiCollected) {
    info.scraped = Number(maxiCollected[1]);
  }

  if (info.scraped == null && univerexportCollected) {
    info.scraped = Number(univerexportCollected[1]);
  }

  if (info.scraped == null && asCollected) {
    info.scraped = Number(asCollected[1]);
  }

  if (info.scraped == null && zlatanTragCollected) {
    info.scraped = Number(zlatanTragCollected[1]);
  }

  if (
    info.scraped == null &&
    info.created == null &&
    info.updated == null &&
    info.totalInDb == null
  ) {
    return undefined;
  }

  return info;
}

function finalizeRun(run: ScrapeRun): ScrapeRun {
  const finished = new Date();
  const successfulSteps = run.steps.filter((s) => s.status === "success").length;
  const failedSteps = run.steps.length - successfulSteps;

  let status: RunStatus = "success";
  if (run.steps.length === 0 || failedSteps === run.steps.length) status = "failed";
  else if (failedSteps > 0) status = "partial";

  return {
    ...run,
    status,
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - new Date(run.startedAt).getTime(),
    summary: {
      totalSteps: run.steps.length,
      successfulSteps,
      failedSteps,
    },
  };
}

async function readRunsFromFile(): Promise<ScrapeRun[]> {
  try {
    const raw = await fs.readFile(RUNS_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { runs?: ScrapeRun[] };
    return parsed.runs ?? [];
  } catch {
    return [];
  }
}

async function writeRunsFileBackup(runs: ScrapeRun[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(RUNS_FILE_PATH), { recursive: true });
    await fs.writeFile(
      RUNS_FILE_PATH,
      JSON.stringify({ runs: runs.slice(0, MAX_RUNS_TO_KEEP) }, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.warn("[SCRAPE] Failed to write local scrape-runs.json backup:", err);
  }
}

async function migrateFileRunsToDbIfNeeded(): Promise<void> {
  if (fileMigratedToDb) return;
  fileMigratedToDb = true;

  try {
    const dbCount = await prisma.scrapeRunRecord.count();
    if (dbCount > 0) return;

    const fileRuns = await readRunsFromFile();
    if (fileRuns.length === 0) return;

    console.log(
      `[SCRAPE] Migrating ${fileRuns.length} local scrape runs into Neon…`,
    );
    for (const run of fileRuns.slice(0, MAX_RUNS_TO_KEEP)) {
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
    }
    console.log("[SCRAPE] Local → Neon migration done.");
  } catch (err) {
    console.warn("[SCRAPE] Could not migrate local scrape runs to Neon:", err);
  }
}

async function persistRun(run: ScrapeRun): Promise<void> {
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

  const existing = await readRuns();
  const next = [run, ...existing.filter((r) => r.id !== run.id)].slice(
    0,
    MAX_RUNS_TO_KEEP,
  );
  await writeRunsFileBackup(next);

  const overflow = await prisma.scrapeRunRecord.findMany({
    orderBy: { startedAt: "desc" },
    skip: MAX_RUNS_TO_KEEP,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await prisma.scrapeRunRecord.deleteMany({
      where: { id: { in: overflow.map((r) => r.id) } },
    });
  }
}

async function readRuns(): Promise<ScrapeRun[]> {
  await migrateFileRunsToDbIfNeeded();
  const rows = await prisma.scrapeRunRecord.findMany({
    orderBy: { startedAt: "desc" },
    take: MAX_RUNS_TO_KEEP,
  });
  return rows.map((row) => row.payload as unknown as ScrapeRun);
}

function collectProblemsFromRuns(runs: ScrapeRun[], limit = 20): ScrapeProblem[] {
  const problems: ScrapeProblem[] = [];
  for (const run of runs) {
    if (run.status === "success") continue;
    for (const step of run.steps) {
      if (step.status !== "failed") continue;
      problems.push({
        runId: run.id,
        trigger: run.trigger,
        store: step.store,
        status: step.status,
        finishedAt: step.finishedAt || run.finishedAt,
        errorMessage:
          step.errorMessage ||
          extractErrorFromLogs(step.logs || []) ||
          `Exit code ${step.exitCode}`,
      });
      if (problems.length >= limit) return problems;
    }
  }
  return problems;
}

export async function runAllCompleteScrapers(
  trigger: "manual" | "scheduled",
  stores?: ScrapeStore[],
): Promise<{ ok: boolean; reason?: string; run?: ScrapeRun }> {
  if (isRunInProgress) {
    return { ok: false, reason: "A scraping run is already in progress." };
  }

  const selectedStores = stores?.length
    ? stores
    : SCRAPER_STEPS.map((s) => s.store);
  const stepsToRun = SCRAPER_STEPS.filter((s) =>
    selectedStores.includes(s.store),
  );
  if (stepsToRun.length === 0) {
    return { ok: false, reason: "No matching scrapers for requested stores." };
  }

  isRunInProgress = true;
  const runId = `${Date.now()}`;
  activeRunLiveState = {
    runId,
    trigger,
    startedAt: new Date().toISOString(),
    currentStepLogs: [],
    completedSteps: [],
    plannedStores: stepsToRun.map((s) => s.store),
  };

  const run: ScrapeRun = {
    id: runId,
    trigger,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: [],
    summary: { totalSteps: 0, successfulSteps: 0, failedSteps: 0 },
  };

  try {
    for (const step of stepsToRun) {
      if (activeRunLiveState) {
        activeRunLiveState.currentStore = step.store;
        activeRunLiveState.currentCommand = [step.command, ...step.args].join(
          " ",
        );
        activeRunLiveState.currentStepStartedAt = new Date().toISOString();
        activeRunLiveState.currentStepLogs = [];
      }

      console.log(
        `[SCRAPE] Starting ${step.store} (${trigger}) — ${[step.command, ...step.args].join(" ")}`,
      );

      const result = await runScraperStep(
        step.store,
        step.command,
        step.args,
        (line) => {
          if (!activeRunLiveState) return;
          activeRunLiveState.currentStepLogs.push(line);
          if (activeRunLiveState.currentStepLogs.length > MAX_LOG_LINES_PER_STEP) {
            activeRunLiveState.currentStepLogs.splice(
              0,
              activeRunLiveState.currentStepLogs.length - MAX_LOG_LINES_PER_STEP,
            );
          }
        },
      );
      run.steps.push(result);
      if (activeRunLiveState) {
        activeRunLiveState.completedSteps.push(result);
      }

      if (result.status === "failed") {
        console.error(
          `[SCRAPE] ${step.store} FAILED (exit ${result.exitCode}): ${result.errorMessage || "unknown"}`,
        );
      } else {
        console.log(
          `[SCRAPE] ${step.store} OK in ${(result.durationMs / 1000).toFixed(1)}s`,
        );
      }
    }

    const doneRun = finalizeRun(run);
    await persistRun(doneRun);

    if (doneRun.summary.failedSteps > 0) {
      console.error(
        `[SCRAPE] Run ${doneRun.id} finished with problems: ${doneRun.summary.failedSteps}/${doneRun.summary.totalSteps} failed`,
      );
    }

    return { ok: true, run: doneRun };
  } catch (error) {
    const failedRun = finalizeRun({
      ...run,
      steps: [
        ...run.steps,
        {
          store: stepsToRun[0]?.store ?? "Idea",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          status: "failed",
          exitCode: -1,
          command: "internal",
          logs: [],
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      ],
    });
    try {
      await persistRun(failedRun);
    } catch (persistErr) {
      console.error("[SCRAPE] Failed to persist failed run:", persistErr);
    }
    return { ok: false, reason: "Unhandled run failure", run: failedRun };
  } finally {
    await refreshHomeShelvesAfterScrape();
    isRunInProgress = false;
    activeRunLiveState = null;
  }
}

export async function getScrapeRuns(): Promise<ScrapeRun[]> {
  return readRuns();
}

export async function getScrapeStatus(): Promise<{
  isRunning: boolean;
  scheduled: string;
  stores: Array<{ store: ScrapeStore; command: string }>;
  recentProblems: ScrapeProblem[];
  activeRun: null | {
    runId: string;
    trigger: "manual" | "scheduled";
    startedAt: string;
    currentStore?: ScrapeStore;
    currentCommand?: string;
    currentStepStartedAt?: string;
    currentStepLogs: string[];
    completedSteps: ScrapeRunStep[];
    plannedStores: ScrapeStore[];
  };
}> {
  let recentProblems: ScrapeProblem[] = [];
  try {
    const runs = await readRuns();
    recentProblems = collectProblemsFromRuns(runs.slice(0, 10));
  } catch (err) {
    console.warn("[SCRAPE] Could not load recent problems:", err);
  }

  return {
    isRunning: isRunInProgress,
    scheduled: "Daily at 05:00 Europe/Belgrade, then home shelves",
    stores: listCompleteScraperStores(),
    recentProblems,
    activeRun: activeRunLiveState,
  };
}

export function initScrapeSchedule(): void {
  if (scheduledInitialized) return;
  scheduledInitialized = true;

  const expression = "0 5 * * *";
  const timezone = "Europe/Belgrade";

  console.log(
    `[SCRAPE_SCHEDULER] Registering cron "${expression}" tz=${timezone} (now=${new Date().toISOString()})`,
  );

  const task = cron.schedule(
    expression,
    async () => {
      console.log(
        `[SCRAPE_SCHEDULER] Tick at ${new Date().toISOString()} — starting scheduled run`,
      );
      try {
        const result = await runAllCompleteScrapers("scheduled");
        if (!result.ok) {
          console.error(
            "[SCRAPE_SCHEDULER] Scheduled run skipped/failed:",
            result.reason,
          );
        } else if (result.run && result.run.summary.failedSteps > 0) {
          console.error(
            "[SCRAPE_SCHEDULER] Scheduled run partial/failed:",
            result.run.status,
            result.run.id,
            collectProblemsFromRuns([result.run]),
          );
        } else {
          console.log(
            "[SCRAPE_SCHEDULER] Scheduled run finished:",
            result.run?.status,
            result.run?.id,
          );
        }
      } catch (error) {
        console.error("[SCRAPE_SCHEDULER] Unhandled scheduled run error:", error);
      }
    },
    {
      timezone,
    },
  );

  console.log(
    `[SCRAPE_SCHEDULER] Registered OK (task=${(task as { name?: string }).name ?? "ok"})`,
  );

  void migrateFileRunsToDbIfNeeded();
}
