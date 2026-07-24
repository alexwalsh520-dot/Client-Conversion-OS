"use client";

import { useMemo, useState } from "react";
import { COLUMNS, type ColumnDef } from "@/lib/ads-v2/definitions";
import { EMPTY_BASE, type AdsV2Level, type AdsV2Node, type AdsV2Payload, type CallDetail } from "@/lib/ads-v2/types";
import { formatCell, sortValue } from "./format";

type SortDir = "asc" | "desc" | null;

interface HoverState {
  kind: "info" | "call" | "preview";
  x: number;
  y: number;
  col?: ColumnDef;
  callKind?: "booked" | "taken" | "showRate";
  node?: AdsV2Node;
  imageUrl?: string;
}

const METRIC_COLUMNS = COLUMNS.filter((c) => !c.isLabel);

const LEVELS: { id: AdsV2Level; label: string }[] = [
  { id: "campaign", label: "Campaign level" },
  { id: "adset", label: "Ad set level" },
  { id: "ad", label: "Ad level" },
];

export default function CampaignTable({
  payload,
  level,
  onLevelChange,
}: {
  payload: AdsV2Payload;
  level: AdsV2Level;
  onLevelChange: (l: AdsV2Level) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<HoverState | null>(null);

  // Top-level rows depend on the chosen level. The tree itself is always
  // campaign -> ad set -> ad; the level just picks the starting grain.
  const topRows = useMemo<AdsV2Node[]>(() => {
    if (level === "campaign") return payload.campaigns;
    if (level === "adset") return payload.campaigns.flatMap((c) => c.children);
    return payload.campaigns.flatMap((c) => c.children.flatMap((a) => a.children));
  }, [payload, level]);

  const sortedTop = useMemo(() => {
    if (!sortKey || !sortDir) return topRows;
    const rows = [...topRows];
    rows.sort((a, b) => {
      const av = sortValue(sortKey, a);
      const bv = sortValue(sortKey, b);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [topRows, sortKey, sortDir]);

  // Tri-state cycle: default -> ascending -> descending -> default.
  const cycleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = topRows.length > 0 && topRows.every((r) => selected.has(r.id));
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(topRows.map((r) => r.id)));
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totalNode: AdsV2Node = { ...EMPTY_BASE, ...payload.total } as unknown as AdsV2Node;
  const firstColLabel =
    level === "ad" ? "Campaign / Ad set / Ad" : level === "adset" ? "Campaign / Ad set" : "Campaign";

  const totalAdCount = useMemo(
    () => payload.campaigns.reduce((n, c) => n + c.children.reduce((m, a) => m + a.children.length, 0), 0),
    [payload],
  );

  const moveHover = (e: React.MouseEvent, patch: Omit<HoverState, "x" | "y">) =>
    setHover({ ...patch, x: e.clientX, y: e.clientY });

  const rowNoun = level === "ad" ? "ad" : level === "adset" ? "ad set" : "campaign";

  return (
    <div className="panel" onMouseLeave={() => setHover(null)}>
      <div className="tbl-toolbar">
        <div className="tbl-view-toggle">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={`tvt-btn${level === l.id ? " active" : ""}`}
              onClick={() => onLevelChange(l.id)}
            >
              {l.label}
              {l.id === "ad" && <span className="tvt-count">{totalAdCount}</span>}
            </button>
          ))}
        </div>
        <div className="tbl-toolbar-meta">
          {selected.size > 0 && (
            <span className="tbl-sel-chip">
              {selected.size} {rowNoun}
              {selected.size > 1 ? "s" : ""} selected
              <button className="tbl-sel-clear" onClick={() => setSelected(new Set())} aria-label="Clear selection">
                ×
              </button>
            </span>
          )}
        </div>
      </div>
      <div className="tbl-scroll">
        <table className="ads">
          <thead>
            <tr>
              <th>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    className="camp-check"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                  {firstColLabel}
                </span>
              </th>
              {METRIC_COLUMNS.map((col) => {
                const sorted = sortKey === col.key;
                const arrow = !sorted ? "↕" : sortDir === "asc" ? "↑" : "↓";
                return (
                  <th
                    key={col.key}
                    className={`sortable-th${col.calc ? " calc" : ""}${sorted ? " sorted" : ""}`}
                    onClick={() => cycleSort(col.key)}
                  >
                    {col.label}
                    <span
                      className="info-dot"
                      onClick={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => moveHover(e, { kind: "info", col })}
                      onMouseMove={(e) => moveHover(e, { kind: "info", col })}
                      onMouseLeave={() => setHover(null)}
                    >
                      ⓘ
                    </span>
                    <span className="sort-arrow">{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedTop.map((node) => (
              <NodeRows
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                selected={selected}
                onToggleExpand={toggleExpand}
                onToggleSelect={toggleSelect}
                onHover={moveHover}
                onClearHover={() => setHover(null)}
              />
            ))}
            {/* TOTAL: formulas over the union of displayed ads. */}
            <tr className="total-row">
              <td>Total</td>
              {METRIC_COLUMNS.map((col) => {
                const cell = formatCell(col.key, totalNode);
                return (
                  <td key={col.key} className={`num ${cell.cls}${cell.isCalc ? " calc" : ""}`}>
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {hover && <HoverLayer hover={hover} />}
    </div>
  );
}

function NodeRows({
  node,
  depth,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onHover,
  onClearHover,
}: {
  node: AdsV2Node;
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onHover: (e: React.MouseEvent, patch: Omit<HoverState, "x" | "y">) => void;
  onClearHover: () => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const rowClass = node.level === "campaign" ? "campaign-row" : node.level === "adset" ? "adset-row" : "ad-row";
  const dotClass = node.clientKey === "jake" ? "jake" : "tyson";

  return (
    <>
      <tr className={rowClass}>
        <td>
          <span className={`campaign-cell${depth === 1 ? " indent-1" : depth === 2 ? " indent-2" : ""}`}>
            {depth === 0 && (
              <input
                type="checkbox"
                className="camp-check"
                checked={selected.has(node.id)}
                onChange={() => onToggleSelect(node.id)}
                aria-label="Select row"
              />
            )}
            {hasChildren ? (
              <span className="chevron" onClick={() => onToggleExpand(node.id)}>
                {isOpen ? "▾" : "▸"}
              </span>
            ) : (
              <span className="chevron" />
            )}
            <span className={`camp-dot ${dotClass}`} />
            {node.level === "ad" && node.previewImageUrl ? (
              <span
                className="camp-name ad-name-preview"
                title={node.name}
                onMouseEnter={(e) => onHover(e, { kind: "preview", imageUrl: node.previewImageUrl! })}
                onMouseMove={(e) => onHover(e, { kind: "preview", imageUrl: node.previewImageUrl! })}
                onMouseLeave={onClearHover}
              >
                {node.shortName || node.name}
              </span>
            ) : (
              <span className="camp-name" title={node.name}>
                {node.shortName || node.name}
              </span>
            )}
            {hasChildren && <span className="ad-count-chip">{childCount(node)} ads</span>}
            <span className={`status-pill ${node.status}`}>
              {node.status === "active" ? "Active" : node.status === "finished" ? "Finished" : "empty"}
            </span>
          </span>
        </td>
        {METRIC_COLUMNS.map((col) => {
          const cell = formatCell(col.key, node);
          const isCall = col.key === "booked" || col.key === "taken" || col.key === "showRate";
          const hasCallData =
            isCall && node.callDetails && (node.callDetails.booked.length > 0 || node.callDetails.taken.length > 0);
          return (
            <td
              key={col.key}
              className={`num ${cell.cls}${cell.isCalc ? " calc" : ""}`}
              onMouseEnter={
                hasCallData
                  ? (e) => onHover(e, { kind: "call", callKind: col.key as HoverState["callKind"], node })
                  : undefined
              }
              onMouseMove={
                hasCallData
                  ? (e) => onHover(e, { kind: "call", callKind: col.key as HoverState["callKind"], node })
                  : undefined
              }
              onMouseLeave={hasCallData ? onClearHover : undefined}
            >
              {cell.text}
            </td>
          );
        })}
      </tr>
      {isOpen &&
        node.children.map((child) => (
          <NodeRows
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggleExpand={onToggleExpand}
            onToggleSelect={onToggleSelect}
            onHover={onHover}
            onClearHover={onClearHover}
          />
        ))}
    </>
  );
}

function childCount(node: AdsV2Node): number {
  if (node.level === "campaign") return node.children.reduce((n, a) => n + a.children.length, 0);
  return node.children.length;
}

function HoverLayer({ hover }: { hover: HoverState }) {
  const style: React.CSSProperties = {
    left: Math.min(hover.x + 16, typeof window !== "undefined" ? window.innerWidth - 480 : hover.x + 16),
    top: Math.min(hover.y + 16, typeof window !== "undefined" ? window.innerHeight - 320 : hover.y + 16),
  };

  if (hover.kind === "info" && hover.col) {
    return (
      <div className="info-tip" style={style}>
        <div className="it-title">{hover.col.label}</div>
        <div className="it-body">{hover.col.sentence}</div>
        <div className="it-src">Source: {hover.col.source}</div>
      </div>
    );
  }

  if (hover.kind === "preview" && hover.imageUrl) {
    return (
      <div className="ad-preview-popover" style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ad-preview-image" src={hover.imageUrl} alt="Ad creative" />
      </div>
    );
  }

  if (hover.kind === "call" && hover.node && hover.callKind) {
    return <CallHover node={hover.node} kind={hover.callKind} style={style} />;
  }
  return null;
}

function CallHover({
  node,
  kind,
  style,
}: {
  node: AdsV2Node;
  kind: "booked" | "taken" | "showRate";
  style: React.CSSProperties;
}) {
  const details = node.callDetails;
  if (!details) return null;
  const kw = node.keyword ? node.keyword.toUpperCase() : node.shortName;

  let rows: CallDetail[];
  let title: string;
  let proof: string | null = null;
  if (kind === "taken") {
    rows = details.taken.length ? details.taken : details.booked.filter((d) => d.status === "showed");
    title = `${node.taken} taken - ${kw}`;
  } else if (kind === "showRate") {
    rows = details.booked;
    title = `Show rate - ${kw}`;
    const due = node.booked - node.upcoming;
    const pct = due > 0 ? Math.round((node.takenPeople / due) * 100) : 0;
    proof = `${pct}% - ${node.takenPeople} showed of ${due} due - ${node.upcoming} upcoming (not counted)`;
  } else {
    rows = details.booked;
    title = `${node.booked} booked - ${kw}`;
  }

  const shown = rows.slice(0, 40);
  const showStatus = kind !== "taken";

  return (
    <div className="call-hover" style={style}>
      <div className="call-hover-title">{title}</div>
      {proof && <div className="call-hover-proof">{proof}</div>}
      <table className="ch-tbl">
        <thead>
          <tr>
            <th>Name</th>
            <th>DMed</th>
            <th>Booked</th>
            <th>Call</th>
            {showStatus && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((d, i) => (
            <tr key={i}>
              <td className="nm">
                {d.name}
                {d.records > 1 ? ` (${d.records})` : ""}
              </td>
              <td>{d.dmEtDay || "-"}</td>
              <td>{d.bookedEtDay || "-"}</td>
              <td>{d.callEtDay || "-"}</td>
              {showStatus && (
                <td>
                  <span className={`ch-status ${d.status}`}>
                    {d.status === "showed" ? "Showed" : d.status === "noshow" ? "No-show" : "Upcoming"}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <div className="ch-more">+ {rows.length - shown.length} more</div>}
    </div>
  );
}
