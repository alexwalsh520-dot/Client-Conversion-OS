"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  AlertCircle,
  CalendarRange,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
import type {
  OutreachDashboardResponse,
  OutreachRangePreset,
} from "@/lib/outreach-dashboard-types";

type ChartKey = "emailMessages" | "emailReplies" | "dmMessages" | "dmReplies";

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetDates(preset: OutreachRangePreset) {
  const today = new Date();
  const endDate = formatLocalDate(today);

  if (preset === "wtd") {
    const start = new Date(today);
    const day = (today.getDay() + 6) % 7;
    start.setDate(today.getDate() - day);
    return {
      startDate: formatLocalDate(start),
      endDate,
    };
  }

  if (preset === "custom") {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return {
      startDate: formatLocalDate(start),
      endDate,
    };
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    startDate: formatLocalDate(monthStart),
    endDate,
  };
}

function formatDateLabel(dateValue: string) {
  return new Date(`${dateValue}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const CHANNEL_COLORS = {
  email: "#c9a96e",
  dm: "#82c5c5",
} as const;

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  channel: "email" | "dm";
  chartKey: ChartKey;
  selectedKey: ChartKey;
  disabled?: boolean;
  onSelect: (key: ChartKey) => void;
}

function MetricCard({
  label,
  value,
  detail,
  channel,
  chartKey,
  selectedKey,
  disabled = false,
  onSelect,
}: MetricCardProps) {
  const active = selectedKey === chartKey;
  const accent = CHANNEL_COLORS[channel];

  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(chartKey)}
      disabled={disabled}
      style={{
        textAlign: "left",
        border: `1px solid ${active ? accent : "var(--border-primary)"}`,
        background: active
          ? channel === "email"
            ? "rgba(201,169,110,0.12)"
            : "rgba(130,197,197,0.12)"
          : "rgba(255,255,255,0.03)",
        borderRadius: 14,
        padding: 16,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 120,
        transition: "all 0.15s ease",
        boxShadow: active ? `0 0 0 1px ${accent} inset` : "none",
        color: "inherit",
        font: "inherit",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: active ? accent : "var(--text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: value.length > 10 ? 24 : 30, fontWeight: 700, letterSpacing: -0.6 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
        {detail}
      </div>
    </button>
  );
}

const CHART_TITLES: Record<ChartKey, string> = {
  emailMessages: "Emails sent per day",
  emailReplies: "Email replies per day",
  dmMessages: "DMs sent per day",
  dmReplies: "DM replies per day",
};

export default function OutreachDashboard() {
  const defaultRange = getPresetDates("mtd");
  const [preset, setPreset] = useState<OutreachRangePreset>("mtd");
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [timeZone, setTimeZone] = useState("UTC");
  const [data, setData] = useState<OutreachDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState<ChartKey>("emailMessages");

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimeZone(zone);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          preset,
          startDate,
          endDate,
          timeZone,
        });
        const res = await fetch(`/api/outreach/dashboard?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || "Failed to load outreach dashboard");
        }
        setData(body);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load outreach dashboard");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [preset, startDate, endDate, timeZone]);

  const rangeLabel = useMemo(() => {
    return `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`;
  }, [startDate, endDate]);

  const generatedAtLabel = useMemo(() => {
    if (!data?.generatedAt) return "";
    return new Date(data.generatedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [data?.generatedAt]);

  const setPresetRange = (nextPreset: OutreachRangePreset) => {
    setPreset(nextPreset);
    if (nextPreset !== "custom") {
      const nextRange = getPresetDates(nextPreset);
      setStartDate(nextRange.startDate);
      setEndDate(nextRange.endDate);
    }
  };

  const dmConnected = Boolean(data?.sources.dm.connected);
  const selectedChannel: "email" | "dm" = selectedKey.startsWith("dm") ? "dm" : "email";
  const chartColor = CHANNEL_COLORS[selectedChannel];

  return (
    <div className="section">
      <div
        className="glass-static"
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Header: left = title + range, right = date controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>
              Outreach
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
              <CalendarRange size={12} />
              {rangeLabel}
              {generatedAtLabel && (
                <>
                  <span style={{ color: "var(--border-hover)" }}>•</span>
                  <RefreshCw size={12} />
                  Updated {generatedAtLabel}
                </>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: 280,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { id: "mtd", label: "Month to Date" },
                { id: "wtd", label: "Week to Date" },
                { id: "custom", label: "Custom" },
              ].map((option) => {
                const active = preset === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPresetRange(option.id as OutreachRangePreset)}
                    style={{
                      border: "1px solid",
                      borderColor: active ? "var(--accent)" : "var(--border-primary)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      padding: "8px 12px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                Start
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setPreset("custom");
                    setStartDate(e.target.value);
                  }}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13,
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                End
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => {
                    setPreset("custom");
                    setEndDate(e.target.value);
                  }}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border-primary)",
                    color: "var(--text-primary)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13,
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        {loading && (
          <div
            style={{
              padding: "28px 20px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              fontSize: 14,
              color: "var(--text-secondary)",
            }}
          >
            <Loader2 size={16} className="spin" />
            Loading outreach metrics...
          </div>
        )}

        {error && !loading && (
          <div
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: "var(--danger-soft)",
              color: "var(--danger)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
            }}
          >
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Email cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              <MetricCard
                label="People emailed"
                value={fmtNumber(data.email.reachedInRange)}
                detail={`All time: ${fmtNumber(data.email.reachedAllTime)}`}
                channel="email"
                chartKey="emailMessages"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
              <MetricCard
                label="Emails sent"
                value={fmtNumber(data.email.messagesInRange)}
                detail="Includes follow-ups"
                channel="email"
                chartKey="emailMessages"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
              <MetricCard
                label="Email reply rate"
                value={fmtPercent(data.email.replyRateInRange)}
                detail={`${fmtNumber(data.email.repliesInRange)} replies`}
                channel="email"
                chartKey="emailReplies"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
              <MetricCard
                label="Interested replies"
                value={fmtPercent(data.email.interestedReplyRateInRange)}
                detail={`${fmtNumber(data.email.interestedRepliesInRange)} interested`}
                channel="email"
                chartKey="emailReplies"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
            </div>

            {/* DM cards — always visible */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              <MetricCard
                label="People DM'd"
                value={dmConnected ? fmtNumber(data.dm.reachedInRange) : "—"}
                detail={dmConnected ? `All time: ${fmtNumber(data.dm.reachedAllTime)}` : "Not tracked yet"}
                channel="dm"
                chartKey="dmMessages"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                disabled={!dmConnected}
              />
              <MetricCard
                label="DMs sent"
                value={dmConnected ? fmtNumber(data.dm.messagesInRange) : "—"}
                detail={dmConnected ? "Includes follow-ups" : "Not tracked yet"}
                channel="dm"
                chartKey="dmMessages"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                disabled={!dmConnected}
              />
              <MetricCard
                label="DM reply rate"
                value={dmConnected ? fmtPercent(data.dm.replyRateInRange) : "—"}
                detail={dmConnected ? `${fmtNumber(data.dm.repliesInRange)} replies` : "Not tracked yet"}
                channel="dm"
                chartKey="dmReplies"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                disabled={!dmConnected}
              />
              <MetricCard
                label="Positive DM replies"
                value={dmConnected ? fmtPercent(data.dm.interestedReplyRateInRange) : "—"}
                detail={dmConnected ? `${fmtNumber(data.dm.interestedRepliesInRange)} positive` : "Not tracked yet"}
                channel="dm"
                chartKey="dmReplies"
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                disabled={!dmConnected}
              />
            </div>

            {/* Chart */}
            <div
              style={{
                border: "1px solid var(--border-primary)",
                borderRadius: 16,
                padding: 18,
                background: "rgba(255,255,255,0.02)",
                minHeight: 320,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
                {CHART_TITLES[selectedKey]}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#787884", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#787884", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(12,12,16,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      color: "#f0f0f2",
                    }}
                  />
                  <Bar dataKey={selectedKey} fill={chartColor} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {!dmConnected && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                DM tracking not connected. {data.sources.dm.description}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
