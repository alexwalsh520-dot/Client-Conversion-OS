"use client";

/**
 * Coaching V3 · Onboarding tab — client-side view.
 *
 * Renders the six sections legacy has, plus a New Client modal and an
 * Unlinked Forms panel. All actions call existing V1 endpoints (Phase 6
 * will re-namespace those to /api/coaching-v3/*).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Clock,
  UserPlus,
  UserX,
  ClipboardList,
  Link2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import NewClientModal from "./NewClientModal";
import BacklogTable, { type BacklogRow } from "./BacklogTable";
import LinkFormsPanel, { type UnlinkedForm } from "./LinkFormsPanel";

export type OnboardingClient = {
  id: number;
  name: string;
  email: string;
  phone: string;
  coach: string;
  program: string;
  offer: string;
  startDate: string;
  endDate: string;
  onboardingDate: string;
  onboardingStatus: string;
  amountPaid: number;
  salesPerson: string;
  paymentPlatform: string;
  salesFathomLink: string;
};

type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  clientName: string;
  status: string;
};

type RefundRow = {
  clientName: string;
  date: string;
  type: string;
  amount: number;
  reason: string;
  salesPerson: string;
};

type Props = {
  viewer: { isAdmin: boolean; canEditBacklog: boolean; email: string };
  scheduled: OnboardingClient[];
  noShows: OnboardingClient[];
  recentlyOnboarded: OnboardingClient[];
  calendarEvents: CalendarEvent[];
  calendarErr: string | null;
  backlog: Record<string, unknown>[];
  activeCoaches: string[];
  clientDirectory: { id: number; name: string; email: string }[];
  unlinkedForms: UnlinkedForm[];
  refunds: RefundRow[];
  financeError: string | null;
};

function money(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
function daysUntil(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(t)) return "";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((t - today.getTime()) / 86_400_000);
  if (diff < 0) return `${-diff}d ago`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}
function fmtTime(iso: string): string {
  if (!iso || !iso.includes("T")) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

export default function OnboardingView({
  viewer,
  scheduled,
  noShows,
  recentlyOnboarded,
  calendarEvents,
  calendarErr,
  backlog,
  activeCoaches,
  clientDirectory,
  unlinkedForms,
  refunds,
  financeError,
}: Props) {
  const [showNew, setShowNew] = useState(false);

  const totals = useMemo(
    () => ({
      scheduled: scheduled.length,
      noShows: noShows.length,
      recent: recentlyOnboarded.length,
      backlog: backlog.length,
      upcoming: calendarEvents.length,
      refunds: refunds.length,
      unlinked: unlinkedForms.length,
    }),
    [scheduled, noShows, recentlyOnboarded, backlog, calendarEvents, refunds, unlinkedForms],
  );

  return (
    <>
      <div className="h3-kpis" style={{ marginTop: 6 }}>
        <Kpi label="Scheduled" value={String(totals.scheduled)} />
        <Kpi label="No-shows / Rescheduled" value={String(totals.noShows)} tone={totals.noShows > 0 ? "a" : undefined} />
        <Kpi label="Recently onboarded (14d)" value={String(totals.recent)} />
        <Kpi label="Backlog rows" value={String(totals.backlog)} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 16px", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Signed in as {viewer.email}
          {viewer.canEditBacklog ? " · you can edit the Backlog Tracker" : " · Backlog Tracker is read-only for you"}
        </div>
        <button className="h3-btn p" onClick={() => setShowNew(true)}>
          <UserPlus size={12} /> New client
        </button>
      </div>

      {showNew && (
        <NewClientModal
          activeCoaches={activeCoaches}
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            window.location.reload();
          }}
        />
      )}

      {/* Scheduled */}
      <Section
        icon={<Calendar size={13} />}
        title="Scheduled onboardings"
        count={scheduled.length}
        subtitle="Active clients whose onboarding is on the books"
        empty="Nothing scheduled."
      >
        {scheduled.map((c) => (
          <ClientLine key={c.id} c={c} accent={fmtDate(c.startDate)} />
        ))}
      </Section>

      {/* No-shows / Reschedules */}
      <Section
        icon={<UserX size={13} style={{ color: "var(--warning)" }} />}
        title="No-shows / Rescheduled"
        count={noShows.length}
        subtitle="Nicole needs to follow up"
        empty="No missed onboardings."
      >
        {noShows.map((c) => (
          <div className="h3-li" key={c.id}>
            <span className={`dot ${c.onboardingStatus === "no_show" ? "r" : "a"}`} />
            <div className="main">
              <div className="row1">
                <span className="name">{c.name}</span>
                <span className="coach">{c.coach}</span>
                <span className={`bucket ${c.onboardingStatus === "no_show" ? "r" : "a"}`}>
                  {c.onboardingStatus === "no_show" ? "no-show" : "rescheduled"}
                </span>
              </div>
              <div className="row2">
                <span>Start {fmtDate(c.startDate)}</span>
                <span>{c.program}</span>
                {c.email && <span>{c.email}</span>}
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Upcoming from Nicole's Google Calendar */}
      <Section
        icon={<Clock size={13} />}
        title="Upcoming from calendar"
        count={calendarEvents.length}
        subtitle="Next 14 days · Nicole's Google Calendar"
        empty={calendarErr ? "" : "Nothing on Nicole's calendar in the next 14 days."}
      >
        {calendarErr && (
          <div style={{ padding: "10px 14px", color: "var(--danger)", fontSize: 12 }}>
            Calendar unavailable: {calendarErr}
          </div>
        )}
        {calendarEvents.map((evt) => (
          <div key={evt.id} className="h3-li">
            <span className="dot a" />
            <div className="main">
              <div className="row1">
                <span className="name">{evt.clientName || evt.summary}</span>
                <span className="coach">{daysUntil(evt.start)}</span>
              </div>
              <div className="row2">
                <span>{fmtDate(evt.start)}</span>
                {fmtTime(evt.start) && <span>{fmtTime(evt.start)} ET</span>}
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Recently onboarded */}
      <Section
        icon={<UserPlus size={13} />}
        title="Recently onboarded"
        count={recentlyOnboarded.length}
        subtitle="Onboarded in the last 14 days"
        empty="No new clients this window."
      >
        {recentlyOnboarded.map((c) => (
          <ClientLine
            key={c.id}
            c={c}
            accent={fmtDate(c.onboardingDate || c.startDate)}
          />
        ))}
      </Section>

      {/* Unlinked intake forms (links → creates meal plan task) */}
      <Section
        icon={<Link2 size={13} style={{ color: "var(--warning)" }} />}
        title="Unlinked intake forms"
        count={unlinkedForms.length}
        subtitle="Link a form to a client → seeds their meal plan task"
        empty="Every recent intake form is linked. 👍"
      >
        <LinkFormsPanel forms={unlinkedForms} clientDirectory={clientDirectory} />
      </Section>

      {/* Backlog Tracker — Nicole's spreadsheet */}
      <section className="h3-sec">
        <h2>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ClipboardList size={13} /> Backlog tracker
          </span>
          <span className="n" style={{ marginLeft: 6 }}>{backlog.length}</span>
          <span className="why">Nicole&apos;s missed-call log (Nicole + admins edit)</span>
        </h2>
        <BacklogTable initialRows={backlog as BacklogRow[]} canEdit={viewer.canEditBacklog} />
      </section>

      {/* Refunds & cancellations sheet — read only */}
      <Section
        icon={<AlertTriangle size={13} style={{ color: "var(--danger)" }} />}
        title="Refunds & cancellations · this month"
        count={refunds.length}
        subtitle="Read-only view of Nicole's sheet · she edits it directly in Google"
        empty="No refunds recorded this month."
      >
        {financeError && (
          <div style={{ padding: "10px 14px", color: "var(--danger)", fontSize: 12 }}>
            Sheet unavailable: {financeError}
          </div>
        )}
        {refunds.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <Th>Client</Th>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Sales person</Th>
                  <Th>Reason</Th>
                  <Th style={{ textAlign: "right" }}>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r, i) => (
                  <tr key={`${r.date}-${i}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td><b style={{ color: "var(--text-primary)" }}>{r.clientName}</b></Td>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td>{r.type}</Td>
                    <Td>{r.salesPerson}</Td>
                    <Td style={{ maxWidth: 300, whiteSpace: "normal" }}>{r.reason || "—"}</Td>
                    <Td style={{ textAlign: "right", color: "var(--danger)", fontWeight: 600 }}>
                      {money(r.amount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, padding: "8px 14px", fontSize: 11, color: "var(--text-muted)" }}>
          Nicole edits directly:{" "}
          <a
            href="https://docs.google.com/spreadsheets/d/1DjsLzXyAs23TezCVlHbr2N6Mjha76IYGU3OkXenDVoY/edit"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            open the Cancellations & Refunds sheet <ExternalLink size={10} />
          </a>
        </div>
      </Section>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "r" | "a" | "g" }) {
  return (
    <div className="h3-kpi">
      <div className="l">{label}</div>
      <div className={`v ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  subtitle,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  subtitle: string;
  empty: string;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const filled = arr.filter(Boolean).length > 0 && count > 0;
  return (
    <section className="h3-sec">
      <h2>
        <span className="n">{count}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {icon}
          {title}
        </span>
        <span className="why">{subtitle}</span>
      </h2>
      <div className="h3-list">
        {filled ? children : <div className="h3-empty">{empty}</div>}
      </div>
    </section>
  );
}

function ClientLine({ c, accent }: { c: OnboardingClient; accent: string }) {
  return (
    <Link
      href={`/coaching-v3/clients`}
      className="h3-li"
      style={{ textDecoration: "none" }}
      title={`Open Clients tab and search for ${c.name}`}
    >
      <span className="dot g" />
      <div className="main">
        <div className="row1">
          <span className="name">{c.name}</span>
          <span className="coach">{c.coach || "no coach"}</span>
          <span className="bucket u">{c.program}</span>
        </div>
        <div className="row2">
          <span>{accent}</span>
          {c.offer && <span>{c.offer}</span>}
          {c.email && <span>{c.email}</span>}
          {c.amountPaid > 0 && <span>{money(c.amountPaid)}</span>}
          {c.salesPerson && <span>Closer: {c.salesPerson}</span>}
        </div>
      </div>
    </Link>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: 10.5, letterSpacing: 0.05, textTransform: "uppercase", ...style }}>
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", ...style }}>{children}</td>;
}
