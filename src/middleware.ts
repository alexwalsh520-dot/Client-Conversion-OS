export { auth as middleware } from "@/auth";

// Only protect non-API routes and non-webhook routes
// API routes that need to be publicly accessible (webhooks, debug, setup) are excluded
export const config = {
  matcher: [
    // Match all routes EXCEPT:
    // - /api/sales-hub/manychat-webhook (Manychat sends POST here)
    // - /api/sales-hub/debug-* (debug endpoints)
    // - /api/setup/* (setup endpoints)
    // - /api/auth/* (NextAuth handlers)
    // - /_next/* (Next.js internals)
    // - /favicon.ico, /login
    "/((?!api/sales-hub/manychat-webhook|api/sales-hub/debug-|api/setup/|api/auth/|_next/|favicon\\.ico|login).*)",
  ],
};
