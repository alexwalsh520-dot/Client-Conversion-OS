"use client";

import type { Client } from "@/lib/types";
import ReferralsForm from "@/components/referrals/ReferralsForm";

interface Props {
  clients: Client[];
}

export default function ReferralsTab({ clients }: Props) {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
          Log a new client referral. This adds a row to the Fitness Referral Tracker so the closers can pick it up.
        </p>
      </div>
      <ReferralsForm clients={clients} />
    </div>
  );
}
