"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  Flag,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";

type AccountFilter = "all" | "tyson" | "keith";
type StatusFilter = "active" | "finished" | "all";
type LevelFilter = "campaign" | "ad";

interface AdsTrackerRow {
  id: string;
  clientKey: string;
  name: string;
  keyword: string;
  dateLabel: string;
  adSpend: number;
  impressions: number;
  linkClicks: number;
  cpm: number;
  ctr: number;
  cpc: number;
  messages: number;
  costPerMessage: number | null;
  bookedCalls: number;
  costPerBookedCall: number | null;
  newClients: number;
  contractedRevenue: number;
  callClosingRate: number;
  messagesConversionRate: number;
  collectedRevenue: number;
  costPerNewClient: number | null;
  contractedRoi: number;
  collectedRoi: number;
  status: "active" | "finished";
}

interface AdsTrackerPayload {
  mock?: boolean;
  summary: {
    adSpend: number;
    collectedRevenue: number;
    contractedRevenue: number;
    collectedRoi: number;
    contractedRoi: number;
    messages: number;
    bookedCalls: number;
    newClients: number;
  };
  rows: AdsTrackerRow[];
  adRoas: Array<{
    id: string;
    label: string;
    clientKey: string;
    collectedRoi: number;
    contractedRoi: number;
    collectedRevenue: number;
  }>;
  trend: Array<{
    label: string;
    adSpend: number;
    collectedRevenue: number;
    collectedRoi: number;
  }>;
  recentEvents: Array<{
    source: "manychat" | "ghl";
    eventType: string;
    clientKey: string;
    keyword: string;
    name: string;
    setter: string | null;
    eventAt: string;
  }>;
}

const ACCOUNT_OPTIONS: Array<{ id: AccountFilter; label: string }> = [
  { id: "all", label: "All accounts" },
  { id: "tyson", label: "Tyson" },
  { id: "keith", label: "Keith" },
];

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "finished", label: "Finished" },
  { id: "all", label: "All" },
];

const DATE_PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "yesterday", label: "Yesterday", days: 1 },
  { id: "last3", label: "Last 3 days", days: 3 },
  { id: "last7", label: "Last 7 days", days: 7 },
  { id: "last14", label: "Last 14 days", days: 14 },
  { id: "last30", label: "Last 30 days", days: 30 },
  { id: "thisMonth", label: "This month", days: 24 },
  { id: "lastMonth", label: "Last month", days: 30 },
  { id: "custom", label: "Custom", days: 7 },
];

const TABLE_COLUMNS = [
  ["name", "Campaign / Date"],
  ["adSpend", "Ad spend"],
  ["impressions", "Impressions"],
  ["cpm", "CPM"],
  ["linkClicks", "Link clicks"],
  ["ctr", "CTR"],
  ["cpc", "CPC"],
  ["messages", "Messages"],
  ["costPerMessage", "Cost / msg"],
  ["bookedCalls", "Booked calls"],
  ["costPerBookedCall", "Cost / 60-min call"],
  ["newClients", "New clients"],
  ["contractedRevenue", "Contracted revenue"],
  ["callClosingRate", "Call close rate"],
  ["messagesConversionRate", "Msg -> call"],
  ["collectedRevenue", "Collected revenue"],
  ["costPerNewClient", "Cost / client"],
  ["contractedRoi", "Contracted ROI"],
  ["collectedRoi", "Collected ROI"],
] as const;

const CALCULATED_COLUMNS = new Set<string>([
  "cpm",
  "ctr",
  "cpc",
  "costPerMessage",
  "costPerBookedCall",
  "callClosingRate",
  "messagesConversionRate",
  "costPerNewClient",
  "contractedRoi",
  "collectedRoi",
]);

type TableKey = (typeof TABLE_COLUMNS)[number][0];

