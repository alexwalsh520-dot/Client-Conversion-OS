import { auth } from "@/auth";
import { ShieldOff } from "lucide-react";
import InvoicingClient from "@/components/invoicing/InvoicingClient";

export const dynamic = "force-dynamic";

// Private, single-owner tab. This server-side check is the hard gate — it blocks
// every other user (including other admins) from rendering the page, independent of
// the client-side AccessGate and sidebar visibility.
const OWNER_EMAIL = "matthew@clientconversion.io";

export default async function InvoicingPayoutsPage() {
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
          <ShieldOff size={28} style={{ color: "var(--danger)" }} />
        </div>
        <h2 style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 600, margin: 0 }}>Access Restricted</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 400 }}>This tab is private.</p>
      </div>
    );
  }

  return <InvoicingClient />;
}
