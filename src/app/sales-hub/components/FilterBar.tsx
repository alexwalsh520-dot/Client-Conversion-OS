"use client";

import { useCallback } from "react";
import { Calendar, Users } from "lucide-react";
import type { Filters, Client, DatePreset } from "../types";

/* ── Date helpers ─────────────────────────────────────────────────── */

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function getLast7(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function getLast30(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function getEffectiveDates(filters: Filters): {
  dateFrom: string;
  dateTo: string;
} {
  switch (filters.datePreset) {
    case "mtd":
      return { dateFrom: getMonthStart(), dateTo: getToday() };
    case "last7":
      return { dateFrom: getLast7(), dateTo: getToday() };
    case "last30":
      return { dateFrom: getLast30(), dateTo: getToday() };
    case "custom":
      return { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
  }
}

/* ── Component ────────────────────────────────────────────────────── */

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "mtd", label: "Month to Date" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "custom", label: "Custom Range" },
];

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const handleClientChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ ...filters, client: e.target.value as Client });
    },
    [filters, onChange],
  );

  const handlePresetChange = useCallback(
    (preset: DatePreset) => {
      onChange({ ...filters, datePreset: preset });
    },
    [filters, onChange],
  );

  const handleDateFrom = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...filters, dateFrom: e.target.value });
    },
    [filters, onChange],
  );

  const handleDateTo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...filters, dateTo: e.target.value });
    },
    [filters, onChange],
  );

  return (
    <div className="glass-static" style={{ padding: "16px 20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Client selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Users size={14} style={{ color: "var(--text-muted)" }} />
          <select
            className="form-input"
            value={filters.client}
            onChange={handleClientChange}
            style={{ width: "auto", minWidth: 160, padding: "8px 12px" }}
          >
            <option value="all">All Clients</option>
            <option value="tyson">Tyson Sonnek</option>
            <option value="keith">Keith Holland</option>
          </select>
        </div>

        {/* Separator */}
        <div
          style={{
            width: 1,
            height: 24,
            background: "var(--border-primary)",
            flexShrink: 0,
          }}
        />

        {/* Date preset tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <Calendar size={14} style={{ color: "var(--text-muted)", marginRight: 4 }} />
          {DATE_PRESETS.map(({ key, label }) => (
            <button
              key={key}
              className={`context-tab ${filters.datePreset === key ? "context-tab-active" : ""}`}
              onClick={() => handlePresetChange(key)}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range inputs */}
        {filters.datePreset === "custom" && (
          <>
            <div
              style={{
                width: 1,
                height: 24,
                background: "var(--border-primary)",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <input
                type="date"
                className="form-input"
                value={filters.dateFrom}
                onChange={handleDateFrom}
                style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
              />
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>to</span>
              <input
                type="date"
                className="form-input"
                value={filters.dateTo}
                onChange={handleDateTo}
                style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
