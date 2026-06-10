import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { postToSlack } from "@/lib/slack";
import { normalizeSetterKey } from "@/lib/ghl-dm-sync";
import { getServiceSupabase } from "@/lib/supabase";

// Fires the "LEAD STOLEN!" Slack alert when a setter opens (steals) a lead that
// is sitting in Time to Eat / Dead Meat. The stealer is taken from the signed-in
// CCOS user (NextAuth) — the only reliable way to know WHO took it, since all of
// a client's setters share one Instagram/ManyChat account so the outbound DM
// itself never identifies the human. Only a DIFFERENT setter than the original
// owner triggers an alert.

// The private #time-to-eat channel. The app's Slack bot must be invited to it,
// or chat.postMessage will fail with not_in_channel.
const TIME_TO_EAT_CHANNEL = process.env.SLACK_CHANNEL_TIME_TO_EAT || "C0B9AMSRZEX";

// One-announcement-per-(lead episode + stealer) dedupe, stored in app_settings.
const STEAL_LOG_KEY = "time_to_eat_steals_v1";
const STEAL_RETENTION_DAYS = 7;

// Canonical display names so a login like "Kelz" reads as "Kelechi" in Slack.
const SETTER_DISPLAY: Record<string, string> = {
  amara: "Amara",
  kelechi: "Kelechi",
  gideon: "Gideon",
  debbie: "Debbie",
  erin: "Erin",
};

function setterKey(name?: string | null): string {
  const key = normalizeSetterKey(name) || "";
  if (key === "kelz") return "kelechi";
  return key;
}

function displayName(name?: string | null): string {
  const key = setterKey(name);
  return SETTER_DISPLAY[key] || name?.trim() || "Unknown";
}

// Wall-clock time between the prospect's last reply and now — literally how long
// they sat waiting before someone went to respond.
function formatWait(fromIso: string, toMs: number): string {
  const fromMs = new Date(fromIso).getTime();
  if (!Number.isFinite(fromMs)) return "unknown";
  let mins = Math.max(0, Math.round((toMs - fromMs) / 60000));
  const days = Math.floor(mins / (60 * 24));
  mins -= days * 60 * 24;
  const hours = Math.floor(mins / 60);
  mins -= hours * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(" ");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const stealerRaw = session?.user?.name || session?.user?.email || null;
  if (!session?.user || !stealerRaw) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const subscriberId = typeof body.subscriberId === "string" ? body.subscriberId : null;
  const oldOwner = typeof body.oldOwner === "string" ? body.oldOwner : null;
  const leadName = typeof body.leadName === "string" ? body.leadName : null;
  const lastProspectResponseAt =
    typeof body.lastProspectResponseAt === "string" ? body.lastProspectResponseAt : null;

  if (!subscriberId || !lastProspectResponseAt) {
    return NextResponse.json({ ok: false, error: "Missing lead context" }, { status: 400 });
  }

  const stealerKey = setterKey(stealerRaw);
  const ownerKey = setterKey(oldOwner);

  // Only a different setter taking the lead is a steal. The owner finally
  // replying to their own lead is not.
  if (!stealerKey || (ownerKey && stealerKey === ownerKey)) {
    return NextResponse.json({ ok: true, stolen: false, reason: "owner" });
  }

  // The prospect's last-reply timestamp identifies the current stale episode, so
  // the same person re-clicking (or the link firing twice) won't double-post.
  const dedupeKey = `${subscriberId}:${lastProspectResponseAt}:${stealerKey}`;
  const nowMs = Date.now();

  let sb: ReturnType<typeof getServiceSupabase> | null = null;
  try {
    sb = getServiceSupabase();
  } catch {
    sb = null;
  }

  if (sb) {
    try {
      const { data } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", STEAL_LOG_KEY)
        .maybeSingle();
      const log: Record<string, number> = data?.value ? JSON.parse(String(data.value)) : {};

      if (log[dedupeKey]) {
        return NextResponse.json({ ok: true, stolen: false, reason: "already_announced" });
      }

      const cutoff = nowMs - STEAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const [key, at] of Object.entries(log)) {
        if (at < cutoff) delete log[key];
      }
      log[dedupeKey] = nowMs;

      await sb.from("app_settings").upsert(
        {
          key: STEAL_LOG_KEY,
          value: JSON.stringify(log),
          updated_at: new Date(nowMs).toISOString(),
          updated_by: "time-to-eat-steal",
        },
        { onConflict: "key" },
      );
    } catch (error) {
      // If the dedupe store is unavailable, still announce — better a rare dupe
      // than a missed steal.
      console.warn("[time-to-eat/steal] dedupe store failed:", error);
    }
  }

  const lines = ["🚨 LEAD STOLEN!"];
  if (leadName) lines.push(`Prospect: ${leadName}`);
  lines.push(`Stolen by: ${displayName(stealerRaw)}`);
  lines.push(`Old Owner: ${oldOwner?.trim() ? displayName(oldOwner) : "Unassigned"}`);
  lines.push(`Prospect Sat Waiting For: ${formatWait(lastProspectResponseAt, nowMs)}`);

  const posted = await postToSlack(TIME_TO_EAT_CHANNEL, lines.join("\n"));

  return NextResponse.json({ ok: true, stolen: true, posted });
}
