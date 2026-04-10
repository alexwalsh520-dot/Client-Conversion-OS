"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  BarChart3,
  Users,
  Phone,
  MessageSquareText,
  Shield,
  FileText,
  Calendar,
  History,
  ChevronDown,
  Loader2,
  Sparkles,
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
import DailyBriefs from "./components/DailyBriefs";
import ReportHistory from "./components/ReportHistory";
import AlexTesting from "./components/AlexTesting";

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
  { id: "daily-briefs", label: "Briefs", icon: Calendar },
  { id: "report-history", label: "History", icon: History },
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
    <section id={id} style={{ marginBottom: 16, scrollMarginTop: 72 }}>
      <div
        style={{
          borderRadius: 12,
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
          borderLeft: open ? "3px solid var(--accent)" : "1px solid var(--border-subtle)",
          transition: "border-color 0.2s ease",
        }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            background: "var(--bg-card)",
            cursor: "pointer",
            border: "none",
            transition: "background 0.15s ease",
          }}
        >
          <span style={{
            color: open ? "var(--accent)" : "var(--text-muted)",
            display: "flex", alignItems: "center",
            transition: "color 0.2s ease",
          }}>
            {icon}
          </span>
          <span
            style={{
              flex: 1,
              textAlign: "left",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
              letterSpacing: "-0.2px",
            }}
          >
            {title}
          </span>
          <ChevronDown
            size={15}
            style={{
              color: "var(--text-muted)",
              transition: "transform 0.25s ease",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </button>

        <div
          style={{
            maxHeight: open ? 5000 : 0,
            overflow: "hidden",
            opacity: open ? 1 : 0,
            transition: "max-height 0.35s ease, opacity 0.25s ease",
          }}
        >
          <div style={{
            padding: "20px 18px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-card)",
          }}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Gold Shimmer Button                                                */
/* ------------------------------------------------------------------ */

function GoldShimmerButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <style>{`
        @keyframes goldShimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes goldParticle1 {
          0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
          20% { opacity: 1; transform: translate(-6px, -10px) scale(1); }
          80% { opacity: 0.6; transform: translate(8px, -18px) scale(0.6); }
        }
        @keyframes goldParticle2 {
          0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
          30% { opacity: 1; transform: translate(8px, -8px) scale(0.8); }
          90% { opacity: 0.4; transform: translate(-4px, -20px) scale(0.3); }
        }
        @keyframes goldParticle3 {
          0%, 100% { opacity: 0; transform: translate(0, 0) scale(0); }
          15% { opacity: 0.8; transform: translate(4px, -12px) scale(1); }
          85% { opacity: 0.2; transform: translate(-8px, -22px) scale(0.4); }
        }
        @keyframes goldPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(201,169,110,0.3), 0 0 16px rgba(201,169,110,0.1); }
          50% { box-shadow: 0 0 12px rgba(201,169,110,0.5), 0 0 24px rgba(201,169,110,0.2), 0 0 40px rgba(201,169,110,0.08); }
        }
        .gold-btn {
          position: relative;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          border: 1px solid rgba(201,169,110,0.4);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            linear-gradient(
              135deg,
              rgba(201,169,110,0.15) 0%,
              rgba(180,140,70,0.25) 25%,
              rgba(220,190,130,0.35) 50%,
              rgba(180,140,70,0.25) 75%,
              rgba(201,169,110,0.15) 100%
            );
          background-size: 200% 100%;
          animation: goldShimmer 3s ease-in-out infinite, goldPulse 2.5s ease-in-out infinite;
          transition: all 0.2s ease;
          overflow: visible;
        }
        .gold-btn::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 11px;
          background: linear-gradient(
            135deg,
            rgba(201,169,110,0.6) 0%,
            rgba(240,210,150,0.8) 40%,
            rgba(201,169,110,0.6) 60%,
            rgba(160,130,70,0.5) 100%
          );
          background-size: 200% 200%;
          animation: goldShimmer 2s ease-in-out infinite;
          z-index: -1;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          padding: 1px;
        }
        .gold-btn:hover {
          transform: scale(1.08);
          border-color: rgba(201,169,110,0.7);
          box-shadow: 0 0 16px rgba(201,169,110,0.5), 0 0 32px rgba(201,169,110,0.2) !important;
        }
        .gold-btn:active {
          transform: scale(0.96);
        }
        .gold-btn.active {
          border-color: rgba(201,169,110,0.8);
          background:
            linear-gradient(
              135deg,
              rgba(201,169,110,0.25) 0%,
              rgba(180,140,70,0.4) 50%,
              rgba(201,169,110,0.25) 100%
            );
        }
        .gold-particle {
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(240,210,150,0.9) 0%, rgba(201,169,110,0.4) 100%);
          pointer-events: none;
        }
        .gold-particle:nth-child(1) { top: 4px; right: 2px; animation: goldParticle1 2.8s ease-in-out infinite; }
        .gold-particle:nth-child(2) { bottom: 6px; left: 3px; animation: goldParticle2 3.2s ease-in-out infinite 0.5s; }
        .gold-particle:nth-child(3) { top: 50%; right: -2px; animation: goldParticle3 2.4s ease-in-out infinite 1s; }
        .gold-particle:nth-child(4) { top: 2px; left: 50%; width: 2px; height: 2px; animation: goldParticle1 3s ease-in-out infinite 1.5s; }
        .gold-particle:nth-child(5) { bottom: 2px; right: 50%; width: 2px; height: 2px; animation: goldParticle2 2.6s ease-in-out infinite 0.8s; }
      `}</style>
      <button
        className={`gold-btn ${active ? "active" : ""}`}
        onClick={onClick}
        title="Alex Testing Dashboard"
      >
        <span className="gold-particle" />
        <span className="gold-particle" />
        <span className="gold-particle" />
        <span className="gold-particle" />
        <span className="gold-particle" />
        <Sparkles
          size={18}
          style={{
            color: "#e8d5a8",
            filter: "drop-shadow(0 0 4px rgba(201,169,110,0.6))",
          }}
        />
      </button>
    </>
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

  /* ---------- alex testing panel ---------- */
  const [alexOpen, setAlexOpen] = useState(false);

  /* ---------- shared sheet data ---------- */
  const [sheetData, setSheetData] = useState<SheetRow[] | null>(null);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [sheetError, setSheetError] = useState("");

  const fetchSheetData = useCallback(async () => {
    const { dateFrom, dateTo } = getEffectiveDates(filters);
    setSheetLoading(true);
    setSheetError("");
    try {
      const clientNames: Record<string, string> = {
        tyson: "Tyson Sonnek",
        keith: "Keith Holland",
        zoeEmily: "Zoe and Emily",
      };
      const clientParam =
        filters.client !== "all" && clientNames[filters.client]
          ? `&client=${encodeURIComponent(clientNames[filters.client])}`
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
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Sales Hub</h1>
          <p className="page-subtitle">
            Unified intelligence dashboard &mdash; DM performance, closer analytics, AI
            reviews, and lead intervention
          </p>
        </div>
        <GoldShimmerButton active={alexOpen} onClick={() => setAlexOpen((o) => !o)} />
      </div>

      {/* Alex Testing Dropdown — slides down from top */}
      <div
        style={{
          maxHeight: alexOpen ? 3000 : 0,
          overflow: "hidden",
          opacity: alexOpen ? 1 : 0,
          transition: "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
          marginBottom: alexOpen ? 16 : 0,
        }}
      >
        <div
          style={{
            borderRadius: 12,
            border: "1px solid rgba(201,169,110,0.2)",
            background: "var(--bg-card)",
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Subtle gold top border glow */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: "linear-gradient(90deg, transparent, rgba(201,169,110,0.6), transparent)",
            }}
          />
          <AlexTesting filters={filters} />
        </div>
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
          gap: 6,
          padding: "10px 0",
          marginBottom: 16,
          background: "rgba(9, 9, 11, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border-subtle)",
          overflowX: "auto",
        }}
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => scrollTo(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            <Icon size={13} />
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

      {/* Section 8: Daily Briefs */}
      <CollapsibleSection
        id="daily-briefs"
        title="Daily Closer Briefs"
        icon={<Calendar size={18} />}
      >
        <DailyBriefs filters={filters} />
      </CollapsibleSection>

      {/* Section 9: Report History */}
      <CollapsibleSection
        id="report-history"
        title="Report History"
        icon={<History size={18} />}
      >
        <ReportHistory />
      </CollapsibleSection>
    </div>
  );
}
