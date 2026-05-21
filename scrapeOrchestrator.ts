import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import cron from "node-cron";

type StepStatus = "success" | "failed";
type RunStatus = "running" | "success" | "partial" | "failed";

export type ScrapeRunStep = {
  store: "Idea" | "Maxi" | "DIS";
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

type RunsFile = {
  runs: ScrapeRun[];
};

/** Backend package root — avoids empty history when `app.ts` is started from a different cwd. */
const BACKEND_ROOT = __dirname;
const RUNS_FILE_PATH = path.join(BACKEND_ROOT, "data", "scrape-runs.json");
const MAX_LOG_LINES_PER_STEP = 400;
const MAX_RUNS_TO_KEEP = 60;

let isRunInProgress = false;
let scheduledInitialized = false;
let activeRunLiveState: {
  runId: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  currentStore?: "Idea" | "Maxi" | "DIS";
  currentCommand?: string;
  currentStepStartedAt?: string;
  currentStepLogs: string[];
  completedSteps: ScrapeRunStep[];
} | null = null;

const SCRAPER_STEPS = [
  {
    store: "Idea" as const,
    command: "npx",
    args: ["ts-node", "runIdeaCompleteScrape.ts"],
  },
  {
    store: "Maxi" as const,
    command: "npx",
    args: ["ts-node", "scrapers/maxiCompleteScraper.ts"],
  },
  {
    store: "DIS" as const,
    command: "npx",
    args: ["ts-node", "scrapers/disCompleteScraper.ts"],
  },
];

async function ensureRunsFile(): Promise<void> {
  const dir = path.dirname(RUNS_FILE_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(RUNS_FILE_PATH);
  } catch {
    const initial: RunsFile = { runs: [] };
    await fs.writeFile(RUNS_FILE_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readRuns(): Promise<ScrapeRun[]> {
  await ensureRunsFile();
  const raw = await fs.readFile(RUNS_FILE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as RunsFile;
  return parsed.runs ?? [];
}

async function writeRuns(runs: ScrapeRun[]): Promise<void> {
  await ensureRunsFile();
  const trimmed = runs.slice(0, MAX_RUNS_TO_KEEP);
  await fs.writeFile(RUNS_FILE_PATH, JSON.stringify({ runs: trimmed }, null, 2), "utf-8");
}

function runScraperStep(
  store: "Idea" | "Maxi" | "DIS",
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
      env: process.env,
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

    child.on("close", (exitCodeRaw) => {
      const finishedAtDate = new Date();
      const exitCode = exitCodeRaw ?? -1;

      const finalInfo = extractFinalInfoFromLogs(logs);
      const step: ScrapeRunStep = {
        store,
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        status: exitCode === 0 ? "success" : "failed",
        exitCode,
        command: [command, ...args].join(" "),
        logs,
        finalInfo,
        errorMessage:
          exitCode === 0 ? undefined : `Step failed with exit code ${exitCode}`,
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

  // productService format: "Created: X, Updated: Y, Price cleared: P, Total: Z"
  const createdUpdatedClearedTotal = joined.match(
    /Created:\s*(\d+),\s*Updated:\s*(\d+),\s*Price cleared:\s*(\d+),\s*Total:\s*(\d+)/i,
  );

  // Legacy productService format: "Created: X, Updated: Y, Total: Z"
  const createdUpdatedTotal = joined.match(
    /Created:\s*(\d+),\s*Updated:\s*(\d+),\s*Total:\s*(\d+)/i,
  );

  // idea persist (with price cleared)
  const ideaPersistNew = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new,\s*(\d+)\s*price updates,\s*(\d+)\s*price cleared,\s*(\d+)\s*products in DB/i,
  );

  // idea persist legacy
  const ideaPersist = joined.match(
    /Scraped\s*(\d+)\s*rows\s*[^\d]*(\d+)\s*new,\s*(\d+)\s*price updates,\s*(\d+)\s*products in DB/i,
  );

  // Generic scrape totals:
  const disCollected = joined.match(/\[DIS\]\s*Total collected:\s*(\d+)/i);
  const maxiCollected = joined.match(/Total products collected:\s*(\d+)/i);

  const info: {
    scraped?: number;
    created?: number;
    updated?: number;
    priceCleared?: number;
    totalInDb?: number;
  } = {};

  if (createdUpdatedClearedTotal) {
    info.created = Number(createdUpdatedClearedTotal[1]);
    info.updated = Number(createdUpdatedClearedTotal[2]);
    info.priceCleared = Number(createdUpdatedClearedTotal[3]);
    info.totalInDb = Number(createdUpdatedClearedTotal[4]);
  } else if (createdUpdatedTotal) {
    info.created = Number(createdUpdatedTotal[1]);
    info.updated = Number(createdUpdatedTotal[2]);
    info.totalInDb = Number(createdUpdatedTotal[3]);
  }

  if (ideaPersistNew) {
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
  if (failedSteps === run.steps.length) status = "failed";
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

export async function runAllCompleteScrapers(
  trigger: "manual" | "scheduled",
): Promise<{ ok: boolean; reason?: string; run?: ScrapeRun }> {
  if (isRunInProgress) {
    return { ok: false, reason: "A scraping run is already in progress." };
  }

  isRunInProgress = true;
  const runId = `${Date.now()}`;
  activeRunLiveState = {
    runId,
    trigger,
    startedAt: new Date().toISOString(),
    currentStepLogs: [],
    completedSteps: [],
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
    for (const step of SCRAPER_STEPS) {
      if (activeRunLiveState) {
        activeRunLiveState.currentStore = step.store;
        activeRunLiveState.currentCommand = [step.command, ...step.args].join(" ");
        activeRunLiveState.currentStepStartedAt = new Date().toISOString();
        activeRunLiveState.currentStepLogs = [];
      }

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
    }

    const doneRun = finalizeRun(run);
    const existingRuns = await readRuns();
    await writeRuns([doneRun, ...existingRuns]);
    return { ok: true, run: doneRun };
  } catch (error) {
    const failedRun = finalizeRun({
      ...run,
      steps: [
        ...run.steps,
        {
          store: "Idea",
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
    const existingRuns = await readRuns();
    await writeRuns([failedRun, ...existingRuns]);
    return { ok: false, reason: "Unhandled run failure", run: failedRun };
  } finally {
    isRunInProgress = false;
    activeRunLiveState = null;
  }
}

export async function getScrapeRuns(): Promise<ScrapeRun[]> {
  return readRuns();
}

export function getScrapeStatus(): {
  isRunning: boolean;
  scheduled: string;
  activeRun: null | {
    runId: string;
    trigger: "manual" | "scheduled";
    startedAt: string;
    currentStore?: "Idea" | "Maxi" | "DIS";
    currentCommand?: string;
    currentStepStartedAt?: string;
    currentStepLogs: string[];
    completedSteps: ScrapeRunStep[];
  };
} {
  return {
    isRunning: isRunInProgress,
    scheduled: "Daily at 05:00 Europe/Belgrade",
    activeRun: activeRunLiveState,
  };
}

export function initScrapeSchedule(): void {
  if (scheduledInitialized) return;
  scheduledInitialized = true;

  // 05:00 every day in Serbian timezone.
  cron.schedule(
    "0 5 * * *",
    async () => {
      const result = await runAllCompleteScrapers("scheduled");
      if (!result.ok) {
        console.error("[SCRAPE_SCHEDULER] Scheduled run skipped/failed:", result.reason);
      }
    },
    {
      timezone: "Europe/Belgrade",
    },
  );
}
