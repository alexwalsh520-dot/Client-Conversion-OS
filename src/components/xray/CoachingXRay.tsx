"use client";

import {
  coachPerformance,
  coachingFeedback,
  satisfactionTrend,
} from "@/lib/mock-data";
import { BENCHMARKS } from "@/lib/constants";
import ExpandableRow from "./ExpandableRow";
import {
  LineChart,
  Line,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function CoachingXRay() {
  const teamAvgRating =
    coachPerformance.reduce((s, c) => s + c.avgRating, 0) /
    coachPerformance.length;
  const teamAvgCompletion =
    coachPerformance.reduce((s, c) => s + c.completionRate, 0) /
    coachPerformance.length;
  const totalClients = coachPerformance.reduce(
    (s, c) => s + c.activeClients,
    0
  );

  // Sort coaches by a composite score (rating * 0.5 + completion * 0.5 scaled)
  const rankedCoaches = [...coachPerformance].sort((a, b) => {
    const scoreA = a.avgRating * 5 + a.completionRate;
    const scoreB = b.avgRating * 5 + b.completionRate;
    return scoreB - scoreA;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Team Overview */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 16,
          }}
        >
          Team Overview
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Total Clients
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {totalClients}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Avg Rating
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {teamAvgRating.toFixed(1)}
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                /10
              </span>
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Avg Completion
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color:
                  teamAvgCompletion >= BENCHMARKS.coachCompletionRate
                    ? "var(--success)"
                    : "var(--warning)",
                marginTop: 2,
              }}
            >
              {teamAvgCompletion.toFixed(0)}%
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Coaches
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              {coachPerformance.length}
            </div>
          </div>
        </div>
      </div>

      {/* Coach Leaderboard */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          Coach Leaderboard
        </div>
        {rankedCoaches.map((coach, i) => {
          const isFlagged =
            coach.avgRating < BENCHMARKS.coachMinRating ||
            coach.completionRate < BENCHMARKS.coachCompletionRate;
          const feedback = coachingFeedback.filter(
            (f) => f.coachName === coach.name
          );

          return (
            <ExpandableRow
              key={coach.name}
              title={`#${i + 1} ${coach.name}`}
              subtitle={`${coach.activeClients} clients · ${coach.source}`}
              badge={
                isFlagged
                  ? {
                      text: "NEEDS ATTENTION",
                      color: "var(--danger)",
                      bg: "var(--danger-soft)",
                    }
                  : {
                      text: `${coach.avgRating}/10`,
                      color: "var(--success)",
                      bg: "var(--success-soft)",
                    }
              }
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* Coach metrics */}
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Rating:{" "}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          coach.avgRating >= BENCHMARKS.coachMinRating
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {coach.avgRating}/10
                    </span>
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      NPS:{" "}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {coach.avgNPS}
                    </span>
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      Completion:{" "}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          coach.completionRate >= BENCHMARKS.coachCompletionRate
                            ? "var(--success)"
                            : "var(--danger)",
                      }}
                    >
                      {coach.completionRate}%
                    </span>
                  </div>
                </div>

                {/* Recent feedback */}
                {feedback.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Recent Feedback
                    </div>
                    {feedback.slice(0, 3).map((f, idx) => (
                      <div
                        key={idx}
                        className="glass-subtle"
                        style={{ padding: 12, borderRadius: 8 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-primary)",
                            }}
                          >
                            {f.name}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            {f.coachRating}/10
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: 13,
                            color: "var(--text-secondary)",
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          {f.feedback}
                        </p>
                        {f.wins && (
                          <p
                            style={{
                              fontSize: 12,
                              color: "var(--success)",
                              margin: "4px 0 0 0",
                              fontWeight: 500,
                            }}
                          >
                            Win: {f.wins}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ExpandableRow>
          );
        })}
      </div>

      {/* Satisfaction Trend */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 16,
          }}
        >
          Satisfaction Trend
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={satisfactionTrend}>
              <XAxis
                dataKey="week"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number | undefined) => [
                  `${(value ?? 0).toFixed(1)}/10`,
                  "Avg Rating",
                ]}
              />
              <Line
                type="monotone"
                dataKey="avgRating"
                stroke="var(--success)"
                strokeWidth={2}
                dot={{ fill: "var(--success)", r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
