"use client";

import { UserPlus } from "lucide-react";
import { getClients } from "@/lib/data";
import { useAsyncData } from "@/lib/use-data";
import { mockClients } from "@/lib/mock-data";
import ReferralsForm from "@/components/referrals/ReferralsForm";

export default function ReferralsPage() {
  const { data: clients } = useAsyncData(getClients, mockClients);

  return (
    <div className="page-content" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="page-header" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
        <UserPlus size={20} style={{ color: "var(--accent)" }} />
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Referrals</h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            Log a new client referral. This adds a row to the Fitness Referral Tracker so the closers can pick it up.
          </p>
        </div>
      </div>

      <ReferralsForm clients={clients} />
    </div>
  );
}
