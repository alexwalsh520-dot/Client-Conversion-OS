"use client";

// ─────────────────────────────────────────────────────────────────────────
// LANES TABLE — the non-ad side of the funnel, right under the campaign
// performance table, in the identical visual language but compacted (no spend
// columns, because these lanes have no ad spend). One row per creator per
// bucket, Alex's signed lead definitions:
//   organic        sent an organic keyword (webhook-proven)
//   misc chat      contacted in the DMs, none of the lanes claims them
//                  (includes sales the owner confirmed as not from an ad)
//   follower       went through the new-follower automation (webhook-proven)
//   not attributed bookings still awaiting proof + sales with no recorded
//                  origin (this row is the review list, not a verdict)
// A dash means "not measurable for this bucket", never zero.
// ─────────────────────────────────────────────────────────────────────────

import type { LaneRow } from "@/lib/ads-v2/types";

const BUCKET_LABEL: Record<LaneRow["bucket"], string> = {
  organic: "Organic keywords",
  misc_chat: "Misc chats",
  follower: "Follower leads",
  not_attributed: "Not attributed yet",
};

const BUCKET_HINT: Record<LaneRow["bucket"], string> = {
  organic: "People who sent an organic keyword. Webhook-proven, same rigor as the ads table.",
  misc_chat:
    "Sales the team logged as Miscellaneous Chat plus sales the owner confirmed as not from an ad. No ad or organic keyword claims them.",
  follower: "People who entered the new-follower automation. Counted from its webhook.",
  not_attributed:
    "Bookings still awaiting proof and sales with no recorded origin. This row is the review list, not a verdict.",
};

const BUCKET_ORDER: LaneRow["bucket"][] = ["organic", "follower", "misc_chat", "not_attributed"];

function creatorLabel(key: string): string {
  if (key === "tyson") return "Tyson";
  if (key === "jake") return "Jake";
  if (key === "team") return "Team";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function num(v: number | null): string {
  return v == null ? "–" : String(v);
}

function usd(cents: number | null): string {
  if (cents == null) return "–";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default function LanesTable({ lanes }: { lanes: LaneRow[] }) {
  const rows = [...lanes]
    .filter((r) => !(r.clientKey === "team" && !r.taken && !r.wins && !r.collectedCents && !r.booked))
    .sort(
      (a, b) =>
        a.clientKey.localeCompare(b.clientKey) ||
        BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket),
    );
  if (rows.length === 0) return null;

  return (
    <div className="lanes-block">
      <div className="lanes-head">
        <span className="lanes-title">Beyond the ads</span>
        <span className="lanes-sub">
          Organic, follower, misc chat, and not-yet-attributed lanes. Same records, no ad spend
          behind them. A dash means not measurable for that lane.
        </span>
      </div>
      <div className="table-scroll">
        <table className="lanes-table">
          <thead>
            <tr>
              <th className="lane-label-col">Lane</th>
              <th>DMs</th>
              <th>Calls booked</th>
              <th>Calls taken</th>
              <th>New clients</th>
              <th>Collected revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.clientKey}:${r.bucket}`} className="flat-row">
                <td>
                  <span className="lane-cell" title={BUCKET_HINT[r.bucket]}>
                    <span className={`creator-pill ${r.clientKey === "jake" ? "jake" : r.clientKey === "tyson" ? "tyson" : "team"}`}>
                      {creatorLabel(r.clientKey)}
                    </span>
                    <span className="lane-name">{BUCKET_LABEL[r.bucket]}</span>
                  </span>
                </td>
                <td className="logged-cell">{num(r.dms)}</td>
                <td className="logged-cell">{num(r.booked)}</td>
                <td className="logged-cell">{num(r.taken)}</td>
                <td className="logged-cell">{num(r.wins)}</td>
                <td className="logged-cell">{usd(r.collectedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
