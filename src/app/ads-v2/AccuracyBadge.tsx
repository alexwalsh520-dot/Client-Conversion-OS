"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { formatCell } from "./format";
import type { AdsV2Node, AdsV2Payload } from "@/lib/ads-v2/types";

// The daily accuracy checks as a one-glance health badge next to the gear,
// and (since 8/23) the per-ad funnel panel: every ad's DMs, booked calls,
// calls taken, new clients and cash, straight from the window snapshot the
// page already fetched. No new queries; the panel is a different view of
// numbers the table already holds. Renders nothing until loaded and nothing
// on failure, so the tab is never blocked by its own health indicator.

const COLORS: Record<string, string> = {
  green: "#7dd3a8",
  amber: "#d4b27a",
  red: "#e89a94",
};

const FUNNEL_COLS: { key: string; label: string }[] = [
  { key: "messages", label: "DMs" },
  { key: "booked", label: "Booked" },
  { key: "taken", label: "Taken" },
  { key: "newClients", label: "Clients" },
  { key: "collected", label: "Collected" },
];

export default function AccuracyBadge({ payload }: { payload: AdsV2Payload | null }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/accuracy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.counts) {
          setCounts(d.counts);
          setLastRunAt(d.lastRunAt ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!counts) return null;

  const worst =
    (counts.red || 0) + (counts.error || 0) > 0 ? "red" : (counts.amber || 0) > 0 ? "amber" : "green";
  const Icon = worst === "green" ? ShieldCheck : ShieldAlert;
  const summary = [
    counts.green ? `${counts.green} green` : null,
    counts.amber ? `${counts.amber} amber` : null,
    counts.red ? `${counts.red} red` : null,
    counts.error ? `${counts.error} errored` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const when = lastRunAt ? new Date(lastRunAt).toLocaleString() : "no run yet";

  return (
    <>
      <button
        className="icon-btn"
        aria-label="Data accuracy and per-ad funnel"
        title={`Data accuracy: ${summary || "no checks yet"} (last run ${when}). Click for the per-ad funnel.`}
        onClick={() => setOpen(true)}
      >
        <Icon size={16} style={{ color: COLORS[worst] }} />
      </button>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">Accuracy &amp; per-ad funnel</div>
              <button className="modal-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="how-note">
                Daily checks: {summary || "no checks yet"} (last run {when}).{" "}
                <Link href="/accuracy">Open the full checks page</Link>
              </div>
              <div className="sec-title">Per-ad funnel — this window</div>
              <div className="how-note">
                A dash means nothing to count yet for that step, never a zero score.
              </div>
              <FunnelList payload={payload} />
              <div className="freshness">
                Sales still waiting for human review in the attribution workspace (the + button) are
                not counted for any ad yet.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FunnelList({ payload }: { payload: AdsV2Payload | null }) {
  if (!payload || payload.preparing) {
    return <div className="freshness">Numbers for this window are still preparing.</div>;
  }
  const leaves: AdsV2Node[] = payload.campaigns.flatMap((c) =>
    c.children.flatMap((a) => a.children),
  );
  if (leaves.length === 0) return <div className="freshness">No ads in this window.</div>;

  const sorted = [...leaves].sort((a, b) => (b.spendCents || 0) - (a.spendCents || 0));
  const active = sorted.filter(
    (ad) => (ad.messages || 0) + (ad.booked || 0) + (ad.taken || 0) + (ad.newClients || 0) > 0 ||
      (ad.collectedCents || 0) > 0,
  );
  const quiet = sorted.length - active.length;

  return (
    <div className="shield-funnel">
      <div className="shield-funnel-row shield-funnel-head">
        <span>Ad</span>
        {FUNNEL_COLS.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
      </div>
      {active.map((ad) => (
        <div className="shield-funnel-row" key={ad.id}>
          <span className="shield-funnel-name">
            {ad.shortName || ad.name}
            <span className="shield-funnel-kw">
              {ad.keyword ? ad.keyword.toUpperCase() : ""} · {ad.clientName}
            </span>
          </span>
          {FUNNEL_COLS.map((c) => {
            const cell = formatCell(c.key, ad);
            return (
              <span key={c.key} className={cell.cls}>
                {cell.text}
              </span>
            );
          })}
        </div>
      ))}
      {quiet > 0 && (
        <div className="freshness">
          {quiet} more {quiet === 1 ? "ad has" : "ads have"} spend but no DMs yet in this window.
        </div>
      )}
    </div>
  );
}
