// Public, no-login Content Studio for a creator (Tyson / Antwan). Auth is bypassed via the
// /p/content/ allowlist; the CCOS sidebar is guarded off for all /p/ routes. Renders the FULL
// app (My Content, Trends, Coach) scoped to the token's creator. No dollar amounts ever.
import type { Metadata } from "next";
import { resolveContentToken } from "@/lib/content-data";
import PublicContentApp from "./PublicContentApp";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Content Studio",
  robots: { index: false, follow: false },
};

export default async function PublicContentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await resolveContentToken(token);
  if (!slug) {
    return (
      <div className="pub-unavailable">
        <div className="pub-unavailable-card">
          <h1>This link isn&apos;t available</h1>
          <p>It may have been revoked. Ask for a fresh link.</p>
        </div>
      </div>
    );
  }
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return (
    <>
      {/* Force LIGHT theme for the creator share page, before paint, regardless of system/last-used
          preference. Scoped to this page: it only sets the class (never writes localStorage), so a
          full load of the operator app re-runs its own theme script and is unaffected. */}
      <script dangerouslySetInnerHTML={{ __html: "try{var c=document.documentElement.classList;c.remove('dark');c.add('light');}catch(e){}" }} />
      <PublicContentApp token={token} name={name} />
    </>
  );
}
