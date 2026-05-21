/**
 * Many fiscal receipt QRs encode a host/path without `https://`. Normalize to a full URL.
 */
export function normalizeReceiptScannedUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  if (/^https?:\/\//i.test(t)) {
    try {
      return new URL(t).toString();
    } catch {
      return null;
    }
  }

  if (t.startsWith("//")) {
    try {
      return new URL(`https:${t}`).toString();
    } catch {
      return null;
    }
  }

  if (/^[a-z0-9][\w.-]*\.[a-z]{2,}/i.test(t)) {
    try {
      return new URL(`https://${t}`).toString();
    } catch {
      return null;
    }
  }

  return null;
}
