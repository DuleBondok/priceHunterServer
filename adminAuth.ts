import type { NextFunction, Request, Response } from "express";

export function getAdminApiToken(): string {
  return (process.env.ADMIN_API_TOKEN || "").trim();
}

/** Call once at boot. Production must have ADMIN_API_TOKEN. */
export function assertAdminAuthConfigured(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !getAdminApiToken()) {
    throw new Error(
      "ADMIN_API_TOKEN is required in production. Set it in the environment before starting.",
    );
  }
  if (!getAdminApiToken()) {
    console.warn(
      "[auth] ADMIN_API_TOKEN is not set — admin/scrape routes are open (dev only).",
    );
  }
}

function extractPresentedToken(req: Request): string {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const alt = req.headers["x-admin-token"];
  if (typeof alt === "string") return alt.trim();
  if (Array.isArray(alt) && typeof alt[0] === "string") return alt[0].trim();
  return "";
}

/**
 * Protects admin/scrape/match routes.
 * - If ADMIN_API_TOKEN is set: require Bearer / x-admin-token match.
 * - If unset (non-production only): allow (see assertAdminAuthConfigured).
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getAdminApiToken();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Admin auth not configured" });
      return;
    }
    next();
    return;
  }

  const presented = extractPresentedToken(req);
  if (presented && presented === expected) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
