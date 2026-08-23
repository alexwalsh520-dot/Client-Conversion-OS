"use client";

// Sales Dashboard — composed view.
//
//   1. Client Dashboard  — Sales Hub's UnifiedDashboard, reused as-is against
//      /api/sales-hub/sheet-data, so per-client numbers match Sales Hub 1:1.
//   2. By Lead Type      — engine-powered breakdown (lead type only exists in
//      the metrics engine), labeled "(attributed)" for honest provenance.
//   3. Closer Performance — Sales Hub's CloserPerformance, reused as-is on the
//      same sheet rows (same numbers, same click-to-expand).
//   4. Engine metrics    — the existing MetricsDashboardView "sales" grid,
//      unchanged numbers and behavior, demoted under a section header.
//
// Sections 1–3 share the Sales Hub filter bar (client + date presets); the
// lead-type section queries the engine over the same effective date window.
// The engine grid keeps its own filters, exactly as before.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Gauge, Loader2, Phone } from "lucide-react";
import type { Filters, SheetRow } from "../sales-hub/types";
import FilterBar, { getEffectiveDates } from "../sales-hub/components/FilterBar";
import { clientsFromRows, rowMatchesClientKey } from "../sales-hub/components/clientsFromRows";
import UnifiedDashboard from "../sales-hub/components/UnifiedDashboard";
import CloserPerformance from "../sales-hub/components/CloserPerformance";
import MetricsDashboardView from "../master-dashboard/MetricsDashboardView";
import LeadTypeBreakdown from "./LeadTypeBreakdown";

export default function SalesDashboardView() {
  /* ---------- filter state (Sales Hub semantics) ---------- */
  const [filters, setFilters] = useState<Filters>({
    client: "all",
    datePreset: "mtd",
    dateFrom: "",
    dateTo: "",
  });

  /* ---------- shared sheet data (same fetch as Sales Hub) ---------- */
  const [sheetData, setSheetData] = useState<SheetRow[] | null>(null);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [sheetError, setSheetError] = useState("");

  // Always fetch the FULL range (no client param): the tracker rows are the
  // source of truth for which clients exist in this timeline; per-client
  // views filter client-side — identical to the Sales Hub page.
  const { dateFrom: effDateFrom, dateTo: effDateTo } = getEffectiveDates(filters);
  const fetchSheetData = useCallback(async () => {
    setSheetLoading(true);
    setSheetError("");
    try {
      const res = await fetch(
        `/api/sales-hub/sheet-data?dateFrom=${effDateFrom}&dateTo=${effDateTo}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSheetData(data.rows);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Failed to fetch sheet data");
    } finally {
      setSheetLoading(false);
    }
  }, [effDateFrom, effDateTo]);

  useEffect(() => {
    fetchSheetData();
  }, [fetchSheetData]);

  // Clients present in the tracker for this timeline — drives the dropdown.
  const clientOptions = useMemo(
    () => clientsFromRows(sheetData ?? []).map((c) => ({ key: c.key, name: c.name })),
    [sheetData],
  );

  // If the selected client has no rows in the new timeline, fall back to All.
  useEffect(() => {
    if (
      !sheetLoading &&
      sheetData &&
      filters.client !== "all" &&
      !clientOptions.some((c) => c.key === filters.client)
    ) {
      setFilters((prev) => ({ ...prev, client: "all" }));
    }
  }, [sheetLoading, sheetData, clientOptions, filters.client]);

  // Rows for the selected client (or all) — feeds Closer Performance.
  const visibleSheetData = useMemo(() => {
    if (!sheetData || filters.client === "all") return sheetData;
    return sheetData.filter((row) => rowMatchesClientKey(row, filters.client));
  }, [sheetData, filters.client]);

  /* ---------- render ---------- */
  return (
    <div className="fade-up">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Sales Dashboard</h1>
        <p className="page-subtitle">
          Client overview, lead-type breakdown, closer performance, and engine metrics
        </p>
      </div>

      {/* Filter Bar (client + date range — governs the sheet-based sections) */}
      <FilterBar filters={filters} onChange={setFilters} clientOptions={clientOptions} />

      {/* Shared loading/error banner for sheet data */}
      {sheetLoading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            margin: "16px 0",
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Loader2 size={14} className="spin" />
          Loading sheet data...
        </div>
      )}
      {sheetError && (
        <div
          style={{
            padding: "12px 16px",
            margin: "16px 0",
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          {sheetError}
        </div>
      )}

      {/* Section 1: Client Dashboard — Sales Hub's client comparison, reused */}
      <div className="section" style={{ marginTop: 20 }}>
        <h2 className="section-title">
          <BarChart3 size={16} />
          Client Dashboard
        </h2>
        <UnifiedDashboard filters={filters} />
      </div>

      {/* Section 2: By lead type — engine-attributed (lead type only exists there) */}
      <div style={{ marginTop: 24 }}>
        <LeadTypeBreakdown
          dateFrom={effDateFrom}
          dateTo={effDateTo}
          client={filters.client}
        />
      </div>

      {/* Section 3: Closer Performance — Sales Hub's component, reused */}
      <div style={{ marginTop: 24 }}>
        <CloserPerformance
          filters={filters}
          sheetData={visibleSheetData}
          loading={sheetLoading}
          error={sheetError}
        />
      </div>

      {/* Section 4: Engine metrics — the existing grid, unchanged, demoted */}
      <div className="section" style={{ marginTop: 32 }}>
        <h2 className="section-title">
          <Gauge size={16} />
          Engine Metrics
        </h2>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "0 0 12px",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Phone size={12} />
          Metrics-engine numbers with their own filters — click any metric for its breakdowns.
        </p>
        <MetricsDashboardView scope="sales" embedded />
      </div>
    </div>
  );
}
