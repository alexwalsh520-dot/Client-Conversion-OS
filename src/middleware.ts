import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Public API routes that should NOT require authentication
const PUBLIC_API_PREFIXES = [
  "/api/sales-hub/manychat-webhook",
  "/api/sales-hub/debug-",
  "/api/setup/",
  "/api/auth/",
  "/login",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default auth((req) => {
  // Allow public routes without auth
  if (isPublicRoute(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — allow through
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
