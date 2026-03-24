/**
 * Slack Bot Event Handler for Sales Brain Agent
 *
 * This API route receives Slack events (messages, app_mentions) and
 * routes them to the Sales Brain agent for processing. It handles:
 *
 * 1. URL verification challenge (Slack app setup)
 * 2. App mention events (@SalesBrain what's our show rate?)
 * 3. Direct messages to the bot
 * 4. Slash command support (/sales-brain)
 *
 * Slack Setup Requirements:
 * - Bot Token Scopes: chat:write, app_mentions:read, im:read, im:write, im:history
 * - Event Subscriptions: app_mention, message.im
 * - Request URL: https://client-conversion-os.vercel.app/api/slack/agent
 *
 * IMPORTANT: Uses next/server after() to keep the serverless function alive
 * after returning 200 to Slack. Without this, Vercel kills the function
 * before the async agent work completes.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { runSalesAgent } from "@/lib/sales-agent";

// --- Slack API Helpers ---

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SALES_BRAIN_CHANNEL = process.env.SALES_BRAIN_CHANNEL_ID; // The dedicated #sales-brain channel

async function postSlackMessage(channel: string, text: string, threadTs?: string) {
  const body: Record<string, string> = {
    channel,
    text,
    // Ensure the bot appears with a custom name/icon
    username: "Sales Brain",
    icon_emoji: ":brain:"
  };
  if (threadTs) body.thread_ts = threadTs;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("Slack postMessage error:", data.error);
  }
  return data;
}

async function postSlackBlocks(channel: string, blocks: unknown[], text: string, threadTs?: string) {
  const body: Record<string, unknown> = {
    channel,
    blocks,
    text, // Fallback text for notifications
    username: "Sales Brain",
    icon_emoji: ":brain:"
  };
  if (threadTs) body.thread_ts = threadTs;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return res.json();
}

// Add a "thinking" reaction while processing
async function addReaction(channel: string, timestamp: string, emoji: string) {
  await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ channel, timestamp, name: emoji })
  });
}

async function removeReaction(channel: string, timestamp: string, emoji: string) {
  await fetch("https://slack.com/api/reactions.remove", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ channel, timestamp, name: emoji })
  });
}

// --- Conversation History Store (in-memory, per channel) ---
// For production, consider storing in Supabase instead

const conversationCache = new Map<string, Array<{ role: string; content: string; timestamp: number }>>();
const CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes

function getConversationHistory(channelId: string): Array<{ role: string; content: string }> {
  const history = conversationCache.get(channelId) || [];
  const now = Date.now();
  // Filter out old messages
  const recent = history.filter(m => now - m.timestamp < CONVERSATION_TTL);
  conversationCache.set(channelId, recent);
  return recent.map(({ role, content }) => ({ role, content }));
}

function addToHistory(channelId: string, role: string, content: string) {
  if (!conversationCache.has(channelId)) {
    conversationCache.set(channelId, []);
  }
  conversationCache.get(channelId)!.push({ role, content, timestamp: Date.now() });
  // Keep only last 20 messages
  const history = conversationCache.get(channelId)!;
  if (history.length > 20) {
    conversationCache.set(channelId, history.slice(-20));
  }
}

// --- Event Processing ---

// Track processed events to prevent duplicates (Slack retries)
const processedEvents = new Set<string>();

async function handleMessage(event: {
  text: string;
  channel: string;
  user: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}) {
  // Ignore bot messages
  if (event.bot_id) return;

  // Deduplicate
  const eventKey = `${event.channel}-${event.ts}`;
  if (processedEvents.has(eventKey)) return;
  processedEvents.add(eventKey);
  // Clean up old events after 5 minutes
  setTimeout(() => processedEvents.delete(eventKey), 5 * 60 * 1000);

  // Strip the bot mention from the text
  const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  const replyThreadTs = event.thread_ts || event.ts;

  console.log(`[Sales Brain] Processing message from ${event.user}: "${cleanText.slice(0, 100)}"`);

  try {
    // Add thinking reaction
    await addReaction(event.channel, event.ts, "brain");

    // Get conversation history for context
    const history = getConversationHistory(event.channel);
    addToHistory(event.channel, "user", cleanText);

    // Run the agent
    console.log("[Sales Brain] Calling runSalesAgent...");
    const response = await runSalesAgent(cleanText, history);
    console.log(`[Sales Brain] Got response (${response.length} chars)`);

    // Save response to history
    addToHistory(event.channel, "assistant", response);

    // Remove thinking reaction
    await removeReaction(event.channel, event.ts, "brain");

    // Split long responses into multiple messages (Slack has 4000 char limit)
    if (response.length <= 3900) {
      await postSlackMessage(event.channel, response, replyThreadTs);
    } else {
      const chunks = splitMessage(response, 3900);
      for (const chunk of chunks) {
        await postSlackMessage(event.channel, chunk, replyThreadTs);
      }
    }
    console.log("[Sales Brain] Response posted to Slack successfully");
  } catch (err) {
    console.error("[Sales Brain] Error processing message:", err);
    await removeReaction(event.channel, event.ts, "brain").catch(() => {});
    await postSlackMessage(
      event.channel,
      "Warning: Hit an error processing that. Error: " +
        (err instanceof Error ? err.message : "Unknown"),
      replyThreadTs
    );
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    // Find the last newline before the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // If no good newline, split at space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1) splitIndex = maxLength;

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// --- Route Handlers ---

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    // 2. Handle Slack events
    if (body.type === "event_callback") {
      const event = body.event;

      // Handle app_mention (someone @mentioned the bot)
      if (event.type === "app_mention") {
        // Use after() to keep serverless function alive after responding to Slack
        after(handleMessage(event));
        return NextResponse.json({ ok: true });
      }

      // Handle direct messages
      if (event.type === "message" && event.channel_type === "im") {
        after(handleMessage(event));
        return NextResponse.json({ ok: true });
      }

      // Handle messages in the dedicated sales-brain channel
      if (event.type === "message" && event.channel === SALES_BRAIN_CHANNEL && !event.bot_id) {
        after(handleMessage(event));
        return NextResponse.json({ ok: true });
      }
    }

    // 3. Handle slash commands (/sales-brain)
    if (body.command) {
      const text = body.text || "Give me a quick status update on today's numbers.";
      const responseUrl = body.response_url;

      // Use after() for slash commands too
      after((async () => {
        try {
          const response = await runSalesAgent(text);
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "in_channel",
              text: response
            })
          });
        } catch (err) {
          console.error("[Sales Brain] Slash command error:", err);
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              response_type: "ephemeral",
              text: "Warning: Error processing your request. Check server logs."
            })
          });
        }
      })());

      return NextResponse.json({
        response_type: "ephemeral",
        text: "Analyzing... give me a moment."
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Sales Brain] Webhook error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET handler for health check
export async function GET() {
  return NextResponse.json({
    status: "Sales Brain is online",
    timestamp: new Date().toISOString()
  });
}
