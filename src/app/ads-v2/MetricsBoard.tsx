"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CARD_BY_ID, CARD_DEFS, DEFAULT_CARD_IDS, type CardDef, type CardFormat } from "@/lib/ads-v2/cards";
import type { AdsV2MetricsPayload, BaseMetrics, MetricsDay } from "@/lib/ads-v2/types";
import { IcCheck } from "./icons";
import { fmtMD } from "./format";

const STORE_KEY = "ccos.adsv2.metricCards.v1";

function loadLayout(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_CARD_IDS];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [...DEFAULT_CARD_IDS];
    const ids = (JSON.parse(raw) as string[]).filter((id) => CARD_BY_ID[id]);
    return ids.length ? ids : [...DEFAULT_CARD_IDS];
  } catch {
    return [...DEFAULT_CARD_IDS];
  }
}

function saveLayout(ids: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked; the order still holds for this session */
  }
}

function formatValue(v: number | null, fmt: CardFormat): string {
  if (v == null || !Number.isFinite(v)) return "-";
  switch (fmt) {
    case "usd":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "usd2":
      return `$${v.toFixed(2)}`;
    case "cpm":
      return `$${v.toFixed(2)}`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "ratio2":
      return `${v.toFixed(2)}x`;
    default:
      return String(v);
  }
}

