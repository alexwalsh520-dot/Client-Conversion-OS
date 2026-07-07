// Internal CCOS tab for the live setter response-times view.
//
// The real page is the public, tokenized /p/setters/<token> (one source of
// truth for the UI). This tab just resolves the live 'setters' share token
// server-side and forwards there, so anyone with tab access lands on exactly
// what the setters see. Access: admins + anyone with /sales-hub (or this tab)
// in allowed_tabs — enforced by AccessGate like every other tab.
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setter Response Time" };

async function getLiveToken(): Promise<string | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", "setters")
      .eq("revoked", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data?.token) return null;
    return data.token;
  } catch {
    return null;
  }
}

export default async function SetterResponseTimePage() {
  // Resolve the token only for a signed-in user — this page runs server-side
  // BEFORE the client AccessGate, so without this check an anonymous request
  // would get the share token handed to it in the redirect.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const token = await getLiveToken();
  if (token) redirect(`/p/setters/${token}`);

  return (
    <div style={{ padding: 32, maxWidth: 520 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
        Setter Response Time
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
        No active share link found. Insert a row in public_share_links with
        kind = &apos;setters&apos; (revoked = false) and reload.
      </p>
    </div>
  );
}
