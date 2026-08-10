/**
 * Attribution completeness ping — the human half of 100% coverage.
 *
 * Daily (13:10 UTC = 9:10am ET). Finds every tracker sale in the rolling
 * window with cash collected but NO recorded origin — no ad keyword, no
 * organic keyword, and no origin-stating call type (Miscellaneous Chat,
 * Follow up, Outbound Call, Closer Cold Call). Blank call types and the
 * defaults that state no origin (Strategy Session, Onboarding Call) count
 * as open. DMs the list to the recipient(s) with who owns each sale and
 * exactly what to write to close it.
 *
 * Loop close: when the open list goes from something to nothing, one
 * celebration DM — coverage is back to 100% for the window. Quiet on days
 * where there was nothing open yesterday and nothing open today.
 *
 * Rollout is deliberately staged (Alex 8/04): DM Alex only, then Will, then
 * decide team-wide vs via Will. Change RECIPIENTS to advance a stage.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { postRichMessage } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Stage 1: Alex only. Stage 2: add Will. Stage 3: team channel or via Will.
const ALEX_DM = "U083ENKF9Q8";
const RECIPIENTS: readonly string[] = [ALEX_DM];

/** How many trailing ET days of sales the ping chases. */
const WINDOW_DAYS = 14;

/** Call types that state a real origin (lowercased). */
const ORIGIN_CALL_TYPES = new Set([
  "miscellaneous chat",
  "follow up",
  "outbound call",
  "closer cold call",
]);

const STATE_KEY = "attribution_ping_state";

interface OpenSale {
  sale_key: string;
  prospect_name: string | null;
  closer: string | null;
  setter_name: string | null;
  call_type: string | null;
  sale_et_day: string;
  collected_usd_cents: number;
  subscriber_id: string | null;
}

interface PingState {
  openKeys: string[];
  openCents: number;
  updatedAt: string;
}

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const authHeader = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`);
}

function etDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function missingWhat(s: OpenSale): string {
  const ct = (s.call_type || "").trim();
  if (!ct) return "call type blank, no keyword";
  return `call type "${ct}" states no origin, no keyword`;
}

function buildOpenBlocks(open: OpenSale[], closedCount: number, closedCents: number): unknown[] {
  const totalCents = open.reduce((sum, s) => sum + s.collected_usd_cents, 0);
  const lines = open
    .sort((a, b) => b.collected_usd_cents - a.collected_usd_cents)
    .map((s) => {
      const owner = [s.closer && `closer ${s.closer}`, s.setter_name && `setter ${s.setter_name}`]
        .filter(Boolean)
        .join(", ");
      return `• *${s.prospect_name || "(no name)"}* — ${money(s.collected_usd_cents)} on ${s.sale_et_day}${owner ? ` (${owner})` : ""} — ${missingWhat(s)}`;
    })
    .join("\n");

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Attribution check: ${money(totalCents)} has no origin`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${open.length} sale${open.length === 1 ? "" : "s"} in the last ${WINDOW_DAYS} days collected cash with no recorded origin:\n\n${lines}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: 'To close one: set its *Call Type* in the sales tracker (Miscellaneous Chat / Follow up / Outbound Call), or paste the ManyChat link so the keyword attaches. The Ads V2 coverage card hits 100% when this list is empty.',
        },
      ],
    },
  ];
  if (closedCount > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Closed since last ping: ${closedCount} sale${closedCount === 1 ? "" : "s"} (${money(closedCents)}). Keep going.`,
        },
      ],
    });
  }
  return blocks;
}

function buildLoopClosedBlocks(closedCount: number, closedCents: number): unknown[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Attribution back to 100%", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Every dollar collected in the last ${WINDOW_DAYS} days now has a recorded origin. ${closedCount} open sale${closedCount === 1 ? "" : "s"} (${money(closedCents)}) got tagged since the last ping. The coverage card reads 100% for this window.`,
      },
    },
  ];
}

async function GETimpl() {
  const db = getServiceSupabase();
  const from = etDay(-(WINDOW_DAYS - 1));
  const today = etDay(0);

  const { data, error } = await db
    .from("adsv2_sale_facts")
    .select(
      "sale_key, prospect_name, closer, setter_name, call_type, sale_et_day, collected_usd_cents, subscriber_id, keyword_normalized, is_organic, awaiting_review",
    )
    .gte("sale_et_day", from)
    .lte("sale_et_day", today)
    .gt("collected_usd_cents", 0);
  if (error) throw new Error(`attribution-ping sale read failed: ${error.message}`);

  const open: OpenSale[] = [];
  for (const r of data || []) {
    const attributed =
      Boolean(r.keyword_normalized) && String(r.keyword_normalized).trim() !== "" && !r.awaiting_review;
    const originWritten = ORIGIN_CALL_TYPES.has((r.call_type || "").trim().toLowerCase());
    if (!attributed && !originWritten) open.push(r as OpenSale);
  }
  const openKeys = open.map((s) => s.sale_key).sort();
  const openCents = open.reduce((sum, s) => sum + s.collected_usd_cents, 0);

  // Previous state, for "closed since last ping" and the loop-close moment.
  const { data: stateRow } = await db.schema("warehouse").from("adsv2_meta").select("value").eq("key", STATE_KEY).maybeSingle();
  const prev = (stateRow?.value || null) as PingState | null;
  const prevKeys = new Set(prev?.openKeys || []);
  const closedKeys = [...prevKeys].filter((k) => !openKeys.includes(k));
  // Closed dollars: best-effort from the previous total minus what is still open from that set.
  const stillOpenFromPrev = open.filter((s) => prevKeys.has(s.sale_key));
  const closedCents = Math.max(
    0,
    (prev?.openCents || 0) - stillOpenFromPrev.reduce((sum, s) => sum + s.collected_usd_cents, 0),
  );

  let sent: "open_list" | "loop_closed" | "quiet" = "quiet";
  if (open.length > 0) {
    const blocks = buildOpenBlocks(open, closedKeys.length, closedCents);
    for (const channel of RECIPIENTS) await postRichMessage(channel, blocks);
    sent = "open_list";
  } else if (prevKeys.size > 0) {
    const blocks = buildLoopClosedBlocks(closedKeys.length, closedCents);
    for (const channel of RECIPIENTS) await postRichMessage(channel, blocks);
    sent = "loop_closed";
  }

  const nextState: PingState = { openKeys, openCents, updatedAt: new Date().toISOString() };
  await db
    .schema("warehouse").from("adsv2_meta")
    .upsert({ key: STATE_KEY, value: nextState as unknown as object, updated_at: new Date().toISOString() }, { onConflict: "key" });

  return {
    window: { from, to: today },
    open: open.length,
    openUsd: Math.round(openCents / 100),
    closedSinceLast: closedKeys.length,
    sent,
    recipients: RECIPIENTS.length,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await GETimpl();
    return NextResponse.json({ ran: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ran: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
