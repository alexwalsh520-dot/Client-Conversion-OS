"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Search,
  AlertTriangle,
  Activity,
  Users,
  Link2,
} from "lucide-react";
import { daysUntil } from "@/lib/everfit/validation";
import type { EverfitBrief, ReportDetail } from "@/lib/everfit/types";
import EverfitClientQuestion from "./EverfitClientQuestion";
import styles from "./everfit.module.css";

const percent = (v: number | null) => (v === null ? "—" : `${v}%`);
const date = (v: string | null) =>
  v
    ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Unknown";
const events = {
  workout_log_events: "Workout logs",
  added_meal_events: "Added meals",
  task_completion_events: "Completed tasks",
  community_posts: "Forum posts",
} as const;
const rank = { Urgent: 0, "Follow up": 1, Steady: 2 };
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`${styles.badge} ${value === "Urgent" || value === "Email conflict" ? styles.danger : value === "Steady" || value === "Email verified" ? styles.success : styles.warning}`}
    >
      {value}
    </span>
  );
}

export default function EverfitDashboard({
  detail,
  localPreview = false,
}: {
  detail: ReportDetail;
  localPreview?: boolean;
}) {
  const [view, setView] = useState<"overview" | "retention" | "quality">(
    "overview",
  );
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState("priority");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected)
      globalThis.document
        .getElementById("everfit-client-brief")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);
  const { document } = detail.report;
  const live = useMemo(
    () => new Map(detail.currentClients.map((c) => [c.id, c])),
    [detail.currentClients],
  );
  const clientEnd = (c: EverfitBrief) =>
    c.linked_client_id && live.has(c.linked_client_id)
      ? live.get(c.linked_client_id)!.end_date
      : c.end_date;
  const visible = document.clients
    .filter((c) => {
      const days = daysUntil(clientEnd(c));
      return (
        (view !== "retention" || (days !== null && days <= 7)) &&
        (view !== "quality" ||
          c.match_status !== "Email verified" ||
          c.ccos_snapshot?.coach_name !== document.coach_name) &&
        (!priority || c.priority === priority) &&
        `${c.name} ${c.issue} ${c.summary} ${c.next_step}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "end"
          ? (daysUntil(clientEnd(a)) ?? Infinity) -
            (daysUntil(clientEnd(b)) ?? Infinity)
          : rank[a.priority] - rank[b.priority] || a.name.localeCompare(b.name),
    );
  const current = document.clients.find((c) => c.everfit_id === selected);
  const endCount = document.clients.filter((c) => {
    const d = daysUntil(clientEnd(c));
    return d !== null && d <= 7;
  }).length;
  const verified = document.clients.filter(
    (c) => c.match_status === "Email verified",
  ).length;
  const capturedAge = daysUntil(document.review_date);
  return (
    <div className={styles.dashboard}>
      <div className={styles.banner}>
        <div>
          <div className={styles.eyebrow}>WEEKLY COACHING REVIEW</div>
          <h2>{document.coach_name}&apos;s client week</h2>
          <p>Review the conversations. Connect the activity. Close the loop.</p>
          <span className={styles.muted}>
            {date(document.review_date)} · Asia/Karachi
          </span>
        </div>
        <div className={styles.capture}>
          <Badge
            value={
              localPreview
                ? "Local preview · not saved"
                : document.preliminary
                  ? "Preliminary report"
                  : "Weekly report"
            }
          />
          <p>
            {document.window_start && document.window_end
              ? `${new Date(document.window_start).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })} → ${new Date(document.window_end).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })} PKT`
              : "Exact seven-day boundary not verified"}
          </p>
          {capturedAge !== null && capturedAge < -7 && (
            <span className={styles.warning}>
              This report is over a week old.
            </span>
          )}
        </div>
      </div>
      <div className={styles.stats}>
        <Stat
          icon={<Users size={16} />}
          label="Clients in this report"
          value={document.clients.length}
          note="Visible within your coach access"
        />
        <Stat
          icon={<AlertTriangle size={16} />}
          label="Upcoming or past end dates"
          value={endCount}
          note="Within 7 days or past · verify billing"
        />
        <Stat
          icon={<Activity size={16} />}
          label="Zero displayed 7d training"
          value={document.clients.filter((c) => c.training_7d_pct === 0).length}
          note="Read the client context before acting"
        />
        <Stat
          icon={<Link2 size={16} />}
          label="Verified CCOS links"
          value={`${verified} / ${document.clients.length}`}
          note="Other matches require review"
        />
      </div>
      <div className={styles.tabs} aria-label="Report views">
        {(["overview", "retention", "quality"] as const).map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
              setSelected(null);
            }}
          >
            {v === "overview"
              ? "Client overview"
              : v === "retention"
                ? "Retention watch"
                : "Matching & coverage"}
          </button>
        ))}
      </div>
      {view === "quality" && (
        <div className={styles.coverage}>
          <h3>Know what was reviewed</h3>
          <p>{document.precision}</p>
          <ul>
            {document.coverage_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p>
            Equal emails are checked against the current CCOS roster at import.
            Name candidates never become automatic client links. Owner conflicts
            need management review.
          </p>
        </div>
      )}
      <div className={styles.filters}>
        <label className={styles.search}>
          <Search size={16} />
          <input
            aria-label="Search clients and context"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients, issues, or next steps…"
          />
        </label>
        <select
          aria-label="Filter priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">All priorities</option>
          {Object.keys(rank).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Sort clients"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="priority">Priority first</option>
          <option value="end">End date soonest</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <p className={styles.muted} aria-live="polite">
        {visible.length} {visible.length === 1 ? "client" : "clients"} · Select
        a name for the weekly brief
      </p>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Attention</th>
              <th>7d training</th>
              <th>7d tasks</th>
              <th>App access</th>
              <th>CCOS end date</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr
                key={c.everfit_id}
                className={selected === c.everfit_id ? styles.selected : ""}
              >
                <td>
                  <button
                    aria-expanded={selected === c.everfit_id}
                    aria-controls="everfit-client-brief"
                    className={styles.clientButton}
                    onClick={() => setSelected(c.everfit_id)}
                  >
                    {c.name}
                  </button>
                  <small>{c.match_status}</small>
                </td>
                <td>
                  <Badge value={c.priority} />
                  <small>{c.issue}</small>
                </td>
                <td>
                  {percent(c.training_7d_pct)}
                  <div className={styles.bar}>
                    <span style={{ width: `${c.training_7d_pct ?? 0}%` }} />
                  </div>
                </td>
                <td>{percent(c.tasks_7d_pct)}</td>
                <td>
                  {c.last_app_access_display ?? "Not captured"}
                  <small>At capture · app opened</small>
                </td>
                <td>
                  {date(clientEnd(c))}
                  <small>
                    {c.linked_client_id && live.has(c.linked_client_id)
                      ? "Current verified record"
                      : "Snapshot · verify record"}
                  </small>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  No clients match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {current && (
        <section
          id="everfit-client-brief"
          className={styles.brief}
          aria-label={`${current.name} weekly brief`}
        >
          <div className={styles.briefHeader}>
            <div>
              <Badge value={current.priority} />
              <h2>{current.name}</h2>
              <p>
                Everfit owner: {current.everfit_owner} · {current.issue}
              </p>
            </div>
            <button onClick={() => setSelected(null)}>Close brief</button>
          </div>
          <div className={styles.briefGrid}>
            <div>
              <h3>Weekly summary</h3>
              <p className={styles.prose}>{current.summary}</p>
              <div className={styles.action}>
                <h3>Recommended next step</h3>
                <p>{current.next_step}</p>
                <small>
                  {current.action_owner} · {current.suggested_due} · Suggested,
                  not completed
                </small>
              </div>
            </div>
            <div>
              <h3>Client context</h3>
              <dl>
                <dt>Current CCOS end date</dt>
                <dd>
                  {current.linked_client_id &&
                  live.has(current.linked_client_id)
                    ? date(live.get(current.linked_client_id)!.end_date)
                    : "Not verified"}
                </dd>
                <dt>End date at import</dt>
                <dd>{date(current.end_date)}</dd>
                <dt>CCOS status at import</dt>
                <dd>{current.ccos_snapshot?.status ?? "Not verified"}</dd>
                <dt>Program at import</dt>
                <dd>{current.ccos_snapshot?.program ?? "Not verified"}</dd>
                <dt>30d training at capture</dt>
                <dd>{percent(current.training_30d_pct)}</dd>
              </dl>
              <Badge value={current.match_status} />
              <p className={styles.muted}>
                {current.match_status === "Email verified"
                  ? "Email matched the CCOS record during import."
                  : "Candidate context is provisional. Confirm identity before updating CCOS."}
              </p>
            </div>
          </div>
          <h3>Observed activity</h3>
          <div className={styles.events}>
            {Object.entries(events).map(([key, label]) => (
              <div key={key}>
                <strong>
                  {current.activity_observed_minimum[
                    key as keyof typeof events
                  ] > 0
                    ? `${current.activity_observed_minimum[key as keyof typeof events]}+`
                    : "—"}
                </strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className={styles.muted}>
            Counts are minimum events observed, not complete weekly totals. “—”
            means none confirmed. Macro meal logs, comments, likes, and body
            metrics are not included in these four categories.
          </p>
          {!localPreview && (
            <EverfitClientQuestion
              key={current.everfit_id}
              reportId={detail.report.id}
              everfitId={current.everfit_id}
            />
          )}
          <div className={styles.sources}>
            <h3>Source context</h3>
            <p>
              Everfit inbox and Updates, plus the CCOS roster. Review date:{" "}
              {date(document.review_date)}. Native activity percentages use
              Everfit&apos;s own window. See coverage notes for missing media
              and incomplete capture.
            </p>
            <div className={styles.links}>
              <a
                href={`https://app.everfit.io/home/client/${current.everfit_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Everfit profile <ArrowUpRight size={13} />
              </a>
              {current.linked_client_id && (
                <a href={`/coaching/daily-coacher/${current.linked_client_id}`}>
                  CCOS client context <ArrowUpRight size={13} />
                </a>
              )}
            </div>
          </div>
        </section>
      )}
      <p className={styles.footer}>
        App access, training logs, and replying to a coach are separate signals.
        No coach grade is inferred from inactive EODs or milestones.
      </p>
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className={styles.stat}>
      <span>
        {icon} {label}
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
