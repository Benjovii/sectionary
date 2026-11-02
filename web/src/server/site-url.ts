// This site's own origin, for links we send out and URLs the server fetches.
// NEXT_PUBLIC_SITE_URL when set; the request's host only as a fallback (local
// development). Behind some proxies the Host and X-Forwarded-Host headers are
// whatever the client sent, so a deployment sets NEXT_PUBLIC_SITE_URL and
// nothing here trusts them.

export function configuredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** The configured origin, else the origin of `request` (or of a host and protocol from headers). */
export function siteOrigin(fallback: string): string {
  return configuredOrigin() ?? fallback;
}