export default function MetricsBoard({
  publicToken,
  account,
  status,
  dateFrom,
  dateTo,
  tableVersion,
}: {
  publicToken?: string;
  account: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  // The table's data_version, so the board only paints numbers from the SAME
  // snapshot the table is showing (never a mismatched pair).
  tableVersion: number;
}) {
  const [metrics, setMetrics] = useState<AdsV2MetricsPayload | null>(null);
  const [layout, setLayout] = useState<string[]>(() => loadLayout());
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const cache = useRef<Map<string, AdsV2MetricsPayload>>(new Map());

  const key = `${account}|${status}|${dateFrom}|${dateTo}`;

  const load = useCallback(async () => {
    const url = publicToken
      ? `/api/public/ads-v2/${publicToken}?section=metrics&status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`
      : `/api/ads-v2/metrics?account=${account}&status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AdsV2MetricsPayload;
      if (!data.preparing) cache.current.set(key, data);
      setMetrics(data);
    } catch {
      /* the table already surfaced any load error */
    }
  }, [publicToken, account, status, dateFrom, dateTo, key]);

  // Lazily fetch the slice AFTER the table paints (a short defer), and re-poll
  // once if it is still preparing.
  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) setMetrics(cached);
    const t = setTimeout(load, cached ? 0 : 250);
    return () => clearTimeout(t);
  }, [key, load]);

  useEffect(() => {
    if (!metrics?.preparing) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [metrics, load]);

  const ready = metrics && !metrics.preparing && metrics.dataVersion === tableVersion;
  const total: BaseMetrics | null = ready ? metrics!.total : null;
  const days: MetricsDay[] = ready ? metrics!.days : [];

  // ── Drag to rearrange. Reorder live during the drag for feel, but PERSIST
  //    only once, on drop. ────────────────────────────────────────────────
  const dragId = useRef<string | null>(null);
  const onCardPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    dragId.current = id;
  };
  const onCardPointerEnter = (overId: string) => () => {
    const from = dragId.current;
    if (!from || from === overId) return;
    setLayout((prev) => {
      const a = prev.indexOf(from);
      const b = prev.indexOf(overId);
      if (a < 0 || b < 0) return prev;
      const next = [...prev];
      next.splice(a, 1);
      next.splice(b, 0, from);
      return next;
    });
  };
  useEffect(() => {
    const onUp = () => {
      if (dragId.current) {
        dragId.current = null;
        setLayout((cur) => {
          saveLayout(cur); // the ONE write, on drop
          return cur;
        });
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  const removeCard = (id: string) =>
    setLayout((prev) => {
      const next = prev.filter((x) => x !== id);
      saveLayout(next);
      return next;
    });

  const applyAdd = (ids: string[]) => {
    setLayout(ids);
    saveLayout(ids);
    setAdding(false);
  };

  const visible = layout.filter((id) => CARD_BY_ID[id]);
  const left = visible.filter((_, i) => i % 2 === 0);
  const right = visible.filter((_, i) => i % 2 === 1);

  const renderCard = (id: string) => {
    const def = CARD_BY_ID[id];
    if (!def) return null;
    return (
      <MetricCard
        key={id}
        def={def}
        total={total}
        days={days}
        editing={editing}
        onRemove={() => removeCard(id)}
        onPointerDown={onCardPointerDown(id)}
        onPointerEnter={onCardPointerEnter(id)}
        dragging={dragId.current === id}
      />
    );
  };

  return (
    <div className="metric-board">
      <div className="metric-board-head">
        <h2 className="metric-board-title">Metrics</h2>
        <div className="metric-board-actions">
          <button className="metric-board-btn" onClick={() => setAdding(true)}>
            + Add
          </button>
          <button
            className={`metric-board-btn${editing ? " active" : ""}`}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>
      {!ready ? (
        <div className="metric-loading">Loading metrics...</div>
      ) : (
        <div className={`metric-grid${editing ? " editing" : ""}`}>
          <div className="metric-col">{left.map(renderCard)}</div>
          <div className="metric-col">{right.map(renderCard)}</div>
        </div>
      )}
      {adding && (
        <AddModal current={visible} onApply={applyAdd} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function MetricCard({
  def,
  total,
  days,
  editing,
  dragging,
  onRemove,
  onPointerDown,
  onPointerEnter,
}: {
  def: CardDef;
  total: BaseMetrics | null;
  days: MetricsDay[];
  editing: boolean;
  dragging: boolean;
  onRemove: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerEnter: () => void;
}) {
  const [tip, setTip] = useState(false);
  const value = total ? def.value(total) : null;
  const points = days.map((d) => def.point(d));
  const labels = days.map((d) => fmtMD(d.day));

  return (
    <div
      className={`metric-card${editing ? " editing" : ""}${dragging ? " dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
    >
      {editing && (
        <button className="metric-delete" onClick={onRemove} aria-label="Remove card">
          ×
        </button>
      )}
      <div className="metric-card-head">
        <div className="metric-card-title">
          {def.label}
          <span
            className="info-dot"
            onMouseEnter={() => setTip(true)}
            onMouseLeave={() => setTip(false)}
          >
            ⓘ
          </span>
          {tip && (
            <span className="metric-tip">
              {def.sentence}
              <span className="metric-tip-src">Source: {def.source}</span>
            </span>
          )}
        </div>
        <div className="metric-card-big">{formatValue(value, def.format)}</div>
        <div className="metric-card-meta">{def.meta}</div>
      </div>
      <LineChart points={points} labels={labels} format={def.format} />
    </div>
  );
}

// Inline SVG line chart: a smoothed line with a soft gradient fill and a hover
// readout, ported from v1's LineChart (no chart library).
function LineChart({ points, labels, format }: { points: number[]; labels: string[]; format: CardFormat }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 150;
  const PAD = 6;
  const n = points.length;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const span = max - min || 1;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const pts = points.map((v, i) => [x(i), y(v)] as const);
  const line = smoothPath(pts);
  const area = n > 0 ? `${line} L ${x(n - 1)},${H} L ${x(0)},${H} Z` : "";
  const gid = useMemo(() => `g${Math.round(labels.length * 97 + max)}`, [labels.length, max]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - rel);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <div className="lc-wrap">
      <svg
        className="lc-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#${gid})`} />}
        {line && <path d={line} fill="none" stroke="var(--gold)" strokeWidth="1.6" />}
        {hover != null && n > 0 && (
          <>
            <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={H - PAD} stroke="var(--border-2)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover])} r="3" fill="var(--gold)" />
          </>
        )}
      </svg>
      {hover != null && n > 0 && (
        <div className="lc-tip">
          <span className="lc-tip-day">{labels[hover]}</span>
          <span className="lc-tip-val">{formatValue(points[hover], format)}</span>
        </div>
      )}
    </div>
  );
}

// Catmull-Rom -> cubic Bezier smoothing (v1's smoothPath).
function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// Add-metric modal. Selection states corrected from v1's inversion:
// SELECTED = darker fill + gold accent border + a visible checkmark; unselected
// = a neutral subtle outline; hover is distinct from both. Selected always looks
// more committed. Apply keeps existing-selected order, then appends new ones.
function AddModal({
  current,
  onApply,
  onClose,
}: {
  current: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(current));
  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const apply = () => {
    const kept = current.filter((id) => sel.has(id));
    const added = CARD_DEFS.filter((c) => sel.has(c.id) && !current.includes(c.id)).map((c) => c.id);
    onApply([...kept, ...added]);
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Add or remove metrics</div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="metric-add-grid">
            {CARD_DEFS.map((def) => {
              const on = sel.has(def.id);
              return (
                <button
                  key={def.id}
                  className={`metric-pick${on ? " selected" : ""}`}
                  onClick={() => toggle(def.id)}
                >
                  <span className="metric-pick-text">
                    <span className="metric-pick-label">{def.label}</span>
                    <span className="metric-pick-meta">{def.meta}</span>
                  </span>
                  <span className="metric-pick-icon">{on ? <IcCheck /> : "+"}</span>
                </button>
              );
            })}
          </div>
          <div className="metric-add-foot">
            <button className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="apply-btn" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
