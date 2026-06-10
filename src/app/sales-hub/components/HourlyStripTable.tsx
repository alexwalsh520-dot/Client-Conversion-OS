"use client";

import { useState } from "react";

/**
 * Compact hourly strip rendered as a spreadsheet-style table: bordered cells,
 * hour-label header row, one row of plain numbers per group.
 *
 * When `secondaryRows` is provided (e.g. % as primary, raw counts as
 * secondary), the header shows a small toggle and clicking it flips the view.
 */

export interface StripCell {
  value: string | null; // display text; null renders a muted dot
  danger?: boolean; // e.g. hours containing missed responses
  tooltip?: string;
}

export interface StripRow {
  id: string;
  label: string;
  cells: StripCell[];
}

const CELL_BORDER = "1px solid var(--border-subtle)";

export default function HourlyStripTable({
  title,
  hourLabels,
  rows,
  secondaryRows,
  toggleLabels = ["%", "#"],
}: {
  title?: string;
  hourLabels: string[];
  rows: StripRow[];
  secondaryRows?: StripRow[];
  toggleLabels?: [string, string];
}) {
  const [showSecondary, setShowSecondary] = useState(false);
  if (rows.length === 0) return null;

  const activeRows = showSecondary && secondaryRows ? secondaryRows : rows;
  const minWidth = 96 + hourLabels.length * 34;

  return (
    <div className="glass-static" style={{ padding: "10px 12px", overflowX: "auto", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        {title ? (
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            {title}
          </div>
        ) : (
          <div />
        )}
        {secondaryRows ? (
          <button
            onClick={() => setShowSecondary((v) => !v)}
            title={`Switch to ${showSecondary ? toggleLabels[0] : toggleLabels[1]}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 6,
              border: CELL_BORDER,
              background: "transparent",
              color: "var(--accent)",
              cursor: "pointer",
            }}
          >
            {showSecondary ? toggleLabels[1] : toggleLabels[0]} ▾
          </button>
        ) : null}
      </div>

      <table
        style={{
          minWidth,
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                width: 90,
                border: CELL_BORDER,
                padding: "3px 6px",
                fontSize: 9,
                textAlign: "left",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            />
            {hourLabels.map((label) => (
              <th
                key={label}
                style={{
                  border: CELL_BORDER,
                  padding: "3px 2px",
                  fontSize: 9,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeRows.map((row) => (
            <tr key={row.id}>
              <td
                style={{
                  border: CELL_BORDER,
                  padding: "4px 6px",
                  fontSize: 11,
                  fontWeight: 650,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {row.label}
              </td>
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  title={cell.tooltip}
                  style={{
                    border: CELL_BORDER,
                    padding: "4px 2px",
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 650,
                    whiteSpace: "nowrap",
                    color:
                      cell.value === null
                        ? "var(--text-muted)"
                        : cell.danger
                          ? "var(--danger)"
                          : "var(--text-primary)",
                    opacity: cell.value === null ? 0.45 : 1,
                  }}
                >
                  {cell.value ?? "·"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
