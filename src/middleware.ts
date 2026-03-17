export { auth as middleware } from "@/auth";

// Apply middleware to all routes except static assets
// Public route exemptions are handled in auth.ts authorized callback
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
