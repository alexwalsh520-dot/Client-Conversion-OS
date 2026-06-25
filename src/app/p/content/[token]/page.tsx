// Public, no-login Content view. Auth is bypassed for /p/content via proxy.ts.
// The share token is the ONLY scope: it resolves to exactly one creator's data.
import { getContentForCreator, resolveContentToken } from "@/lib/content-data";
import ContentView from "@/components/content/ContentView";

export const dynamic = "force-dynamic";

export default async function PublicContentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await resolveContentToken(token);

  if (!slug) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-primary, #0c0c0c)", color: "#aaa", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>This link isn’t available</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>It may have been revoked. Ask for a fresh link.</div>
        </div>
      </main>
    );
  }

  const data = await getContentForCreator(slug);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary, #0c0c0c)", padding: "32px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent, #c9a96e)" }}>Content Report</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary, #fff)", margin: "4px 0 0" }}>{data.name}</h1>
        </div>
        <ContentView data={data} publicView />
      </div>
    </main>
  );
}
