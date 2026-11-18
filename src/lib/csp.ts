/**
 * The Content-Security-Policy (Phase 9). Scripts run only with this request's nonce (Next.js adds it
 * to its own scripts when it sees the header on the request), so injected script can't run.
 * Styles allow inline because React style attributes carry department colours; images, video and
 * files come only from our own server (signed links) or blob:/data: previews made on the phone.
 * Nothing is loaded from other sites: fonts are self-hosted, and there are no third-party scripts.
 */
export function buildCsp(nonce: string, dev = process.env.NODE_ENV === "development") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function newNonce() {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
