import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextRequest } from "next/server";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Public API routes that should NOT require authentication
const PUBLIC_API_PREFIXES = [
  "/api/sales-hub/manychat-webhook",
  "/api/sales-hub/debug-",
  "/api/setup/",
  "/api/auth/",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: async ({ auth, request }: { auth: unknown; request?: NextRequest }) => {
      // Allow public API routes without auth
      if (request?.nextUrl?.pathname && isPublicRoute(request.nextUrl.pathname)) {
        return true;
      }
      return !!auth;
    },
    signIn: async ({ profile }) => {
      if (!profile?.email) return false;
      return allowedEmails.includes(profile.email.toLowerCase());
    },
    session: async ({ session, token }) => {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
