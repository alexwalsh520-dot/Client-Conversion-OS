"use client";

import { useCallback, useEffect, useState } from "react";
import SupplementsDashboard from "./SupplementsDashboard";
import type { PeriodKey, SupplementsDashboardData } from "@/lib/supplements-types";

export default function SupplementsDashboardClient() {
  const [data, setData] = useState<SupplementsDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("this_month");

  const loadData = useCallback(async (p: PeriodKey) => {
    try {
      setError(null);
      const res = await fetch(`/api/supplements/data?period=${p}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as SupplementsDashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    loadData(period);
  }, [period, loadData]);

  if (error) {
    return (
      <div style={{ padding: 32, color: "var(--danger, #ef4444)" }}>
        Failed to load supplements data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 32, color: "var(--text-muted)" }}>Loading supplements data…</div>
    );
  }

  return (
    <SupplementsDashboard
      data={data}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={() => loadData(period)}
    />
  );
}
