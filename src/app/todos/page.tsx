import { auth } from "@/auth";
import { ShieldOff } from "lucide-react";
import TodosClient from "./TodosClient";

export const dynamic = "force-dynamic";

// Private, single-owner tab: the server-side check is the hard gate, matching
// the Micromanager pattern. Sidebar visibility is handled by ownerEmail on the
// nav item; this blocks direct URL access for everyone else.
const OWNER_EMAIL = "alexwalsh520@gmail.com";

export default async function TodosPage() {
  const session = await auth();
  const isOwner = session?.user?.email?.toLowerCase() === OWNER_EMAIL;

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

  return <TodosClient />;
}
