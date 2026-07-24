"use client";

import { useCallback, useMemo, useState } from "react";
import { COLUMNS, type ColumnDef } from "@/lib/ads-v2/definitions";
import { EMPTY_BASE, addBase, type AdsV2Level, type AdsV2Node, type AdsV2Payload, type CallDetail } from "@/lib/ads-v2/types";
import { formatCell, sortValue, fmtMD } from "./format";

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

// Starting column widths (px). Users can drag any header (including the first)
// to resize; dragging narrower clips the text rather than wrapping it.
const DEFAULT_WIDTHS: Record<string, number> = {
  name: 300,
  budget: 110,
  spend: 110,
  impressions: 120,
  cpm: 90,
  clicks: 110,
  ctr: 90,
  cpc: 90,
  messages: 110,
  costPerMessage: 130,
  booked: 130,
  costPerBooked: 150,
  taken: 130,
  costPerTaken: 150,
  showRate: 110,
  newClients: 120,
  closeRate: 120,
  msgToCall: 120,
  collected: 150,
  costPerClient: 130,
  collectedRoi: 140,
};
const ALL_COL_KEYS: string[] = ["name", ...METRIC_COLUMNS.map((c) => c.key)];
const MIN_COL_WIDTH = 60;

// Name column auto-fit bounds: never narrower than this, never wider than the
// sane max (past which we let the drag handle take over).
const NAME_MIN_WIDTH = 180;
const NAME_MAX_WIDTH = 560;
// Fixed chrome in the name cell (checkbox, chevron, dot, ads chip, status pill,
// cell padding) that sits beside the name text, plus the deepest indent.
const NAME_CHROME = 132;

// Measure text width once, with a canvas, in the table's body font. Deterministic
// and viewer-independent (no layout thrash), so auto-fit is stable.
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string): number {
  if (typeof document === "undefined") return text.length * 7;
  if (!_measureCtx) {
    const c = document.createElement("canvas");
    _measureCtx = c.getContext("2d");
    if (_measureCtx) _measureCtx.font = "500 13px Inter, system-ui, sans-serif";
  }
  return _measureCtx ? _measureCtx.measureText(text).width : text.length * 7;
}

