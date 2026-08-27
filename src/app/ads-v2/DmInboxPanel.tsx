"use client";

// ─────────────────────────────────────────────────────────────────────────
// DM INBOX PANEL — click a Messages number, read the actual conversations.
//
// Works at every level: an ad row opens one keyword, a campaign or ad set
// row opens all its keywords grouped under readable headings. Two loads:
// the grouped list paints immediately, then every thread in scope streams
// in ONE bulk request behind it — after that, opening a person is instant,
// and the left/right arrow keys flip through conversations with no loading.
// "Their words" flips the inbox into a feed of only what the leads typed
// (no names), windowed to the selected date range; click any line to jump
// into that conversation at that exact message.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DmConversation, DmInboxGrouped, DmMessage, DmThread } from "@/lib/ads-v2/dm-inbox";

export interface DmTargetGroup {
  keyword: string;
  adName: string;
}

export interface DmTarget {
  clientKey: string;
  title: string; // the clicked row's name
  cellCount: number;
  dateFrom: string;
  dateTo: string;
  groups: DmTargetGroup[];
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

/** The ET calendar day (YYYY-MM-DD) of a timestamp, DST-proof. */
function etDayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function DmInboxPanel({ target, onClose }: { target: DmTarget | null; onClose: () => void }) {
  const [list, setList] = useState<DmInboxGrouped | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Bulk thread cache: subscriberId -> messages. Filled by one background
  // request right after the list; makes thread opens and arrow keys instant.
  const [threadCache, setThreadCache] = useState<Record<string, DmMessage[]> | null>(null);
  const [view, setView] = useState<"inbox" | "words">("inbox");
  const [active, setActive] = useState<DmConversation | null>(null);
  // Fallback single-thread fetch, only used if the bulk load has not landed.
  const [soloThread, setSoloThread] = useState<DmThread | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  // When a thread is opened from the words feed, scroll to this message.
  const [jumpAt, setJumpAt] = useState<string | null>(null);

  const keywordsParam = useMemo(() => (target ? target.groups.map((g) => g.keyword).join(",") : ""), [target]);

  // Load 1: the grouped list (fast). Load 2: every thread in scope (bulk).
  useEffect(() => {
    setList(null);
    setListError(null);
    setThreadCache(null);
    setActive(null);
    setSoloThread(null);
    setThreadError(null);
    setView("inbox");
    setJumpAt(null);
    if (!target) return;
    let alive = true;
    const base = new URLSearchParams({
      client: target.clientKey,
      keywords: keywordsParam,
      from: target.dateFrom,
      to: target.dateTo,
    });
    fetch(`/api/ads-v2/dm-inbox?${base}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) setListError(String(data.error || `Request failed (${res.status})`));
        else setList(data as DmInboxGrouped);
      })
      .catch(() => alive && setListError("Could not load conversations"));
    fetch(`/api/ads-v2/dm-inbox?${base}&mode=threads`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!alive || !res.ok) return;
        setThreadCache((data as { threads: Record<string, DmMessage[]> }).threads || {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [target, keywordsParam]);

  // Every openable conversation in display order (for arrow-key cycling).
  const flatConvs = useMemo(() => {
    if (!list) return [] as DmConversation[];
    const seen = new Set<string>();
    const out: DmConversation[] = [];
    for (const g of list.groups)
      for (const c of g.conversations)
        if (c.hasThread && !seen.has(c.subscriberId)) {
          seen.add(c.subscriberId);
          out.push(c);
        }
    return out;
  }, [list]);
  const activeIdx = active ? flatConvs.findIndex((c) => c.subscriberId === active.subscriberId) : -1;

  const openConv = useCallback((c: DmConversation, at?: string | null) => {
    setActive(c);
    setJumpAt(at ?? null);
    setSoloThread(null);
    setThreadError(null);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!flatConvs.length) return;
      const idx = activeIdx < 0 ? (dir === 1 ? 0 : flatConvs.length - 1) : (activeIdx + dir + flatConvs.length) % flatConvs.length;
      openConv(flatConvs[idx]);
    },
    [flatConvs, activeIdx, openConv],
  );

  // Fallback fetch when the bulk cache has not landed yet for the open thread.
  useEffect(() => {
    if (!target || !active) return;
    if (threadCache?.[active.subscriberId]) return;
    let alive = true;
    const q = new URLSearchParams({ client: target.clientKey, subscriber: active.subscriberId });
    fetch(`/api/ads-v2/dm-inbox?${q}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) setThreadError(String(data.error || `Request failed (${res.status})`));
        else setSoloThread(data as DmThread);
      })
      .catch(() => alive && setThreadError("Could not load this thread"));
    return () => {
      alive = false;
    };
  }, [target, active, threadCache]);

  // Keyboard: Esc backs out; left/right flip conversations from anywhere.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (active) setActive(null);
        else onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, active, onClose, step]);

  // The words-only feed: every LEAD message across all cached threads whose
  // ET day is inside the selected window, newest first.
  const wordsFeed = useMemo(() => {
    if (!target || !threadCache) return null;
    const convById = new Map<string, DmConversation>();
    for (const c of flatConvs) convById.set(c.subscriberId, c);
    const out: Array<{ conv: DmConversation; text: string; at: string }> = [];
    for (const [mc, msgs] of Object.entries(threadCache)) {
      const conv = convById.get(mc);
      if (!conv) continue;
      for (const m of msgs) {
        if (m.who !== "lead" || !m.text.trim()) continue;
        const day = etDayOf(m.at);
        if (day < target.dateFrom || day > target.dateTo) continue;
        out.push({ conv, text: m.text, at: m.at });
      }
    }
    out.sort((a, b) => b.at.localeCompare(a.at));
    return out;
  }, [target, threadCache, flatConvs]);

  // Scroll-to-message when a thread was opened from the words feed.
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const activeMessages: DmMessage[] | null =
    active && threadCache?.[active.subscriberId]
      ? threadCache[active.subscriberId]
      : soloThread && active && soloThread.subscriberId === active.subscriberId
        ? soloThread.messages
        : null;
  useEffect(() => {
    if (!jumpAt || !activeMessages || !threadScrollRef.current) return;
    const el = threadScrollRef.current.querySelector<HTMLElement>(`[data-at="${CSS.escape(jumpAt)}"]`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [jumpAt, activeMessages]);

  if (!target || typeof document === "undefined") return null;

  const multiGroup = target.groups.length > 1;
  const groupLabel = new Map(target.groups.map((g) => [g.keyword, g.adName]));
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
            {activeIdx >= 0 && flatConvs.length > 1 && (
              <span className="dm-pos" title="Use the left and right arrow keys to flip through conversations">
                {activeIdx + 1} / {flatConvs.length}
              </span>
            )}
            <button className="dm-arrow" onClick={() => step(-1)} aria-label="Previous conversation">
              ‹
            </button>
            <button className="dm-arrow" onClick={() => step(1)} aria-label="Next conversation">
              ›
            </button>
            <button className="dm-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        ) : (
          <div className="dm-head">
            <div className="dm-head-text">
              <div className="dm-head-title">
                DMs · <span className="dm-kw">{target.title}</span>
              </div>
              <div className="dm-head-sub">
                {shortDay(`${target.dateFrom}T12:00:00Z`)} to {shortDay(`${target.dateTo}T12:00:00Z`)}
              </div>
            </div>
            <div className="dm-seg" role="tablist">
              <button
                className={`dm-seg-btn${view === "inbox" ? " on" : ""}`}
                onClick={() => setView("inbox")}
                role="tab"
                aria-selected={view === "inbox"}
              >
                Inbox
              </button>
              <button
                className={`dm-seg-btn${view === "words" ? " on" : ""}`}
                onClick={() => setView("words")}
                role="tab"
                aria-selected={view === "words"}
              >
                Their words
              </button>
            </div>
            <button className="dm-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        )}

        {active ? (
          <div className="dm-thread" ref={threadScrollRef}>
            {threadError && !activeMessages ? (
              <div className="dm-note">{threadError}</div>
            ) : !activeMessages ? (
              <div className="dm-note">Loading thread...</div>
            ) : (
              activeMessages.map((m, i) => {
                const prev = activeMessages[i - 1];
                const newDay = !prev || dayOf(prev.at) !== dayOf(m.at);
                return (
                  <div key={i}>
                    {newDay && <div className="dm-day">{dayOf(m.at)}</div>}
                    <div className={`dm-bubble-row ${m.who}`}>
                      <div
                        className={`dm-bubble ${m.who}${jumpAt === m.at ? " jumped" : ""}`}
                        data-at={m.at}
                        title={timeOf(m.at)}
                      >
                        {m.text || <span className="dm-empty-msg">(attachment or empty message)</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : view === "words" ? (
          <div className="dm-list">
            {!wordsFeed ? (
              <div className="dm-note">Loading every message...</div>
            ) : !wordsFeed.length ? (
              <div className="dm-note">No lead messages inside this date range.</div>
            ) : (
              <>
                <div className="dm-count-line">
                  {wordsFeed.length} messages from leads in the window · newest first · click one to open its
                  conversation
                </div>
                {wordsFeed.map((w, i) => (
                  <button key={i} className="dm-word-row" onClick={() => openConv(w.conv, w.at)}>
                    <span className="dm-word-text">{w.text}</span>
                    <span className="dm-word-date">{shortDay(w.at)}</span>
                  </button>
                ))}
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
                  {list.total} {list.total === 1 ? "person" : "people"} DMed in the window
                  {list.withThread < list.total ? ` · ${list.withThread} with a stored conversation` : ""}
                  {flatConvs.length > 1 ? " · arrow keys flip through them" : ""}
                </div>
                {list.groups.map((g) => (
                  <div key={g.keyword}>
                    {multiGroup && (
                      <div className="dm-group-head">
                        <span className="dm-group-kw">{g.keyword.toUpperCase()}</span>
                        <span className="dm-group-ad" title={groupLabel.get(g.keyword) || ""}>
                          {groupLabel.get(g.keyword) || ""}
                        </span>
                        <span className="dm-group-count">{g.total}</span>
                      </div>
                    )}
                    {g.conversations.map((c) => (
                      <button
                        key={`${g.keyword}:${c.subscriberId}`}
                        className={`dm-row${c.hasThread ? "" : " no-thread"}`}
                        onClick={c.hasThread ? () => openConv(c) : undefined}
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
                            <span className="dm-row-name">
                              {c.name || (c.handle ? `@${c.handle}` : "Unknown lead")}
                            </span>
                            <span className="dm-row-date">
                              {c.hasThread ? shortDay(c.lastMessageAt) : shortDay(`${c.dmEtDay}T12:00:00Z`)}
                            </span>
                          </span>
                          <span className="dm-row-snippet">
                            {c.hasThread
                              ? `${c.lastFrom === "creator" ? "You: " : ""}${c.snippet || ""}`
                              : "No stored messages yet"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
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
