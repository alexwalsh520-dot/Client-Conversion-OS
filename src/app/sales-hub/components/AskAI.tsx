"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AccessInfo {
  allowed: boolean;
  dailyLimit?: number | null;
  remainingToday?: number | null;
}

const SUGGESTIONS = [
  "Where are most leads dropping off?",
  "What's our average response time this week, by setter?",
  "Which follow-up messages are getting the most replies?",
];

export default function AskAI() {
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sales-hub/ask-ai")
      .then((res) => res.json())
      .then((info: AccessInfo) => {
        setAccess(info);
        setRemaining(info.remainingToday ?? null);
      })
      .catch(() => setAccess({ allowed: false }));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Hidden entirely for anyone not on the allowlist.
  if (!access?.allowed) return null;

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setError("");
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const res = await fetch("/api/sales-hub/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history: messages.slice(-8) }),
      });
      const data = (await res.json()) as { answer?: string; error?: string; remainingToday?: number | null };
      if (!res.ok || !data.answer) {
        setError(data.error || "Ask AI failed — try again.");
        setMessages(messages); // roll back the optimistic user message
        return;
      }
      setMessages([...nextMessages, { role: "assistant", content: data.answer }]);
      if (data.remainingToday != null) setRemaining(data.remainingToday);
    } catch {
      setError("Ask AI failed — try again.");
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="ask-ai" style={{ marginBottom: 16, scrollMarginTop: 72 }}>
      <div
        style={{
          borderRadius: 12,
          border: "1px solid var(--border-subtle)",
          borderLeft: "3px solid var(--accent)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, color: "var(--text-primary)", fontSize: 15 }}>
            <Sparkles size={18} style={{ color: "var(--accent)" }} />
            Ask AI
          </div>
          {remaining != null && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {remaining} question{remaining === 1 ? "" : "s"} left today
            </div>
          )}
        </div>

        <div style={{ padding: 16 }}>
          {messages.length === 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void ask(s)}
                  disabled={busy}
                  style={{
                    fontSize: 12,
                    padding: "6px 12px",
                    borderRadius: 16,
                    border: "1px solid var(--border-subtle)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.length > 0 && (
            <div
              ref={scrollRef}
              style={{ display: "grid", gap: 10, maxHeight: 420, overflowY: "auto", marginBottom: 12, paddingRight: 4 }}
            >
              {messages.map((message, i) => (
                <div
                  key={i}
                  style={{
                    justifySelf: message.role === "user" ? "end" : "start",
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontSize: 13,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    background: message.role === "user" ? "var(--accent)" : "var(--surface, rgba(255,255,255,0.04))",
                    border: message.role === "user" ? "none" : "1px solid var(--border-subtle)",
                    color: message.role === "user" ? "#fff" : "var(--text-primary)",
                  }}
                >
                  {message.content}
                </div>
              ))}
              {busy && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
                  <Loader2 size={14} className="spin" /> Analyzing your data…
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              placeholder="Ask about response times, lead drop-off, follow-up messages…"
              disabled={busy || remaining === 0}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              onClick={() => void ask(input)}
              disabled={busy || !input.trim() || remaining === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 650,
                cursor: busy ? "default" : "pointer",
                opacity: busy || !input.trim() || remaining === 0 ? 0.5 : 1,
              }}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Ask
            </button>
          </div>
          {remaining === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
              Daily limit reached — resets at midnight ET.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
