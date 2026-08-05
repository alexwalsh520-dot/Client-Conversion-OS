// The internal front door. Session-gated, read-only, and the ONLY way an
// in-app caller asks the money system a question.
//
// GET  lists the locked question list, so a caller can see what it may ask.
// POST takes {question_key, params} and returns either an answer carrying its
//      quoted definitions and a real as-of time, or an honest refusal.
//
// This route composes nothing. It hands the question to the door and returns
// what the door says.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { askQuestion, describeDoor, describeMisses } from "@/lib/question-door/service";
import { isRefusal } from "@/lib/question-door/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ?misses=1 returns the certification backlog instead of the locked list:
  // what callers keep asking that this door cannot answer yet. Same route
  // because they are two halves of one question, "what can this door do".
  if (new URL(req.url).searchParams.get("misses")) {
    const backlog = await describeMisses(50);
    return NextResponse.json(backlog, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      note: "These are the only questions this door answers. Anything else is refused in writing rather than improvised.",
      questions: describeDoor(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { refused: true, reason: "Send a JSON object with question_key and params." },
      { status: 400 },
    );
  }

  const result = await askQuestion(
    {
      question_key: (body as Record<string, unknown>).question_key,
      params: ((body as Record<string, unknown>).params ?? {}) as Record<string, unknown>,
    },
    { caller: "app" },
  );

  // A refusal is a normal, expected outcome of a locked door, not a server
  // fault. It is returned as 200 with refused: true so a caller reads the
  // reason and the nearest allowed question instead of retrying blindly.
  return NextResponse.json(result, {
    status: isRefusal(result) ? 200 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
