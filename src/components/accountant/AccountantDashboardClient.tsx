"use client";

import { useEffect, useState } from "react";
import AccountantDashboard from "./AccountantDashboard";
import {
  Balance,
  Transaction,
  PeriodSummary,
  MonthlyReport,
} from "@/lib/accountant-types";

interface DashboardData {
  balances: Balance[];
  currentMonth: {
    start: string;
    end: string;
    label: string;
    transactions: Transaction[];
    summary: PeriodSummary;
  };
  trend: Array<{ month: string; income: number; expenses: number; net: number }>;
  storedReports: MonthlyReport[];
}

export default function AccountantDashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accountant/data", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as DashboardData;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
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

  return <AccountantDashboard {...data} />;
}
