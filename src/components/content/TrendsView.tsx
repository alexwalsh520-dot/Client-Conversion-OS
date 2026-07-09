"use client";

/**
 * TrendsView — mobile-first Trends page of smooth curvy line charts for a
 * fitness creator's ORGANIC content. Reads the GET /api/content/studio payload.
 * No data fetching happens here; everything is derived from props.
 */

import type { JSX } from "react";
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Post = {
  id: string;
  taken_at: string | null;
  likes: number;
  comments: number;
  views: number;
  score: number | null;
};

type Snapshot = { date: string; followers: number };

// Theme colors (kept as named constants so the intent is obvious).
const GOLD = "#c9a96e";
const GREEN = "#8ce0ab";
const GRID = "#26262b";
const SCATTER_DOT = "rgba(231,231,234,0.28)";
const TOOLTIP_BG = "#111114";
const TOOLTIP_BORDER = "#26262b";
const TOOLTIP_TEXT = "#e7e7ea";

const CHART_HEIGHT = 220;

function dayKey(s: string | null): string {
  return s ? s.slice(0, 10) : "";
}

function inRange(key: string, from: string, to: string): boolean {
  return key !== "" && key >= from && key <= to;
}

function labelForDate(s: string): string {
  // s is a YYYY-MM-DD key; render a short dim label.
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function roundNum(n: number): number {
  return Math.round(Number.isFinite(n) ? n : 0);
}

// Simple trailing rolling average over the last `window` values.
function rollingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      sum += values[j];
      count += 1;
    }
    out.push(count > 0 ? sum / count : 0);
  }
  return out;
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-primary)",
  borderRadius: 14,
  padding: 16,
  width: "100%",
  boxSizing: "border-box",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "var(--text-primary)",
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  margin: "4px 0 12px",
};

const emptyNoteStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  margin: "6px 0 2px",
};

const axisTick = { fill: "var(--text-muted)", fontSize: 11 };

const tooltipContentStyle: React.CSSProperties = {
  background: TOOLTIP_BG,
  border: `1px solid ${TOOLTIP_BORDER}`,
  borderRadius: 8,
  color: TOOLTIP_TEXT,
  fontSize: 12,
};

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      <p style={subtitleStyle}>{subtitle}</p>
      {children}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p style={emptyNoteStyle}>{text}</p>;
}

// Shared tooltip so numbers always render rounded and clean.
function roundTooltipFormatter(value: number | string | undefined): [string, string] {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return [String(roundNum(n)), ""];
}