const DEFAULT_CAMPAIGNS = [
  makeRow({
    id: "tyson-campaign",
    clientKey: "tyson",
    name: "Tyson — Warm Spring Shred Challenge",
    keyword: "TYSON",
    adSpend: 2391,
    impressions: 336050,
    linkClicks: 7190,
    messages: 489,
    bookedCalls: 75,
    newClients: 24,
    contractedRevenue: 59200,
    collectedRevenue: 47300,
  }),
  makeRow({
    id: "keith-campaign",
    clientKey: "keith",
    name: "Keith — Warm Spring Shred Challenge",
    keyword: "KEITH",
    adSpend: 2134,
    impressions: 282930,
    linkClicks: 5206,
    messages: 357,
    bookedCalls: 49,
    newClients: 10,
    contractedRevenue: 30600,
    collectedRevenue: 26500,
  }),
];

const DEFAULT_AD_ROWS = [
  ["BULK", "tyson", 390, 54800, 1130, 72, 12, 4, 13200],
  ["CUT", "tyson", 420, 59200, 1265, 88, 14, 5, 12400],
  ["RIPPED", "tyson", 365, 51500, 1110, 67, 11, 3, 10400],
  ["LEAN", "tyson", 430, 60400, 1315, 82, 13, 4, 12300],
  ["STRONG", "tyson", 405, 56800, 1205, 73, 11, 3, 11300],
  ["FIT", "tyson", 381, 53600, 1165, 69, 9, 3, 10600],
  ["SHRED", "tyson", 0, 9700, 0, 38, 5, 2, 3600],
  ["GOAL", "keith", 430, 57100, 1050, 78, 11, 3, 8700],
  ["DIALED", "keith", 390, 51600, 947, 62, 9, 2, 7900],
  ["CORE", "keith", 355, 47100, 866, 51, 7, 1, 6300],
  ["FOCUS", "keith", 342, 45300, 835, 58, 8, 2, 6100],
  ["EASY", "keith", 310, 41100, 756, 49, 7, 1, 5400],
  ["ACT", "keith", 307, 40730, 752, 59, 7, 1, 5200],
].map(([keyword, clientKey, adSpend, impressions, linkClicks, messages, bookedCalls, newClients, collectedRevenue]) =>
  makeRow({
    id: `${clientKey}-${keyword}`.toLowerCase(),
    clientKey: String(clientKey),
    name: String(keyword),
    keyword: String(keyword),
    adSpend: Number(adSpend),
    impressions: Number(impressions),
    linkClicks: Number(linkClicks),
    messages: Number(messages),
    bookedCalls: Number(bookedCalls),
    newClients: Number(newClients),
    contractedRevenue: Number(collectedRevenue) * 1.12,
    collectedRevenue: Number(collectedRevenue),
  })
);

const DEFAULT_ROAS_BARS = [
  { label: "BULK", clientKey: "tyson", roi: 30.0, revenue: 4400 },
  { label: "CUT", clientKey: "tyson", roi: 29.5, revenue: 6100 },
  { label: "RIPPED", clientKey: "tyson", roi: 28.6, revenue: 9200 },
  { label: "LEAN", clientKey: "tyson", roi: 28.6, revenue: 8700 },
  { label: "STRONG", clientKey: "tyson", roi: 27.9, revenue: 12900 },
  { label: "FIT", clientKey: "tyson", roi: 27.8, revenue: 14500 },
];

const RECENT_ENTRIES = [
  ["Apr 22 · 4:12p", "Mia", "Tyson", "BONUS", "Messages", "5"],
  ["Apr 22 · 3:48p", "Diego", "Tyson", "EASY", "Messages", "1"],
  ["Apr 22 · 2:30p", "Mia", "Keith", "FOCUS", "Messages", "2"],
  ["Apr 22 · 1:05p", "Jake", "Tyson", "SIMPLE", "Messages", "1"],
  ["Apr 22 · 12:20p", "Diego", "Keith", "ACT", "Messages", "1"],
  ["Apr 21 · 6:44p", "Mia", "Tyson", "FIT", "Collected $", "$1,500"],
  ["Apr 21 · 5:12p", "Jake", "Tyson", "STRONG", "Contracted $", "$2,400"],
  ["Apr 21 · 3:02p", "Mia", "Keith", "GOAL", "New clients", "1"],
];

