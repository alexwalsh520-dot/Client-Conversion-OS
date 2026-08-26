import { auth } from "@/auth";
import { ShieldOff } from "lucide-react";
import MicromanagerClient from "./MicromanagerClient";

export const dynamic = "force-dynamic";

// Private tab for Alex + Matt. This server-side check is the hard gate — it blocks
// every other user (including other admins) from rendering the page, independent of
// the client-side sidebar visibility.
const OWNER_EMAILS = ["alexwalsh520@gmail.com", "matthew@clientconversion.io"];

export default async function MicromanagerPage() {
  const session = await auth();
  const isOwner = OWNER_EMAILS.includes(session?.user?.email?.toLowerCase() || "");

  if (!isOwner) {
    return (
      <div
        className="fade-up"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          gap: 16,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: "rgba(239,68,68,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ShieldOff size={28} style={{ color: "var(--danger, #ef4444)" }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            Private page
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            This page is restricted.
          </div>
        </div>
      </div>
    );
  }

  return <MicromanagerClient />;
}
