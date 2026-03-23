import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getServiceSupabase } from "@/lib/supabase";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    signIn: async ({ profile }) => {
      if (!profile?.email) return false;
      const email = profile.email.toLowerCase();

      // Check if user exists and is active in app_users table
      try {
        const sb = getServiceSupabase();
        const { data } = await sb
          .from("app_users")
          .select("is_active")
          .eq("email", email)
          .single();

        return data?.is_active === true;
      } catch {
        // Fallback to env var if Supabase is unreachable
        const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        return allowedEmails.includes(email);
      }
    },
    jwt: async ({ token, profile }) => {
      if (profile?.email) {
        // On sign-in, fetch role and allowed tabs
        try {
          const sb = getServiceSupabase();
          const { data } = await sb
            .from("app_users")
            .select("role, allowed_tabs")
            .eq("email", profile.email.toLowerCase())
            .eq("is_active", true)
            .single();

          if (data) {
            token.role = data.role;
            token.allowedTabs = data.allowed_tabs;
          }
        } catch {
          token.role = "client";
          token.allowedTabs = ["/"];
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      session.user.role = (token.role as "admin" | "client") ?? "client";
      session.user.allowedTabs = (token.allowedTabs as string[]) ?? ["/"];
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
