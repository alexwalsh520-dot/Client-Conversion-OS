"use client";

import { useCallback } from "react";
import { Users } from "lucide-react";
import { DateDropdown } from "@/app/ads-v2/controls";
import { rangeForPreset, todayEt, type DayRange } from "@/lib/ads-v2/time";
import type { Filters, Client, DatePreset } from "../types";
// The dropdown's look is defined by the ads-v2 stylesheet; every rule in it is
// scoped under .adsv2, so importing it here styles only the wrapper below.
import "@/app/ads-v2/ads-v2.css";

/* ── Date helpers ─────────────────────────────────────────────────── */

/**
 * Resolve the filters to an inclusive Eastern-time day range. Presets are
 * re-resolved against "today ET" on every call, so a tab left open past
 * midnight rolls over correctly; only Custom uses the stored dates.
 */
export function getEffectiveDates(filters: Filters): {
  dateFrom: string;
  dateTo: string;
} {
  if (filters.datePreset === "custom") {
    const fallback = todayEt();
    const dateFrom = filters.dateFrom || filters.dateTo || fallback;
    const dateTo = filters.dateTo || filters.dateFrom || fallback;
    return { dateFrom, dateTo };
  }
  const range = rangeForPreset(filters.datePreset, todayEt());
  return { dateFrom: range.from, dateTo: range.to };
}

/* ── Component ────────────────────────────────────────────────────── */

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /**
   * Clients present in the sales tracker for the selected timeline — derived
   * from the sheet rows (source of truth), so the dropdown updates itself as
   * the range changes. Empty while the sheet loads.
   */
  clientOptions: { key: string; name: string }[];
}

export default function FilterBar({ filters, onChange, clientOptions }: FilterBarProps) {
  const handleClientChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange({ ...filters, client: e.target.value as Client });
    },
    [filters, onChange],
  );

  const handleDateApply = useCallback(
    (preset: DatePreset, range: DayRange) => {
      onChange({ ...filters, datePreset: preset, dateFrom: range.from, dateTo: range.to });
    },
    [filters, onChange],
  );

  const effective = getEffectiveDates(filters);

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
            {clientOptions.map((c) => (
              <option key={c.key} value={c.key}>{c.name}</option>
            ))}
            {filters.client !== "all" &&
              !clientOptions.some((c) => c.key === filters.client) && (
                <option value={filters.client}>{filters.client}</option>
              )}
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

        {/* Ads V2 date dropdown (presets + two-click calendar, all ET).
            The .adsv2 wrapper carries the picker's design tokens; its
            page-level padding/background/min-height are neutralized. */}
        <div
          className="adsv2"
          style={{ padding: 0, background: "transparent", minHeight: 0, flexShrink: 0 }}
        >
          <DateDropdown
            preset={filters.datePreset}
            range={{ from: effective.dateFrom, to: effective.dateTo }}
            onApply={handleDateApply}
          />
        </div>
      </div>
    </div>
  );
}
