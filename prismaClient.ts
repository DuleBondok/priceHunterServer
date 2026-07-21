import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(__dirname, ".env") });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function tuneDatabaseUrl(
  url: string,
  connectionLimit: string,
  poolTimeout: string,
): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", connectionLimit);
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", poolTimeout);
    }
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Long-running Express server should use Neon's direct host (not -pooler) so it
 * does not compete with PricelyLandingPage / scripts on the 9-slot pooler.
 */
function resolveDatabaseUrl(): string | undefined {
  const explicitDirect =
    process.env.DIRECT_DATABASE_URL?.trim() ||
    process.env.NEON_DIRECT_DATABASE_URL?.trim();
  if (explicitDirect) {
    return tuneDatabaseUrl(explicitDirect, "5", "60");
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("-pooler")) {
      parsed.hostname = parsed.hostname.replace("-pooler", "");
      parsed.searchParams.delete("pgbouncer");
    }
    return tuneDatabaseUrl(parsed.toString(), "5", "60");
  } catch {
    return tuneDatabaseUrl(url, "3", "60");
  }
}

const databaseUrl = resolveDatabaseUrl();

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl
      ? { datasources: { db: { url: databaseUrl } } }
      : undefined,
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
