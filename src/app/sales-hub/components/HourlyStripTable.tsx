"use client";

/**
 * Compact horizontal hour strip — a header row of hour labels and one row of
 * plain numbers per group. No bars, no annotations; numbers only, per request.
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

export default function HourlyStripTable({
  title,
  hourLabels,
  rows,
}: {
  title?: string;
  hourLabels: string[];
  rows: StripRow[];
}) {
  if (rows.length === 0) return null;
  const minWidth = 96 + hourLabels.length * 34;

  return (
    <div className="glass-static" style={{ padding: "10px 12px", overflowX: "auto", marginTop: 8 }}>
      {title ? (
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          {title}
        </div>
      ) : null}

      <div style={{ minWidth }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 88, flexShrink: 0 }} />
          {hourLabels.map((label) => (
            <div
              key={label}
              style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--text-muted)" }}
            >
              {label}
            </div>
          ))}
        </div>

        {rows.map((row) => (
          <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <div
              style={{
                width: 88,
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 650,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.label}
            </div>
            {row.cells.map((cell, i) => (
              <div
                key={i}
                title={cell.tooltip}
                style={{
                  flex: 1,
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
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
