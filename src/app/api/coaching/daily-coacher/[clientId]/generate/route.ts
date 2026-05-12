/**
 * Daily Coacher: topic draft generation endpoint.
 *
 * POST → generate a draft message for the given client + topic.
 *        Body: { topic: TopicKey }
 *        Returns: { draft, tipsUsed, usage }
 *
 * Returns 409 (Conflict) when the topic isn't ready yet — i.e., either
 * no spec file is registered or the tips_library has no approved tips
 * for the topic. UI uses the 409 to show a "topic not yet wired" state.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  generateTopicDraft,
  TopicNotReadyError,
} from "@/lib/daily-coacher/topic-generator";
import { TOPICS, type TopicKey } from "@/lib/daily-coacher/topics";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PostBody {
  topic?: string;
}

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isTopicKey(s: string): s is TopicKey {
  return TOPICS.some((t) => t.key === s);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.topic || !isTopicKey(body.topic)) {
    return NextResponse.json(
      { error: "topic is required and must be a valid TopicKey" },
      { status: 400 }
    );
  }

  try {
    const result = await generateTopicDraft(clientId, body.topic);
    return NextResponse.json({
      clientId,
      topicKey: result.topicKey,
      draft: result.draft,
      tipsUsed: result.tipsUsed.map((t) => ({ id: t.id, tip_text: t.tip_text })),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheCreationInputTokens: result.cacheCreationInputTokens,
        cacheReadInputTokens: result.cacheReadInputTokens,
      },
    });
  } catch (err) {
    if (err instanceof TopicNotReadyError) {
      return NextResponse.json(
        {
          error: err.message,
          topicKey: err.topicKey,
          notReady: true,
        },
        { status: 409 }
      );
    }
    console.error(
      `[api/coaching/daily-coacher/${clientId}/generate POST] failed:`,
      err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "draft generation failed" },
      { status: 500 }
    );
  }
}
