/**
 * A fast, optimistic check only: visitors without a session cookie are sent to the login page.
 * Real access control happens on the server in every page and action (requireActor / policy layer).
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = getSessionCookie(request, { cookiePrefix: "taamara" });
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip static files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|patterns/|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
