"use client";

// ─────────────────────────────────────────────────────────────────────────
// DM INBOX PANEL — click a Messages number, read the actual conversations.
// A right-side slide-over: conversation list first, click a person for the
// full verbatim thread. Read-only, minimal, a marketer's tool. The list is
// the SAME people the clicked cell counted (same facts, same filters), so
// the header count always matches the table.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DmConversation, DmInboxList, DmThread } from "@/lib/ads-v2/dm-inbox";

export interface DmTarget {
  clientKey: string;
  keyword: string;
  adName: string;
  cellCount: number;
  dateFrom: string;
  dateTo: string;
}

function initialOf(c: DmConversation): string {
  const s = (c.name || c.handle || "?").trim();
  return s ? s[0].toUpperCase() : "?";
}

function shortDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export default function DmInboxPanel({ target, onClose }: { target: DmTarget | null; onClose: () => void }) {
  const [list, setList] = useState<DmInboxList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<DmConversation | null>(null);
  const [thread, setThread] = useState<DmThread | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);

  // Load the conversation list whenever a new cell is opened.
  useEffect(() => {
    setList(null);
    setListError(null);
    setActive(null);
    setThread(null);
    setThreadError(null);
    if (!target) return;
    let alive = true;
    const q = new URLSearchParams({
      client: target.clientKey,
      keyword: target.keyword,
      from: target.dateFrom,
      to: target.dateTo,
    });
    fetch(`/api/ads-v2/dm-inbox?${q}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) setListError(String(data.error || `Request failed (${res.status})`));
        else setList(data as DmInboxList);
      })
      .catch(() => alive && setListError("Could not load conversations"));
    return () => {
      alive = false;
    };
  }, [target]);

  // Load a thread when a conversation is opened.
  useEffect(() => {
    setThread(null);
    setThreadError(null);
    if (!target || !active) return;
    let alive = true;
    const q = new URLSearchParams({
      client: target.clientKey,
      keyword: target.keyword,
      subscriber: active.subscriberId,
    });
    fetch(`/api/ads-v2/dm-inbox?${q}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) setThreadError(String(data.error || `Request failed (${res.status})`));
        else setThread(data as DmThread);
      })
      .catch(() => alive && setThreadError("Could not load this thread"));
    return () => {
      alive = false;
    };
  }, [target, active]);

  // ESC closes: thread first, then the panel.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active) setActive(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, active, onClose]);

  if (!target || typeof document === "undefined") return null;

  const activeName = active ? active.name || (active.handle ? `@${active.handle}` : "Unknown lead") : "";

  return createPortal(
    <div className="dm-overlay" onClick={onClose}>
      <aside className="dm-panel" onClick={(e) => e.stopPropagation()} aria-label="DM conversations">
        {active ? (
          <div className="dm-head">
            <button className="dm-back" onClick={() => setActive(null)} aria-label="Back to list">
              ←
            </button>
            <div className="dm-head-text">
              <div className="dm-head-title">{activeName}</div>
              {active.handle && (
                <a
                  className="dm-head-sub dm-handle-link"
                  href={`https://instagram.com/${active.handle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{active.handle}
                </a>
              )}
            </div>
            <button className="dm-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        ) : (
          <div className="dm-head">
            <div className="dm-head-text">
              <div className="dm-head-title">
                DMs · <span className="dm-kw">{target.keyword.toUpperCase()}</span>
              </div>
              <div className="dm-head-sub" title={target.adName}>
                {target.adName}
              </div>
            </div>
            <button className="dm-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        )}

        {active ? (
          <div className="dm-thread">
            {threadError ? (
              <div className="dm-note">{threadError}</div>
            ) : !thread ? (
              <div className="dm-note">Loading thread...</div>
            ) : (
              <>
                {thread.messages.map((m, i) => {
                  const prev = thread.messages[i - 1];
                  const newDay = !prev || dayOf(prev.at) !== dayOf(m.at);
                  return (
                    <div key={i}>
                      {newDay && <div className="dm-day">{dayOf(m.at)}</div>}
                      <div className={`dm-bubble-row ${m.who}`}>
                        <div className={`dm-bubble ${m.who}`} title={timeOf(m.at)}>
                          {m.text || <span className="dm-empty-msg">(attachment or empty message)</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {thread.truncated && <div className="dm-note">Thread truncated to the first {thread.messages.length} messages.</div>}
              </>
            )}
          </div>
        ) : (
          <div className="dm-list">
            {listError ? (
              <div className="dm-note">{listError}</div>
            ) : !list ? (
              <div className="dm-note">Loading conversations...</div>
            ) : (
              <>
                <div className="dm-count-line">
                  {list.total} {list.total === 1 ? "person" : "people"} DMed this keyword in the window
                  {list.withThread < list.total ? ` · ${list.withThread} with a stored conversation` : ""}
                </div>
                {list.conversations.map((c) => (
                  <button
                    key={c.subscriberId}
                    className={`dm-row${c.hasThread ? "" : " no-thread"}`}
                    onClick={c.hasThread ? () => setActive(c) : undefined}
                    disabled={!c.hasThread}
                    title={
                      c.hasThread
                        ? "Open the conversation"
                        : "This person fired the keyword, but their thread is not in DM storage (capture covers recent threads)."
                    }
                  >
                    <span className="dm-avatar">{initialOf(c)}</span>
                    <span className="dm-row-main">
                      <span className="dm-row-top">
                        <span className="dm-row-name">{c.name || (c.handle ? `@${c.handle}` : "Unknown lead")}</span>
                        <span className="dm-row-date">{c.hasThread ? shortDay(c.lastMessageAt) : shortDay(`${c.dmEtDay}T12:00:00Z`)}</span>
                      </span>
                      <span className="dm-row-snippet">
                        {c.hasThread
                          ? `${c.lastFrom === "creator" ? "You: " : ""}${c.snippet || ""}`
                          : "No stored messages yet"}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}
