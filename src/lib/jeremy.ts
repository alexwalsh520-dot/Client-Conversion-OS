// Jeremy (Utari persona) MCP client — plain JSON-RPC 2.0 over HTTP.
// The server is stateless streamable-HTTP: `tools/call` works directly with a
// bearer token (no initialize handshake, no session header) and each response
// arrives as a single SSE `data:` frame. Verified by hand against
// persona-mcp.utari.ai on 2026-08-26.
//
// The async pattern this codebase relies on:
//   jeremySend(msg)  -> { status: "running", run_id?, conversation_id }
//   jeremyPoll(...)  -> { status: "running" } | { status: "completed", reply }
// The persona keeps working server-side between calls, so a cron can send on
// one tick and collect on a later one. Nothing here blocks on the reply.

const JEREMY_MCP_URL =
  process.env.JEREMY_MCP_URL || "https://persona-mcp.utari.ai/mcp/";

export interface JeremyResult {
  status: string; // "running" | "completed" | "failed" | ...
  reply?: string;
  run_id?: string | null;
  conversation_id?: string;
  detail?: string;
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 30000
): Promise<JeremyResult> {
  const token = process.env.JEREMY_MCP_TOKEN;
  if (!token) throw new Error("JEREMY_MCP_TOKEN not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(JEREMY_MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`jeremy mcp http ${res.status}`);
    const text = await res.text();
    const dataLine = text
      .split("\n")
      .find((l) => l.startsWith("data: "));
    const payload = JSON.parse(dataLine ? dataLine.slice(6) : text);
    if (payload.error) {
      throw new Error(`jeremy rpc error: ${JSON.stringify(payload.error).slice(0, 300)}`);
    }
    const inner = payload.result?.content?.[0]?.text;
    if (payload.result?.isError) {
      throw new Error(`jeremy tool error: ${String(inner).slice(0, 300)}`);
    }
    if (typeof inner !== "string") throw new Error("jeremy mcp: empty tool result");
    return JSON.parse(inner) as JeremyResult;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: start a new conversation turn, return the run handle. */
export function jeremySend(message: string): Promise<JeremyResult> {
  return rpc("send_message", { message, wait_for_reply: false });
}

/** Single non-blocking poll for a running turn. */
export function jeremyPoll(handle: {
  runId?: string | null;
  conversationId?: string | null;
}): Promise<JeremyResult> {
  const args: Record<string, unknown> = { wait_for_reply: false };
  if (handle.runId) args.run_id = handle.runId;
  else if (handle.conversationId) args.conversation_id = handle.conversationId;
  else throw new Error("jeremyPoll needs run_id or conversation_id");
  return rpc("get_response", args);
}