export default function TrendsView({
  posts,
  snapshots,
  range,
}: {
  posts: Post[];
  snapshots: Snapshot[];
  range: { from: string; to: string };
}): JSX.Element {
  const { from, to } = range;

  // Followers series: filtered snapshots sorted by date.
  const followerData = useMemo(() => {
    return snapshots
      .filter((s) => inRange(dayKey(s.date), from, to))
      .map((s) => ({ key: dayKey(s.date), followers: roundNum(s.followers) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [snapshots, from, to]);

  // Filtered posts sorted ascending by taken_at.
  const sortedPosts = useMemo(() => {
    return posts
      .filter((p) => inRange(dayKey(p.taken_at), from, to))
      .slice()
      .sort((a, b) => dayKey(a.taken_at).localeCompare(dayKey(b.taken_at)));
  }, [posts, from, to]);

  // Per-metric series with a 7-post rolling average line.
  const likesData = useMemo(() => {
    const raw = sortedPosts.map((p) => roundNum(p.likes));
    const avg = rollingAverage(raw, 7);
    return sortedPosts.map((p, i) => ({
      key: dayKey(p.taken_at),
      value: raw[i],
      avg: roundNum(avg[i]),
    }));
  }, [sortedPosts]);

  const commentsData = useMemo(() => {
    const raw = sortedPosts.map((p) => roundNum(p.comments));
    const avg = rollingAverage(raw, 7);
    return sortedPosts.map((p, i) => ({
      key: dayKey(p.taken_at),
      value: raw[i],
      avg: roundNum(avg[i]),
    }));
  }, [sortedPosts]);

  const viewsData = useMemo(() => {
    const raw = sortedPosts.map((p) => roundNum(p.views));
    const avg = rollingAverage(raw, 7);
    return sortedPosts.map((p, i) => ({
      key: dayKey(p.taken_at),
      value: raw[i],
      avg: roundNum(avg[i]),
    }));
  }, [sortedPosts]);

  const allViewsZero = useMemo(
    () => sortedPosts.length > 0 && sortedPosts.every((p) => p.views === 0),
    [sortedPosts]
  );

  // Score rolling average over posts that have a score.
  const scoreData = useMemo(() => {
    const scored = sortedPosts.filter((p) => p.score != null);
    const raw = scored.map((p) => p.score as number);
    const avg = rollingAverage(raw, 7);
    return scored.map((p, i) => ({
      key: dayKey(p.taken_at),
      avg: Math.round(avg[i] * 10) / 10,
    }));
  }, [sortedPosts]);

  // Thin out X labels when the axis would get crowded on a phone.
  const tickInterval = (count: number): number =>
    count > 6 ? Math.ceil(count / 6) - 1 : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
      }}
    >
      {/* 1. Followers */}
      <ChartCard title="Followers" subtitle="How your audience is growing over time.">
        {followerData.length < 2 ? (
          <EmptyNote text="Your follower curve starts filling in from today." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart
              data={followerData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="fillFollowers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="key"
                tick={axisTick}
                tickFormatter={labelForDate}
                interval={tickInterval(followerData.length)}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l) => labelForDate(String(l))}
                formatter={(v) => [String(roundNum(Number(v))), "Followers"]}
              />
              <Area
                type="monotone"
                dataKey="followers"
                stroke="none"
                fill="url(#fillFollowers)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="followers"
                stroke={GOLD}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: GOLD }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Likes per post */}
      <ChartCard
        title="Likes per post"
        subtitle="Each post plus your 7-post rolling average."
      >
        {likesData.length === 0 ? (
          <EmptyNote text="Likes show up here once your posts sync." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart
              data={likesData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="fillLikes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="key"
                tick={axisTick}
                tickFormatter={labelForDate}
                interval={tickInterval(likesData.length)}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l) => labelForDate(String(l))}
                formatter={roundTooltipFormatter}
              />
              <Scatter dataKey="value" fill={SCATTER_DOT} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="none"
                fill="url(#fillLikes)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name="7-post average"
                stroke={GOLD}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: GOLD }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Comments per post */}
      <ChartCard
        title="Comments per post"
        subtitle="Each post plus your 7-post rolling average."
      >
        {commentsData.length === 0 ? (
          <EmptyNote text="Comments show up here once your posts sync." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart
              data={commentsData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="fillComments" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="key"
                tick={axisTick}
                tickFormatter={labelForDate}
                interval={tickInterval(commentsData.length)}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l) => labelForDate(String(l))}
                formatter={roundTooltipFormatter}
              />
              <Scatter dataKey="value" fill={SCATTER_DOT} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="none"
                fill="url(#fillComments)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name="7-post average"
                stroke={GOLD}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: GOLD }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4. Views per post */}
      <ChartCard
        title="Views per post"
        subtitle="Each post plus your 7-post rolling average."
      >
        {viewsData.length === 0 ? (
          <EmptyNote text="Views fill in as your posts sync." />
        ) : allViewsZero ? (
          <EmptyNote text="Views fill in as your posts sync." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart
              data={viewsData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GOLD} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="key"
                tick={axisTick}
                tickFormatter={labelForDate}
                interval={tickInterval(viewsData.length)}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l) => labelForDate(String(l))}
                formatter={roundTooltipFormatter}
              />
              <Scatter dataKey="value" fill={SCATTER_DOT} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="none"
                fill="url(#fillViews)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name="7-post average"
                stroke={GOLD}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: GOLD }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 5. Average score over time */}
      <ChartCard
        title="Average score over time"
        subtitle="Is your content getting more on target."
      >
        {scoreData.length === 0 ? (
          <EmptyNote text="Scores show up here once your posts get graded." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart
              data={scoreData}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="key"
                tick={axisTick}
                tickFormatter={labelForDate}
                interval={tickInterval(scoreData.length)}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l) => labelForDate(String(l))}
                formatter={(v) => [String(v), "Avg score"]}
              />
              <Area
                type="monotone"
                dataKey="avg"
                stroke="none"
                fill="url(#fillScore)"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                stroke={GREEN}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: GREEN }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
