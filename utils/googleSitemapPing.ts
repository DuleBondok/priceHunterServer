const SITEMAP_URL =
  process.env.PRICELY_SITEMAP_URL || "https://pricely.rs/sitemap.xml";

const PING_URL = `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;

/** Fire-and-forget Google sitemap ping (does not block callers). */
export function pingGoogleSitemapFireAndForget(): void {
  fetch(PING_URL, { method: "GET", redirect: "follow" })
    .then(async (res) => {
      if (res.ok) {
        console.log(
          `[sitemap-ping] OK ${res.status} — notified Google for ${SITEMAP_URL}`,
        );
        return;
      }
      const body = await res.text().catch(() => "");
      console.warn(
        `[sitemap-ping] HTTP ${res.status} for ${PING_URL}` +
          (body ? ` — ${body.slice(0, 200)}` : ""),
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sitemap-ping] Failed:", message);
    });
}
