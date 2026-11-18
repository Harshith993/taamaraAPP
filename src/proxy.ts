/**
 * Runs before every page and API request:
 *  - a fresh nonce and the Content-Security-Policy (src/lib/csp.ts) on every response
 *  - a fast, optimistic check only: visitors without a session cookie are sent to the login page.
 *    Real access control happens on the server in every page and action (requireActor / policy layer).
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  const next = () => {
    // Next.js reads the nonce from the request's CSP header while rendering.
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return withCsp(NextResponse.next({ request: { headers } }));
  };
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();
  const hasSession = getSessionCookie(request, { cookiePrefix: "taamara" });
  if (!hasSession) {
    // The JSON API answers 401 instead of redirecting to a page.
    if (pathname.startsWith("/api/")) return withCsp(NextResponse.json({ error: "Please sign in again." }, { status: 401 }));
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return withCsp(NextResponse.redirect(url));
  }
  return next();
}

export const config = {
  // Skip static files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|patterns/|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
