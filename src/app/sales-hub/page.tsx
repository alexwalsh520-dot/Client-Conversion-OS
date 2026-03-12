"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  BarChart3,
  Users,
  Phone,
  MessageSquareText,
  Shield,
  FileText,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import type { Filters, SheetRow } from "./types";
import FilterBar, { getEffectiveDates } from "./components/FilterBar";
import UnifiedDashboard from "./components/UnifiedDashboard";
import CloserPerformance from "./components/CloserPerformance";
import SetterPerformance from "./components/SetterPerformance";
import CallReview from "./components/CallReview";
import DMReview from "./components/DMReview";
import LeadIntelligence from "./components/LeadIntelligence";
import WeeklyReport from "./components/WeeklyReport";

/* ------------------------------------------------------------------ */
/*  Section nav items                                                  */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "closers", label: "Closers", icon: Phone },
  { id: "setters", label: "Setters", icon: Users },
  { id: "call-reviews", label: "Call Reviews", icon: Phone },
  { id: "dm-reviews", label: "DM Reviews", icon: MessageSquareText },
  { id: "intelligence", label: "Lead Intelligence", icon: Shield },
  { id: "reports", label: "Reports", icon: FileText },
] as const;

/* ------------------------------------------------------------------ */
/*  CollapsibleSection                                                 */
/* ------------------------------------------------------------------ */

function CollapsibleSection({
  id,
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} style={{ marginBottom: 24, scrollMarginTop: 72 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          border: "1px solid var(--border-subtle)",
          borderRadius: open ? "12px 12px 0 0" : 12,
          background: "var(--bg-card)",
          cursor: "pointer",
          transition: "all 0.2s ease",
        }}
      >
        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}>
          {icon}
        </span>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.2px",
          }}
        >
          {title}
        </span>
        {open ? (
          <ChevronUp size={16} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />
        )}
      </button>

      <div
        style={{
          maxHeight: open ? 5000 : 0,
          overflow: "hidden",
          opacity: open ? 1 : 0,
          transition: "max-height 0.35s ease, opacity 0.25s ease",
          border: open ? "1px solid var(--border-subtle)" : "none",
          borderTop: "none",
          borderRadius: "0 0 12px 12px",
          background: "var(--bg-card)",
        }}
      >
        <div style={{ padding: "20px 18px" }}>{children}</div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function SalesHubPage() {
  /* ---------- filter state ---------- */
  const [filters, setFilters] = useState<Filters>({
    client: "all",
    datePreset: "mtd",
    dateFrom: "",
    dateTo: "",
  });

  /* ---------- shared sheet data ---------- */
  const [sheetData, setSheetData] = useState<SheetRow[] | null>(null);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [sheetError, setSheetError] = useState("");

  const fetchSheetData = useCallback(async () => {
    const { dateFrom, dateTo } = getEffectiveDates(filters);
    setSheetLoading(true);
    setSheetError("");
    try {
      const clientParam =
        filters.client !== "all"
          ? `&client=${filters.client === "tyson" ? "Tyson Sonnek" : "Keith Holland"}`
          : "";
      const res = await fetch(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}${clientParam}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSheetData(data.rows);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Failed to fetch sheet data");
    } finally {
      setSheetLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchSheetData();
  }, [fetchSheetData]);

  /* ---------- scroll helper ---------- */
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ---------- render ---------- */
  return (
    <div className="fade-up">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Sales Manager Hub</h1>
        <p className="page-subtitle">
          Unified intelligence dashboard &mdash; DM performance, closer analytics, AI
          reviews, and lead intervention
        </p>
      </div>

      {/* Filter Bar */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Section Quick Nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          gap: 4,
          padding: "10px 0",
          marginBottom: 20,
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border-subtle)",
          overflowX: "auto",
        }}
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => scrollTo(id)}
            className="context-tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {/* Shared loading/error banner for sheet data */}
      {sheetLoading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            marginBottom: 16,
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
            marginBottom: 16,
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          {sheetError}
        </div>
      )}

      {/* Section 1: Dashboard */}
      <CollapsibleSection
        id="dashboard"
        title="Client Dashboard"
        icon={<BarChart3 size={18} />}
        defaultOpen
      >
        <UnifiedDashboard filters={filters} />
      </CollapsibleSection>

      {/* Section 2: Closer Performance */}
      <CollapsibleSection
        id="closers"
        title="Closer Performance"
        icon={<Phone size={18} />}
        defaultOpen
      >
        <CloserPerformance
          filters={filters}
          sheetData={sheetData}
          loading={sheetLoading}
          error={sheetError}
        />
      </CollapsibleSection>

      {/* Section 3: Setter Performance */}
      <CollapsibleSection
        id="setters"
        title="Setter Performance"
        icon={<Users size={18} />}
        defaultOpen
      >
        <SetterPerformance filters={filters} />
      </CollapsibleSection>

      {/* Section 4: Call Reviews */}
      <CollapsibleSection
        id="call-reviews"
        title="Call Reviews"
        icon={<Phone size={18} />}
      >
        <CallReview filters={filters} />
      </CollapsibleSection>

      {/* Section 5: DM Reviews */}
      <CollapsibleSection
        id="dm-reviews"
        title="DM Reviews"
        icon={<MessageSquareText size={18} />}
      >
        <DMReview filters={filters} />
      </CollapsibleSection>

      {/* Section 6: Lead Intelligence */}
      <CollapsibleSection
        id="intelligence"
        title="Lead Intelligence & Intervention"
        icon={<Shield size={18} />}
      >
        <LeadIntelligence filters={filters} sheetData={sheetData} />
      </CollapsibleSection>

      {/* Section 7: Weekly Reports */}
      <CollapsibleSection
        id="reports"
        title="Weekly Reports"
        icon={<FileText size={18} />}
      >
        <WeeklyReport filters={filters} />
      </CollapsibleSection>
    </div>
  );
}
