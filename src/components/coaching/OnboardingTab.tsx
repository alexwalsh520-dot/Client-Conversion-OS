"use client";

import { useState, useEffect } from "react";
import { ExternalLink, UserPlus, Clock, CheckCircle, AlertTriangle, Calendar, UserX, RefreshCw } from "lucide-react";
import type { Client } from "@/lib/types";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  clientName: string;
  status: string;
}

interface Props {
  clients: Client[];
  onClientClick?: (clientName: string) => void;
}

export default function OnboardingTab({ clients, onClientClick }: Props) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  const [upcomingCalendarEvents, setUpcomingCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Fetch upcoming calendar events for the next 14 days
  useEffect(() => {
    const fetchUpcoming = async () => {
      setCalendarLoading(true);
      try {
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 14);
        const endStr = endDate.toISOString().split("T")[0];
        const res = await fetch(`/api/coaching/calendar?start=${today}&end=${endStr}`);
        if (res.ok) {
          const data = await res.json();
          setUpcomingCalendarEvents(data.events || []);
        }
      } catch (err) {
        console.error("Calendar fetch error:", err);
      } finally {
        setCalendarLoading(false);
      }
    };
    fetchUpcoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recently onboarded: clients with onboardingDate in last 14 days, or startDate if no onboardingDate
  const recentlyOnboarded = clients
    .filter((c) => {
      if (c.status !== "active") return false;
      // Prefer onboardingDate (Nicole-confirmed), fall back to startDate
      const dateToUse = c.onboardingDate || c.startDate;
      if (!dateToUse) return false;
      const diff = Math.ceil(
        (now.getTime() - new Date(dateToUse).getTime()) / (1000 * 60 * 60 * 24)
      );
      return diff >= 0 && diff <= 14;
    })
    .sort((a, b) => {
      const dateA = a.onboardingDate || a.startDate;
      const dateB = b.onboardingDate || b.startDate;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

  // Upcoming from calendar (not yet in client system or not yet onboarded)
  const upcomingFromCalendar = upcomingCalendarEvents.filter((evt) => {
    const eventDate = evt.start.split("T")[0];
    // Only show future events (today onwards)
    if (eventDate < today) return false;
    // Check if this client is already marked as onboarded
    const matchingClient = clients.find(
      (c) => c.name.toLowerCase() === evt.clientName.toLowerCase()
    );
    if (matchingClient?.onboardingStatus === "onboarded") return false;
    return true;
  });

  // Clients with future start dates but no calendar event (legacy upcoming)
  const upcomingFromTracker = clients
    .filter((c) => {
      if (c.status !== "active") return false;
      if (!c.startDate || c.startDate <= today) return false;
      if (c.onboardingStatus === "onboarded") return false;
      // Don't show if already in calendar events
      const inCalendar = upcomingCalendarEvents.some(
        (evt) => evt.clientName.toLowerCase() === c.name.toLowerCase()
      );
      return !inCalendar;
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  // No-shows and rescheduled
  const needsAttention = clients.filter(
    (c) => c.onboardingStatus === "no_show" || c.onboardingStatus === "rescheduled"
  );

  // All active sorted by start date (newest first)
  const allActive = clients.filter((c) => c.status === "active");

  const daysAgo = (date: string) => {
    const diff = Math.ceil((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return `${diff} days ago`;
  };

  const daysUntil = (date: string) => {
    const diff = Math.ceil((new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return `In ${diff} days`;
  };

  const formatTime = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    } catch {
      return "";
    }
  };

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 20 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Upcoming Onboardings</div>
          <div className="metric-card-value">
            {calendarLoading ? "..." : upcomingFromCalendar.length + upcomingFromTracker.length}
          </div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Recently Onboarded (14d)</div>
          <div className="metric-card-value">{recentlyOnboarded.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Active</div>
          <div className="metric-card-value">{allActive.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">
            {needsAttention.length > 0 ? "Needs Attention" : "Completed"}
          </div>
          <div className="metric-card-value" style={{ color: needsAttention.length > 0 ? "var(--warning)" : "var(--accent)" }}>
            {needsAttention.length > 0
              ? needsAttention.length
              : clients.filter((c) => c.status === "completed").length
            }
          </div>
        </div>
      </div>

      {/* Needs Attention (no-shows / rescheduled) */}
      {needsAttention.length > 0 && (
        <div className="section">
          <h2 className="section-title" style={{ color: "var(--warning)" }}>
            <AlertTriangle size={16} />
            Needs Attention
          </h2>
          {needsAttention.map((client) => (
            <div key={client.id || client.name} className="glass-static" style={{
              padding: 14, marginBottom: 10,
              borderLeft: `3px solid ${client.onboardingStatus === "no_show" ? "var(--danger)" : "var(--warning)"}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {client.onboardingStatus === "no_show" ? <UserX size={14} style={{ color: "var(--danger)" }} /> : <RefreshCw size={14} style={{ color: "var(--warning)" }} />}
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14, cursor: onClientClick ? "pointer" : "default" }} onClick={() => onClientClick?.(client.name)}>{client.name}</span>
                  <span style={{
                    fontSize: 11, padding: "2px 6px", borderRadius: 4,
                    background: client.onboardingStatus === "no_show" ? "rgba(217, 142, 142, 0.2)" : "rgba(201, 169, 110, 0.2)",
                    color: client.onboardingStatus === "no_show" ? "var(--danger)" : "var(--warning)",
                  }}>
                    {client.onboardingStatus === "no_show" ? "No-Show" : "Rescheduled"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                <span>Coach: <strong>{client.coachName}</strong></span>
                <span>Program: {client.program}</span>
                <span>Start: {client.startDate}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming Onboardings from Calendar */}
      {(upcomingFromCalendar.length > 0 || upcomingFromTracker.length > 0) && (
        <div className="section">
          <h2 className="section-title">
            <Clock size={16} />
            Upcoming Onboardings
            {upcomingFromCalendar.length > 0 && (
              <span style={{ fontSize: 11, marginLeft: 8, color: "var(--text-muted)", fontWeight: 400, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Calendar size={11} /> from Nicole&apos;s calendar
              </span>
            )}
          </h2>

          {/* Calendar-based upcoming */}
          {upcomingFromCalendar.map((evt) => {
            const eventDate = evt.start.split("T")[0];
            const matchingClient = clients.find(
              (c) => c.name.toLowerCase() === evt.clientName.toLowerCase()
            );
            return (
              <div key={evt.id} className="glass-static" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{evt.clientName}</span>
                    {matchingClient?.email && (
                      <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 10 }}>{matchingClient.email}</span>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: "var(--warning)", fontWeight: 600, fontSize: 13 }}>
                      {daysUntil(eventDate)}
                    </span>
                    {formatTime(evt.start) && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatTime(evt.start)} EST</div>
                    )}
                  </div>
                </div>
                {matchingClient && (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    <span>Coach: <strong>{matchingClient.coachName}</strong></span>
                    <span>Program: {matchingClient.program}</span>
                    <span>Offer: {matchingClient.offer}</span>
                    {matchingClient.amountPaid > 0 && <span>Paid: ${matchingClient.amountPaid.toLocaleString()}</span>}
                  </div>
                )}
                {matchingClient && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {matchingClient.salesFathomLink && (
                      <a href={matchingClient.salesFathomLink} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                        <ExternalLink size={12} /> Sales Recording
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Tracker-based upcoming (fallback when no calendar data) */}
          {upcomingFromTracker.map((client) => (
            <div key={client.id || client.name} className="glass-static" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15, cursor: onClientClick ? "pointer" : "default" }} onClick={() => onClientClick?.(client.name)}>{client.name}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 10 }}>{client.email}</span>
                </div>
                <span style={{ color: "var(--warning)", fontWeight: 600, fontSize: 13 }}>
                  {daysUntil(client.startDate)}
                  <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>(start date)</span>
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                <span>Coach: <strong>{client.coachName}</strong></span>
                <span>Program: {client.program}</span>
                <span>Offer: {client.offer}</span>
                <span>Paid: ${client.amountPaid.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {client.salesFathomLink && (
                  <a href={client.salesFathomLink} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={12} /> Sales Recording
                  </a>
                )}
                {client.onboardingFathomLink && (
                  <a href={client.onboardingFathomLink} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={12} /> Onboarding Recording
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recently Onboarded */}
      <div className="section">
        <h2 className="section-title">
          <UserPlus size={16} />
          Recently Onboarded (Last 14 Days)
        </h2>
        {recentlyOnboarded.length === 0 ? (
          <div className="glass-static" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>
            No recent onboardings
          </div>
        ) : (
          <div className="glass-static" style={{ overflow: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Email</th>
                  <th>Coach</th>
                  <th>Program</th>
                  <th>Onboarded</th>
                  <th>Start Date</th>
                  <th>Paid</th>
                  <th>Recordings</th>
                </tr>
              </thead>
              <tbody>
                {recentlyOnboarded.map((client) => {
                  const onboardedDate = client.onboardingDate || client.startDate;
                  return (
                    <tr key={client.id || client.name}>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)", cursor: onClientClick ? "pointer" : "default" }} onClick={() => onClientClick?.(client.name)}>{client.name}</td>
                      <td style={{ fontSize: 12 }}>{client.email}</td>
                      <td>{client.coachName}</td>
                      <td>{client.program}</td>
                      <td>
                        <span style={{ color: "var(--success)", fontSize: 12 }}>
                          <CheckCircle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          {daysAgo(onboardedDate)}
                        </span>
                        {client.onboardingDate && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {client.onboardingDate}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{client.startDate}</td>
                      <td>${client.amountPaid.toLocaleString()}</td>
                      <td style={{ display: "flex", gap: 6 }}>
                        {client.salesFathomLink && (
                          <a href={client.salesFathomLink} target="_blank" rel="noopener noreferrer" title="Sales" style={{ color: "var(--accent)" }}>
                            <ExternalLink size={13} />
                          </a>
                        )}
                        {client.onboardingFathomLink && (
                          <a href={client.onboardingFathomLink} target="_blank" rel="noopener noreferrer" title="Onboarding" style={{ color: "var(--success)" }}>
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
