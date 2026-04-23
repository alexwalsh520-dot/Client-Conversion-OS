"use client";

import { useEffect, useState } from "react";
import AccountantDashboard from "./AccountantDashboard";
import {
  AccountantDashboardData,
} from "@/lib/accountant-types";

export default function AccountantDashboardClient() {
  const [data, setData] = useState<AccountantDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData(cancelled = false) {
    try {
      setError(null);
      const res = await fetch("/api/accountant/data", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as AccountantDashboardData;
      if (!cancelled) setData(json);
    } catch (e) {
      if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadData(cancelled);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 32, color: "var(--danger, #ef4444)" }}>
        Failed to load accountant data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 32, color: "var(--text-muted)" }}>
        Loading financial data…
      </div>
    );
  }

  return <AccountantDashboard {...data} onRefreshData={() => loadData(false)} />;
}