// Every name that can appear at this level (the level's rows plus the children
// that expand under them), so auto-fit fits the longest visible name.
function namesForLevel(campaigns: AdsV2Node[], level: AdsV2Level): string[] {
  const out: string[] = [];
  const push = (n: AdsV2Node) => out.push(n.shortName || n.name || "");
  if (level === "campaign") {
    for (const c of campaigns) {
      push(c);
      for (const a of c.children) {
        push(a);
        for (const ad of a.children) push(ad);
      }
    }
  } else if (level === "adset") {
    for (const c of campaigns)
      for (const a of c.children) {
        push(a);
        for (const ad of a.children) push(ad);
      }
  } else {
    for (const c of campaigns) for (const a of c.children) for (const ad of a.children) push(ad);
  }
  return out;
}

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
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  // The name column defaults to auto-fit (full text) per level. A manual drag
  // pins a chosen width for THAT level; double-clicking the handle clears it and
  // auto-fit takes over again. Auto-fit re-runs on level/filter change unless a
  // level was manually sized.
  const [nameWidthByLevel, setNameWidthByLevel] = useState<Partial<Record<AdsV2Level, number>>>({});

  // Auto-fit width for the current level: the longest visible name plus chrome,
  // clamped to sane bounds. Re-computed when the level or the data changes.
  const nameAutoFit = useMemo(() => {
    const names = namesForLevel(payload.campaigns, level);
    let longest = 0;
    for (const n of names) longest = Math.max(longest, measureText(n));
    const indent = level === "ad" ? 44 : level === "adset" ? 22 : 0;
    return Math.min(NAME_MAX_WIDTH, Math.max(NAME_MIN_WIDTH, Math.ceil(longest) + NAME_CHROME + indent));
  }, [payload.campaigns, level]);

  const nameWidth = nameWidthByLevel[level] ?? nameAutoFit;
  const widthFor = useCallback(
    (k: string) => (k === "name" ? nameWidth : widths[k] ?? DEFAULT_WIDTHS[k] ?? 120),
    [nameWidth, widths],
  );

  // Drag a header's right edge to resize that column (v1's behavior). Resizing
  // the name column pins that width for the current level (manual override).
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthFor(key);
    setResizingKey(key);
    const onMove = (ev: MouseEvent) => {
      const minW = key === "name" ? MIN_COL_WIDTH : MIN_COL_WIDTH;
      const newW = Math.max(minW, startW + (ev.clientX - startX));
      if (key === "name") setNameWidthByLevel((m) => ({ ...m, [level]: newW }));
      else setWidths((w) => ({ ...w, [key]: newW }));
    };
    const onUp = () => {
      setResizingKey(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  // Double-click the name handle resets that level back to auto-fit.
  const resetNameWidth = () =>
    setNameWidthByLevel((m) => {
      const next = { ...m };
      delete next[level];
      return next;
    });
  const tableWidth = ALL_COL_KEYS.reduce((sum, k) => sum + widthFor(k), 0);

  // Top-level rows depend on the chosen level AND the current selection. The
  // tree is always campaign -> ad set -> ad; the level picks the starting grain.
  // A selection at a higher grain SCOPES the lower levels to the selected
  // parents (selecting campaigns then opening ad-set level shows only those
  // campaigns' ad sets, and the ad level only their ads). Clearing selection
  // restores the full view. Because the tree's parents are exact sums of their
  // children, the scoped TOTAL equals the selected parent rows' numbers.
  const topRows = useMemo<AdsV2Node[]>(() => {
    const camps = payload.campaigns;
    const allAdsets = camps.flatMap((c) => c.children);
    const selCampIds = new Set(camps.filter((c) => selected.has(c.id)).map((c) => c.id));
    const selAdsetIds = new Set(allAdsets.filter((a) => selected.has(a.id)).map((a) => a.id));

    if (level === "campaign") return camps;
    if (level === "adset") {
      const src = selCampIds.size > 0 ? camps.filter((c) => selCampIds.has(c.id)) : camps;
      return src.flatMap((c) => c.children);
    }
    // ad level: ad-set selection is most specific, else campaign selection, else all
    if (selAdsetIds.size > 0)
      return allAdsets.filter((a) => selAdsetIds.has(a.id)).flatMap((a) => a.children);
    if (selCampIds.size > 0)
      return camps.filter((c) => selCampIds.has(c.id)).flatMap((c) => c.children.flatMap((a) => a.children));
    return camps.flatMap((c) => c.children.flatMap((a) => a.children));
  }, [payload, level, selected]);

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

  // The TOTAL is a formula over the union of the DISPLAYED rows, so a scoped
  // lower level totals exactly to its selected parents. Unscoped, this equals
  // payload.total (the tree is built as exact sums), so nothing changes there.
  const totalBase = useMemo(
    () => topRows.reduce<typeof EMPTY_BASE>((acc, r) => addBase(acc, r), EMPTY_BASE),
    [topRows],
  );
  const totalNode: AdsV2Node = { ...EMPTY_BASE, ...totalBase } as unknown as AdsV2Node;
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
        <table className="ads" style={{ width: tableWidth }}>
          <colgroup>
            {ALL_COL_KEYS.map((k) => (
              <col key={k} style={{ width: widthFor(k) }} />
            ))}
          </colgroup>
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
                <span
                  className={`col-resize${resizingKey === "name" ? " active" : ""}`}
                  title="Drag to resize. Double-click to auto-fit the full name."
                  onMouseDown={(e) => startResize("name", e)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    resetNameWidth();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
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
                    <span
                      className={`col-resize${resizingKey === col.key ? " active" : ""}`}
                      onMouseDown={(e) => startResize(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
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
    // Header comes from EXACTLY the displayed rows (same cohort as the cell):
    // showed = hard-key taken; due = everyone booked except upcoming.
    const showed = rows.filter((d) => d.status === "showed").length;
    const upcoming = rows.filter((d) => d.status === "upcoming").length;
    const due = rows.length - upcoming;
    const pct = due > 0 ? Math.round((showed / due) * 100) : 0;
    proof = `${showed} of ${due} showed  ·  ${pct}%${upcoming ? `  ·  ${upcoming} upcoming (not counted)` : ""}`;
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
              <td>{fmtMD(d.dmEtDay)}</td>
              <td>{fmtMD(d.bookedEtDay)}</td>
              <td>{fmtMD(d.callEtDay)}</td>
              {showStatus && (
                <td>
                  <span className={`ch-status ${d.status}`}>
                    {d.status === "showed"
                      ? "Showed"
                      : d.status === "noshow"
                        ? "No-show"
                        : d.status === "upcoming"
                          ? "Upcoming"
                          : "No outcome yet"}
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
