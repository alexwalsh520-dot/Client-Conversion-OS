"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  RefreshCw,
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
  ["name", "Campaign / Date / Ad"],
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
  ["contractedRevenue", "Contracted rev"],
  ["callClosingRate", "Call close rate"],
  ["messagesConversionRate", "Msg -> call"],
  ["collectedRevenue", "Collected rev"],
  ["costPerNewClient", "Cost / client"],
  ["contractedRoi", "Contracted ROI"],
  ["collectedRoi", "Collected ROI"],
] as const;

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

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function fmtUsd(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtNum(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

function fmtRoi(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(2)}x`;
}

function clientLabel(clientKey: string) {
  if (clientKey === "tyson") return "Tyson";
  if (clientKey === "keith") return "Keith";
  return clientKey;
}

function metricClass(key: string, row: AdsTrackerRow) {
  if (key === "collectedRevenue" || key === "newClients" || key === "messages") return "pos";
  if (key === "contractedRevenue" || key === "contractedRoi") return "gold";
  if (key === "collectedRoi") return row.collectedRoi >= 2 ? "pos" : "neg";
  if (key === "costPerNewClient" || key === "costPerBookedCall") return "dim";
  return "";
}

function formatCell(key: (typeof TABLE_COLUMNS)[number][0], row: AdsTrackerRow) {
  switch (key) {
    case "name":
      return row.name;
    case "adSpend":
    case "contractedRevenue":
    case "collectedRevenue":
      return fmtUsd(row[key]);
    case "cpm":
    case "cpc":
    case "costPerMessage":
    case "costPerBookedCall":
    case "costPerNewClient":
      return fmtUsd(row[key], 2);
    case "ctr":
    case "callClosingRate":
    case "messagesConversionRate":
      return fmtPct(row[key]);
    case "contractedRoi":
    case "collectedRoi":
      return fmtRoi(row[key]);
    default:
      return fmtNum(row[key]);
  }
}

function useClickAway<T extends HTMLElement>(onAway: () => void) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onAway();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
  const current = options.find((option) => option.id === value) || options[0];

  return (
    <div className="ads-filter" ref={ref}>
      <button className="ads-filter-btn" onClick={() => setOpen((next) => !next)}>
        <span>{label}</span>
        <strong>{current.label}</strong>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="ads-pop">
          {options.map((option) => (
            <button
              key={option.id}
              className={`ads-pop-item ${option.id === value ? "selected" : ""}`}
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

function DateRangeFilter({
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
      <button className="ads-filter-btn ads-date-btn" onClick={() => setOpen((next) => !next)}>
        <Calendar size={14} />
        <strong>{DATE_PRESETS.find((item) => item.id === preset)?.label || "Custom"}</strong>
        <span>
          {formatShortDate(dateFrom)} - {formatShortDate(dateTo)}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="ads-pop ads-date-pop">
          <div className="ads-date-presets">
            {DATE_PRESETS.map((item) => (
              <button
                key={item.id}
                className={`ads-pop-item ${item.id === preset ? "selected" : ""}`}
                onClick={() => applyPreset(item.id, item.days)}
              >
                {item.label}
                {item.id === preset && <Check size={12} />}
              </button>
            ))}
          </div>
          <div className="ads-calendar-pane">
            <div className="ads-calendar-head">April 2026</div>
            <div className="ads-calendar-grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                <span className="dow" key={`${day}-${index}`}>
                  {day}
                </span>
              ))}
              {Array.from({ length: 30 }, (_, index) => index + 1).map((day) => (
                <button
                  className={`day ${day >= 16 && day <= 22 ? "range" : ""} ${day === 16 || day === 22 ? "endpoint" : ""}`}
                  key={day}
                >
                  {day}
                </button>
              ))}
            </div>
            <div className="ads-date-foot">
              <span>America/New_York reporting window</span>
              <button onClick={() => setOpen(false)}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Segment({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}) {
  return (
    <div className="ads-segment">
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.id}
          className={option.id === value ? "active" : ""}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
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
  const total = useMemo(() => {
    const spend = rows.reduce((sum, row) => sum + row.adSpend, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const linkClicks = rows.reduce((sum, row) => sum + row.linkClicks, 0);
    const messages = rows.reduce((sum, row) => sum + row.messages, 0);
    const bookedCalls = rows.reduce((sum, row) => sum + row.bookedCalls, 0);
    const newClients = rows.reduce((sum, row) => sum + row.newClients, 0);
    const contractedRevenue = rows.reduce((sum, row) => sum + row.contractedRevenue, 0);
    const collectedRevenue = rows.reduce((sum, row) => sum + row.collectedRevenue, 0);

    return {
      id: "total",
      clientKey: "all",
      name: "TOTAL",
      keyword: "TOTAL",
      dateLabel: "",
      adSpend: spend,
      impressions,
      linkClicks,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
      cpc: linkClicks > 0 ? spend / linkClicks : 0,
      messages,
      costPerMessage: messages > 0 ? spend / messages : null,
      bookedCalls,
      costPerBookedCall: bookedCalls > 0 ? spend / bookedCalls : null,
      newClients,
      contractedRevenue,
      callClosingRate: bookedCalls > 0 ? (newClients / bookedCalls) * 100 : 0,
      messagesConversionRate: messages > 0 ? (bookedCalls / messages) * 100 : 0,
      collectedRevenue,
      costPerNewClient: newClients > 0 ? spend / newClients : null,
      contractedRoi: spend > 0 ? contractedRevenue / spend : 0,
      collectedRoi: spend > 0 ? collectedRevenue / spend : 0,
      status: "active" as const,
    };
  }, [rows]);

  return (
    <div className="ads-panel">
      <div className="ads-table-toolbar">
        <div className="ads-table-toggle">
          <button
            className={level === "campaign" ? "active" : ""}
            onClick={() => onLevelChange("campaign")}
          >
            Campaign level
          </button>
          <button
            className={level === "ad" ? "active" : ""}
            onClick={() => onLevelChange("ad")}
          >
            Ad level
            <span>{rows.length}</span>
          </button>
        </div>
      </div>
      <div className="ads-table-scroll">
        <table className="ads-table">
          <thead>
            <tr>
              {TABLE_COLUMNS.map(([key, label]) => (
                <th key={key} className={key === "name" ? "sticky" : ""}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {TABLE_COLUMNS.map(([key]) => (
                  <td key={key} className={`${key === "name" ? "sticky" : ""} ${metricClass(key, row)}`}>
                    {key === "name" ? (
                      <span className="campaign-cell">
                        <span className={`client-dot ${row.clientKey}`} />
                        <span>{level === "ad" ? row.keyword : clientLabel(row.clientKey)}</span>
                        <em>{level === "ad" ? clientLabel(row.clientKey) : row.keyword}</em>
                      </span>
                    ) : (
                      formatCell(key, row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total-row">
              {TABLE_COLUMNS.map(([key]) => (
                <td key={key} className={`${key === "name" ? "sticky" : ""} ${metricClass(key, total)}`}>
                  {key === "name" ? "TOTAL" : formatCell(key, total)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoasLine({ payload }: { payload: AdsTrackerPayload }) {
  const points = payload.trend.length
    ? payload.trend
    : [{ label: "No data", adSpend: 1, collectedRevenue: 1, collectedRoi: 0 }];
  const max = Math.max(...points.map((point) => point.collectedRevenue), 1);
  const width = 720;
  const height = 220;
  const path = points
    .map((point, index) => {
      const x = 52 + (index / Math.max(points.length - 1, 1)) * (width - 80);
      const y = 180 - (point.collectedRevenue / max) * 130;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="ads-chart-card">
      <div className="chart-head">
        <div>
          <span>ROAS</span>
          <strong>{fmtRoi(payload.summary.collectedRoi)}</strong>
        </div>
        <div className="chart-tabs">
          <button className="active">Collected</button>
          <button>Contracted</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart">
        {[40, 85, 130, 175].map((y) => (
          <line key={y} x1="52" x2="690" y1={y} y2={y} />
        ))}
        <path d={path} />
        <path d={`${path} L 690 190 L 52 190 Z`} className="area" />
        {points.map((point, index) => (
          <text key={point.label} x={52 + (index / Math.max(points.length - 1, 1)) * 638} y="210">
            {point.label}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="gold-line" />
          Revenue
        </span>
        <span>
          <i />
          Ad spend
        </span>
      </div>
    </div>
  );
}

function AdRoasBars({ payload }: { payload: AdsTrackerPayload }) {
  const items = payload.adRoas.slice(0, 6);
  const max = Math.max(...items.map((item) => item.collectedRoi), 1);

  return (
    <div className="ads-chart-card">
      <div className="chart-head">
        <div>
          <span>Ad ROAS</span>
          <strong>Most profitable ads</strong>
        </div>
        <div className="chart-tabs">
          <button className="active">Top</button>
          <button>All ads</button>
        </div>
      </div>
      <div className="bar-chart">
        {items.map((item) => (
          <div className="bar-item" key={item.id}>
            <strong>{fmtRoi(item.collectedRoi)}</strong>
            <span>{fmtUsd(item.collectedRevenue / 1000, 1).replace(".0", "")}k</span>
            <div className="bar-rail">
              <i
                className={item.clientKey}
                style={{ height: `${Math.max(10, (item.collectedRoi / max) * 100)}%` }}
              />
            </div>
            <b>{item.label}</b>
            <em>{clientLabel(item.clientKey)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentEntries({ events }: { events: AdsTrackerPayload["recentEvents"] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="recent-wrap">
      <button className="recent-trigger" onClick={() => setOpen((next) => !next)}>
        <span>{open ? "▾" : "▸"}</span>
        Recent automated keyword entries
        <em>{events.length} logs</em>
      </button>
      {open && (
        <div className="recent-table-wrap">
          <table className="recent-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Account</th>
                <th>Keyword</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${event.eventAt}-${index}`}>
                  <td>{new Date(event.eventAt).toLocaleString()}</td>
                  <td>{event.source}</td>
                  <td>{clientLabel(event.clientKey)}</td>
                  <td>
                    <span className="kw-tag">{event.keyword}</span>
                  </td>
                  <td>{event.name || "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ account, status, level, dateFrom, dateTo });
    fetch(`/api/ads-tracker?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => setPayload(data))
      .catch((error) => {
        if (error.name !== "AbortError") console.error("[ads-tracker] fetch failed", error);
      })
      .finally(() => setLoading(false));
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

  const rows = payload?.rows || [];

  return (
    <main className="ads-tracker-page">
      <header className="ads-page-head">
        <div>
          <h1>Ads Tracker</h1>
        </div>
        <button className="sync-pill" onClick={syncNow} disabled={syncing}>
          <RefreshCw size={12} className={syncing ? "spin" : ""} />
          {syncing ? "Syncing" : "Sync Now"}
        </button>
      </header>

      <section className="ads-filter-bar">
        <SelectFilter label="Account" value={account} options={ACCOUNT_OPTIONS} onChange={setAccount} />
        <Segment value={status} onChange={setStatus} />
        <span className="filter-divider" />
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        <div className="filter-spacer" />
      </section>

      <section className="ads-section">
        <div className="section-head">
          <span>Campaign Performance</span>
          {payload?.mock && <em>mock data shown until live tables are synced</em>}
        </div>
        <CampaignTable rows={rows} level={level} onLevelChange={setLevel} />
        {loading && <div className="ads-loading">Loading ads tracker...</div>}
      </section>

      {payload && (
        <>
          <section className="ads-chart-grid">
            <RoasLine payload={payload} />
            <AdRoasBars payload={payload} />
          </section>

          <section className="ads-utility-grid">
            <div className="ads-action-panel">
              <div className="section-head">
                <span>Controls</span>
              </div>
              <div className="action-row">
                <button>New campaign</button>
                <button>Finish campaign</button>
                <button onClick={syncNow}>Sync data</button>
              </div>
            </div>
            <div className="ads-action-panel">
              <div className="section-head">
                <span>Attribution Health</span>
              </div>
              <div className="health-grid">
                <div>
                  <span>Messages</span>
                  <strong>{fmtNum(payload.summary.messages)}</strong>
                </div>
                <div>
                  <span>Booked</span>
                  <strong>{fmtNum(payload.summary.bookedCalls)}</strong>
                </div>
                <div>
                  <span>Clients</span>
                  <strong>{fmtNum(payload.summary.newClients)}</strong>
                </div>
              </div>
            </div>
          </section>

          <RecentEntries events={payload.recentEvents} />
        </>
      )}
    </main>
  );
}
