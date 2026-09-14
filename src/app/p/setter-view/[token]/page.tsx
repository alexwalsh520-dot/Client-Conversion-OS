// Public, no-login per-setter view of the Sales Hub.
//
// A setter opens https://client-conversion-os.vercel.app/p/setter-view/<token>.
// The token is validated SERVER-SIDE (kind = 'setter-view', not revoked, and a
// setter named in settings); the view then polls /api/public/setter-view/<token>
// — the actual data boundary. Ranges are Today / Yesterday only.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import SetterViewView from "./SetterViewView";
import "./setter-view.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "My Setter Stats",
  robots: { index: false, follow: false },
};

async function tokenSetterLabel(token: string): Promise<string | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked, settings, label")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || data.revoked || data.kind !== "setter-view") return null;
    const settings = (data.settings || {}) as { setter?: string; label?: string };
    if (!settings.setter) return null;
    return settings.label || settings.setter.charAt(0).toUpperCase() + settings.setter.slice(1);
  } catch {
    return null;
  }
}

function NotAvailable() {
  return (
    <main className="pub-sv-unavailable">
      <div className="pub-sv-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your manager for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicSetterViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const label = await tokenSetterLabel(token);
  if (!label) return <NotAvailable />;
  return <SetterViewView token={token} initialLabel={label} />;
}