function dateInNewYork() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function money(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function num(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function roi(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(2)}x`;
}

function clientName(clientKey: string) {
  if (clientKey === "tyson") return "Tyson";
  if (clientKey === "keith") return "Keith";
  return clientKey;
}

function campaignName(clientKey: string) {
  return `${clientName(clientKey)} — Warm Spring Shred Challenge`;
}

function makeRow(input: {
  id: string;
  clientKey: string;
  name: string;
  keyword: string;
  adSpend: number;
  impressions: number;
  linkClicks: number;
  messages: number;
  bookedCalls: number;
  newClients: number;
  contractedRevenue: number;
  collectedRevenue: number;
  status?: "active" | "finished";
}): AdsTrackerRow {
  const adSpend = input.adSpend;
  return {
    ...input,
    dateLabel: "",
    cpm: input.impressions > 0 ? (adSpend / input.impressions) * 1000 : 0,
    ctr: input.impressions > 0 ? (input.linkClicks / input.impressions) * 100 : 0,
    cpc: input.linkClicks > 0 ? adSpend / input.linkClicks : 0,
    costPerMessage: input.messages > 0 ? adSpend / input.messages : null,
    costPerBookedCall: input.bookedCalls > 0 ? adSpend / input.bookedCalls : null,
    callClosingRate: input.bookedCalls > 0 ? (input.newClients / input.bookedCalls) * 100 : 0,
    messagesConversionRate: input.messages > 0 ? (input.bookedCalls / input.messages) * 100 : 0,
    costPerNewClient: input.newClients > 0 ? adSpend / input.newClients : null,
    contractedRoi: adSpend > 0 ? input.contractedRevenue / adSpend : 0,
    collectedRoi: adSpend > 0 ? input.collectedRevenue / adSpend : 0,
    status: input.status || "active",
  };
}

function fromApiRow(row: AdsTrackerRow) {
  return makeRow({
    id: row.id,
    clientKey: row.clientKey,
    name: row.name,
    keyword: row.keyword,
    adSpend: row.adSpend,
    impressions: row.impressions,
    linkClicks: row.linkClicks,
    messages: row.messages,
    bookedCalls: row.bookedCalls,
    newClients: row.newClients,
    contractedRevenue: row.contractedRevenue,
    collectedRevenue: row.collectedRevenue,
    status: row.status,
  });
}

function aggregateCampaignRows(rows: AdsTrackerRow[]) {
  const grouped = new Map<string, AdsTrackerRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.clientKey) || [];
    list.push(row);
    grouped.set(row.clientKey, list);
  }

  return Array.from(grouped.entries()).map(([clientKey, list]) =>
    makeRow({
      id: `${clientKey}-campaign`,
      clientKey,
      name: campaignName(clientKey),
      keyword: clientName(clientKey).toUpperCase(),
      adSpend: list.reduce((sum, row) => sum + row.adSpend, 0),
      impressions: list.reduce((sum, row) => sum + row.impressions, 0),
      linkClicks: list.reduce((sum, row) => sum + row.linkClicks, 0),
      messages: list.reduce((sum, row) => sum + row.messages, 0),
      bookedCalls: list.reduce((sum, row) => sum + row.bookedCalls, 0),
      newClients: list.reduce((sum, row) => sum + row.newClients, 0),
      contractedRevenue: list.reduce((sum, row) => sum + row.contractedRevenue, 0),
      collectedRevenue: list.reduce((sum, row) => sum + row.collectedRevenue, 0),
    })
  );
}

function totalRow(rows: AdsTrackerRow[]) {
  return makeRow({
    id: "total",
    clientKey: "all",
    name: "TOTAL",
    keyword: "TOTAL",
    adSpend: rows.reduce((sum, row) => sum + row.adSpend, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    linkClicks: rows.reduce((sum, row) => sum + row.linkClicks, 0),
    messages: rows.reduce((sum, row) => sum + row.messages, 0),
    bookedCalls: rows.reduce((sum, row) => sum + row.bookedCalls, 0),
    newClients: rows.reduce((sum, row) => sum + row.newClients, 0),
    contractedRevenue: rows.reduce((sum, row) => sum + row.contractedRevenue, 0),
    collectedRevenue: rows.reduce((sum, row) => sum + row.collectedRevenue, 0),
  });
}

function valueForCell(row: AdsTrackerRow, key: TableKey) {
  switch (key) {
    case "name":
      return row.name;
    case "adSpend":
    case "contractedRevenue":
    case "collectedRevenue":
      return money(row[key]);
    case "cpm":
    case "cpc":
    case "costPerMessage":
    case "costPerBookedCall":
    case "costPerNewClient":
      return money(row[key], key === "cpm" ? 2 : 2);
    case "ctr":
    case "callClosingRate":
    case "messagesConversionRate":
      return pct(row[key]);
    case "contractedRoi":
    case "collectedRoi":
      return roi(row[key]);
    default:
      return num(row[key]);
  }
}

function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onAway();
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onAway]);
  return ref;
}

function SelectFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));
  const active = options.find((option) => option.id === value) || options[0];

  return (
    <div className="ads-filter" ref={ref}>
      <button className={`filter-btn ${open ? "open" : ""}`} onClick={() => setOpen((next) => !next)}>
        <span className="lbl">{label}</span>
        <span className="val">{active.label}</span>
        <ChevronDown size={13} className="caret" />
      </button>
      {open && (
        <div className="pop">
          {options.map((option) => (
            <button
              key={option.id}
              className={`pop-item ${option.id === value ? "selected" : ""}`}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              {option.label}
              {option.id === value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Segmented({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}) {
  return (
    <div className="segmented">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.id}
          className={`seg ${option.id === value ? "active" : ""}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DateDropdown({
  dateFrom,
  dateTo,
  onRange,
}: {
  dateFrom: string;
  dateTo: string;
  onRange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("last7");
  const ref = useClickAway<HTMLDivElement>(() => setOpen(false));

  function applyPreset(id: string, days: number) {
    const today = dateInNewYork();
    const to = id === "yesterday" ? shiftDate(today, -1) : today;
    const from = shiftDate(to, -(days - 1));
    setPreset(id);
    onRange(from, to);
  }

  return (
    <div className="ads-filter" ref={ref}>
      <button className={`filter-btn date-btn ${open ? "open" : ""}`} onClick={() => setOpen((next) => !next)}>
        <Calendar size={14} />
        <span className="val">{DATE_PRESETS.find((item) => item.id === preset)?.label || "Custom"}</span>
        <span className="date-range">· {shortDate(dateFrom)} – {shortDate(dateTo)}, 2026</span>
        <ChevronDown size={13} className="caret" />
      </button>
      {open && (
        <div className="pop date-pop">
          <div className="date-presets">
            {DATE_PRESETS.map((item) => (
              <button
                key={item.id}
                className={`pop-item ${item.id === preset ? "selected" : ""}`}
                onClick={() => applyPreset(item.id, item.days)}
              >
                {item.label}
                {item.id === preset && <Check size={12} />}
              </button>
            ))}
          </div>
          <div className="date-cal">
            <div className="cal-head">April 2026</div>
            <div className="cal-grid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day} className="cal-dow">{day}</span>
              ))}
              {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => (
                <button
                  key={day}
                  className={`cal-day ${day >= 16 && day <= 22 ? "in-range" : ""} ${day === 16 || day === 22 ? "endpoint" : ""}`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="date-foot">
            <span>Dates shown in America/New_York</span>
            <button onClick={() => setOpen(false)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignTable({
  rows,
  level,
  onLevelChange,
}: {
  rows: AdsTrackerRow[];
  level: LevelFilter;
  onLevelChange: (value: LevelFilter) => void;
}) {
  const total = totalRow(rows);

  return (
    <div className="panel table-panel">
      <div className="tbl-toolbar">
        <div className="tbl-view-toggle">
          <button
            className={`tvt-btn ${level === "campaign" ? "active" : ""}`}
            onClick={() => onLevelChange("campaign")}
          >
            Campaign level
          </button>
          <button
            className={`tvt-btn ${level === "ad" ? "active" : ""}`}
            onClick={() => onLevelChange("ad")}
          >
            Ad level <span className="tvt-count">13</span>
          </button>
        </div>
      </div>
      <div className="tbl-scroll">
        <table className="ads-table">
          <thead>
            <tr>
              {TABLE_COLUMNS.map(([key, label]) => (
                <th key={key} className={`${key === "name" ? "sticky" : ""} ${CALCULATED_COLUMNS.has(key) ? "calc" : ""}`}>
                  {level === "ad" && key === "name" ? "Campaign / Date / Ad" : label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={level === "ad" ? "ad-row" : "campaign-row"}>
                {TABLE_COLUMNS.map(([key]) => (
                  <td
                    key={key}
                    className={`${key === "name" ? "sticky" : ""} ${CALCULATED_COLUMNS.has(key) ? "calc" : ""}`}
                  >
                    {key === "name" ? (
                      <span className="campaign-cell">
                        <span className="chevron">›</span>
                        <span className={`camp-dot ${row.clientKey}`} />
                        <span>{level === "ad" ? row.keyword : row.name}</span>
                        {level === "ad" && <span className="ad-id">{clientName(row.clientKey)}</span>}
                      </span>
                    ) : (
                      valueForCell(row, key)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total-row">
              {TABLE_COLUMNS.map(([key]) => (
                <td
                  key={key}
                  className={`${key === "name" ? "sticky" : ""} ${CALCULATED_COLUMNS.has(key) ? "calc" : ""}`}
                >
                  {key === "name" ? "TOTAL" : valueForCell(total, key)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineChart({
  kind,
  big,
  delta,
  labels,
}: {
  kind: "roas" | "dm";
  big: string;
  delta: string;
  labels: string[];
}) {
  const roasPoints = [24, 20, 28, 108, 92, 65, 55, 61, 74, 91];
  const dmPoints = [86, 87, 88, 82, 77, 81, 85, 86, 85, 83];
  const points = kind === "roas" ? roasPoints : dmPoints;
  const width = 720;
  const height = 260;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const path = points
    .map((point, index) => {
      const x = 54 + (index / (points.length - 1)) * 624;
      const y = 205 - ((point - min) / Math.max(max - min, 1)) * 150;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="panel chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{kind === "roas" ? "ROAS" : "Cost per DM"}</div>
          <div className="chart-subtitle">
            <span className="chart-big">{big}</span>
            <span className="chart-delta pos">{delta}</span>
            <span className="chart-sub-label">7-day avg {kind === "dm" ? "overall" : ""}</span>
          </div>
        </div>
        <div className="chart-controls">
          <div className="mini-tabs">
            <button className="active">{kind === "roas" ? "Collected" : "Overall"}</button>
            <button>{kind === "roas" ? "Contracted" : "By keyword"}</button>
          </div>
          <div className="client-picker">
            <button className="active">All</button>
            <button>Tyson</button>
            <button>Keith</button>
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-svg">
        {[56, 104, 152, 200].map((y) => (
          <line key={y} x1="54" x2="678" y1={y} y2={y} />
        ))}
        {(kind === "roas" ? ["$29.5k", "$19.5k", "$9.7k", "$0k"] : ["$6.56", "$4.33", "$2.17", "$0.00"]).map((label, index) => (
          <text key={label} x="10" y={58 + index * 48}>{label}</text>
        ))}
        <path d={`${path} L 678 206 L 54 206 Z`} className="area" />
        <path d={path} className={kind === "dm" ? "blue-line" : ""} />
        {labels.map((label, index) => (
          <text key={label} x={54 + (index / (labels.length - 1)) * 624} y="235" className="axis-label">
            {label}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className={kind === "dm" ? "blue" : "gold"} />{kind === "dm" ? "Cost per DM" : "Revenue"}</span>
        {kind === "roas" && <span><i />Ad spend</span>}
        <em>{kind === "dm" ? "Lower is better" : "Hover to see daily ROAS"}</em>
      </div>
    </div>
  );
}

function AdRoasChart({ payload }: { payload: AdsTrackerPayload | null }) {
  const live = payload && !payload.mock && payload.adRoas.length
    ? payload.adRoas.slice(0, 6).map((item) => ({
        label: item.label,
        clientKey: item.clientKey,
        roi: item.collectedRoi,
        revenue: item.collectedRevenue,
      }))
    : DEFAULT_ROAS_BARS;
  const max = Math.max(...live.map((item) => item.roi), 1);

  return (
    <div className="panel chart-card ads-roas-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">Ad ROAS</div>
          <div className="chart-muted">Most profitable ads</div>
        </div>
        <div className="chart-controls">
          <div className="mini-tabs"><button className="active">Top</button><button>All ads</button></div>
          <div className="client-picker"><button className="active">All</button><button>Tyson</button><button>Keith</button></div>
        </div>
      </div>
      <div className="metric-tabs"><button className="active">Collected</button><button>Contracted</button></div>
      <div className="bar-chart">
        {live.map((item) => (
          <div className="bar-col" key={`${item.clientKey}-${item.label}`}>
            <strong>{item.roi.toFixed(1)}x</strong>
            <span>{money(item.revenue / 1000, 1).replace(".0", "")}k</span>
            <div className="bar-wrap">
              <i
                className={item.clientKey}
                style={{ height: `${Math.max(14, (item.roi / max) * 100)}%` }}
              />
            </div>
            <b>{item.label}</b>
            <em>{clientName(item.clientKey)}</em>
          </div>
        ))}
      </div>
      <div className="chart-legend ad-legend">
        <span><i className="gold" />Tyson</span>
        <span><i className="blue" />Keith</span>
        <em>Bars sized by ROAS</em>
      </div>
    </div>
  );
}

function KeywordLog() {
  return (
    <div className="keyword-stack">
      <div className="panel log-card">
        <div className="section-label">Log Keywords</div>
        <div className="log-select-row">
          <button>Tyson — Spring Shred <ChevronDown size={14} /></button>
          <button>Amara <ChevronDown size={14} /></button>
        </div>
        <div className="bucket-box">
          <div className="bucket-head">
            <span>Messages <em>0/1 filled</em></span>
            <X size={13} />
          </div>
          <div className="bucket-row">
            <span>01</span>
            <input placeholder="KEYWORD" />
            <input placeholder="0" />
            <em>messages</em>
          </div>
          <button className="add-row">+ Add row</button>
        </div>
        <div className="stage-picker">
          <span>Add stage</span>
          <button>+ Booked calls</button>
          <button>+ New clients</button>
          <button>+ Contracted $</button>
          <button>+ Collected $</button>
        </div>
        <button className="log-submit" disabled>Log entry</button>
      </div>
      <div>
        <div className="section-head action-title">
          <span>Actions</span>
          <em>Manual</em>
        </div>
        <div className="panel actions-panel">
          <button><Plus size={14} />New campaign</button>
          <button><Flag size={14} />Finish campaign</button>
          <button><Upload size={14} />Import keyword data</button>
          <button><Download size={14} />Export CSV</button>
        </div>
      </div>
    </div>
  );
}

function RecentEntries({ payload }: { payload: AdsTrackerPayload | null }) {
  const liveEntries =
    payload && !payload.mock && payload.recentEvents.length
      ? payload.recentEvents.slice(0, 8).map((event) => [
          new Date(event.eventAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
          event.setter || "Auto",
          clientName(event.clientKey),
          event.keyword,
          event.source === "manychat" ? "Messages" : "Booked calls",
          "1",
        ])
      : RECENT_ENTRIES;

  return (
    <div className="recent panel">
      <div className="recent-head">
        <span>▾</span>
        Recent Keyword Entries
        <em>{liveEntries.length} logs · last 48h</em>
      </div>
      <table className="recent-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Setter</th>
            <th>Campaign</th>
            <th>Keyword</th>
            <th>Bucket</th>
            <th>Value</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {liveEntries.map(([time, setter, campaign, keyword, bucket, value]) => (
            <tr key={`${time}-${keyword}-${bucket}`}>
              <td>{time}</td>
              <td>{setter}</td>
              <td>{campaign}</td>
              <td><span className="kw-tag">{keyword}</span></td>
              <td>{bucket}</td>
              <td>{value}</td>
              <td><button>Edit</button><button className="delete">Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdsTrackerPage() {
  const [account, setAccount] = useState<AccountFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [level, setLevel] = useState<LevelFilter>("campaign");
  const [dateTo, setDateTo] = useState(dateInNewYork());
  const [dateFrom, setDateFrom] = useState(() => shiftDate(dateInNewYork(), -6));
  const [payload, setPayload] = useState<AdsTrackerPayload | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ account, status, level, dateFrom, dateTo });
    fetch(`/api/ads-tracker?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => setPayload(data))
      .catch((error) => {
        if (error.name !== "AbortError") console.error("[ads-tracker] fetch failed", error);
      });
    return () => controller.abort();
  }, [account, status, level, dateFrom, dateTo]);

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch("/api/sync/ads-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const params = new URLSearchParams({ account, status, level, dateFrom, dateTo });
      const res = await fetch(`/api/ads-tracker?${params}`);
      setPayload(await res.json());
    } finally {
      setSyncing(false);
    }
  }

  const tableRows = useMemo(() => {
    const liveRows = payload && !payload.mock && payload.rows.length ? payload.rows.map(fromApiRow) : [];
    if (liveRows.length) return level === "campaign" ? aggregateCampaignRows(liveRows) : liveRows;
    return level === "campaign" ? DEFAULT_CAMPAIGNS : DEFAULT_AD_ROWS;
  }, [level, payload]);

  return (
    <main className="ads-tracker-page">
      <div className="page-head">
        <h1>Ads Tracker</h1>
        <button className="sync-pill" onClick={syncNow} disabled={syncing}>
          <RefreshCw size={12} className={syncing ? "spin" : ""} />
          {syncing ? "Syncing" : "Last synced 6m ago"}
        </button>
      </div>

      <div className="filter-bar">
        <SelectFilter label="Account" value={account} options={ACCOUNT_OPTIONS} onChange={setAccount} />
        <Segmented value={status} onChange={setStatus} />
        <div className="filter-divider" />
        <DateDropdown
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <div className="filter-spacer" />
        <button className="filter-btn search-btn"><Search size={14} />Search</button>
      </div>

      <section className="section campaign-section">
        <div className="section-head">
          <span>Campaign Performance</span>
        </div>
        <CampaignTable rows={tableRows} level={level} onLevelChange={setLevel} />
      </section>

      <section className="grid-charts">
        <LineChart
          kind="roas"
          big="19.80x"
          delta="▲ 16.59x"
          labels={["Apr 16", "Apr 17", "Apr 18", "Apr 19", "Apr 20", "Apr 21", "Apr 22"]}
        />
        <AdRoasChart payload={payload} />
      </section>

      <section className="grid-bottom">
        <LineChart
          kind="dm"
          big="$5.39"
          delta="▼ $0.31"
          labels={["Apr 16", "Apr 17", "Apr 18", "Apr 19", "Apr 20", "Apr 21", "Apr 22"]}
        />
        <KeywordLog />
      </section>

      <RecentEntries payload={payload} />
    </main>
  );
}
