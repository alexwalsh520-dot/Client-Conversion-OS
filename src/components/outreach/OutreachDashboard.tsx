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

function MetricCard(props: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "email" | "dm" | "warning";
}) {
  const toneStyles = {
    default: {
      border: "1px solid var(--border-primary)",
      background: "rgba(255,255,255,0.03)",
    },
    email: {
      border: "1px solid rgba(201,169,110,0.22)",
      background: "rgba(201,169,110,0.08)",
    },
    dm: {
      border: "1px solid rgba(130,197,197,0.22)",
      background: "rgba(130,197,197,0.08)",
    },
    warning: {
      border: "1px solid rgba(217,142,142,0.22)",
      background: "rgba(217,142,142,0.08)",
    },
  } as const;

  return (
    <div
      style={{
        ...toneStyles[props.tone || "default"],
        borderRadius: 16,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 142,
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)" }}>
        {props.label}
      </div>
      <div style={{ fontSize: props.value.length > 14 ? 24 : 32, fontWeight: 700, letterSpacing: -0.8 }}>
        {props.value}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
        {props.detail}
      </div>
    </div>
  );
}

export default function OutreachDashboard() {
  const defaultRange = getPresetDates("mtd");
  const [preset, setPreset] = useState<OutreachRangePreset>("mtd");
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [timeZone, setTimeZone] = useState("UTC");
  const [data, setData] = useState<OutreachDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  const chartTitle = dmConnected ? "Messages sent per day" : "Emails sent per day";

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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              <MetricCard
                label="People emailed"
                value={fmtNumber(data.email.reachedInRange)}
                detail={`All time: ${fmtNumber(data.email.reachedAllTime)}`}
              />
              <MetricCard
                label="Emails sent"
                value={fmtNumber(data.email.messagesInRange)}
                detail="Includes follow-ups"
              />
              <MetricCard
                label="Email reply rate"
                value={fmtPercent(data.email.replyRateInRange)}
                detail={`${fmtNumber(data.email.repliesInRange)} replies`}
              />
              <MetricCard
                label="Interested replies"
                value={fmtPercent(data.email.interestedReplyRateInRange)}
                detail={`${fmtNumber(data.email.interestedRepliesInRange)} interested`}
              />
              {dmConnected && (
                <>
                  <MetricCard
                    label="People DM'd"
                    value={fmtNumber(data.dm.reachedInRange)}
                    detail={`All time: ${fmtNumber(data.dm.reachedAllTime)}`}
                    tone="dm"
                  />
                  <MetricCard
                    label="DMs sent"
                    value={fmtNumber(data.dm.messagesInRange)}
                    detail="Includes follow-ups"
                    tone="dm"
                  />
                  <MetricCard
                    label="DM reply rate"
                    value={fmtPercent(data.dm.replyRateInRange)}
                    detail={`${fmtNumber(data.dm.repliesInRange)} replies`}
                    tone="dm"
                  />
                  <MetricCard
                    label="Positive DM replies"
                    value={fmtPercent(data.dm.interestedReplyRateInRange)}
                    detail={`${fmtNumber(data.dm.interestedRepliesInRange)} positive`}
                    tone="dm"
                  />
                </>
              )}
            </div>

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
                {chartTitle}
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
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(12,12,16,0.96)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      color: "#f0f0f2",
                    }}
                  />
                  <Bar dataKey="emailMessages" name="Emails" fill="#c9a96e" radius={[4, 4, 0, 0]} />
                  {dmConnected && (
                    <Bar dataKey="dmMessages" name="DMs" fill="#82c5c5" radius={[4, 4, 0, 0]} />
                  )}
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
