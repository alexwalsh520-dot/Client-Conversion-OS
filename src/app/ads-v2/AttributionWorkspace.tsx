"use client";

// The attribution workspace: every sale still waiting for a human decision,
// one row each, two possible answers — an ad keyword, or "not an ad". Saving
// writes ONE human resolution row; the labeler stamps it into the facts with
// the decider's name. Used inside the + modal on /ads-v2 and standalone on
// the public share page (publicToken set), where a name field appears.

import { useCallback, useEffect, useMemo, useState } from "react";

interface Row {
  saleKey: string;
  day: string;
  prospect: string | null;
  clientKey: string | null;
  cashUsdCents: number;
  callType: string | null;
  setter: string | null;
  closer: string | null;
  manychatLink: string | null;
  hasKeywordEvents: boolean;
}

interface Payload {
  queue: Row[];
  zeroCash: Row[];
  pendingCount: number;
  keywords: { clientKey: string; keyword: string }[];
}

const NAME_STORE = "adsv2-attribution-name";

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default function AttributionWorkspace({ publicToken }: { publicToken?: string }) {
  const apiBase = publicToken ? `/api/public/attribution/${publicToken}` : "/api/ads-v2/attribution";
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");

  useEffect(() => {
    if (publicToken) setName(localStorage.getItem(NAME_STORE) || "");
  }, [publicToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setPayload((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (row: Row, keyword: string | null, notAd: boolean, note: string) => {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleKey: row.saleKey,
          day: row.day,
          keyword,
          notAd,
          clientKey: row.clientKey,
          note: note || null,
          ...(publicToken ? { name } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSavedKeys((s) => new Set(s).add(row.saleKey));
    },
    [apiBase, publicToken, name],
  );

  if (error) return <div className="aw-note">Could not load: {error}</div>;
  if (!payload) return <div className="aw-note">Loading the review queue...</div>;

  const open = payload.queue.filter((r) => !savedKeys.has(r.saleKey));
  const zero = payload.zeroCash.filter((r) => !savedKeys.has(r.saleKey));

  return (
    <div className="aw">
      <div className="aw-note">
        Sales the app could not tie to an ad on its own. Pick the ad keyword, or mark it not an
        ad sale. Your decision is saved under your name and outranks every automatic match.
      </div>

      {publicToken && (
        <div className="aw-name-row">
          <label className="aw-name-label" htmlFor="aw-name">
            Your name
          </label>
          <input
            id="aw-name"
            className="aw-input"
            placeholder="So the record shows who decided"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              localStorage.setItem(NAME_STORE, e.target.value);
            }}
          />
        </div>
      )}

      {savedKeys.size > 0 && (
        <div className="aw-saved-note">
          {savedKeys.size} decision{savedKeys.size === 1 ? "" : "s"} saved. The numbers pick them
          up within the hour.
        </div>
      )}
      {payload.pendingCount > 0 && (
        <div className="aw-saved-note">
          {payload.pendingCount} earlier decision{payload.pendingCount === 1 ? "" : "s"} still
          waiting for the next sync.
        </div>
      )}

      {open.length === 0 ? (
        <div className="aw-empty">Nothing waiting. Every sale has an answer.</div>
      ) : (
        open.map((row) => (
          <WorkspaceRow
            key={row.saleKey}
            row={row}
            keywords={payload.keywords}
            needsName={!!publicToken && name.trim().length < 2}
            onSave={save}
          />
        ))
      )}

      {zero.length > 0 && (
        <details className="aw-zero">
          <summary>Zero-dollar rows ({zero.length})</summary>
          {zero.map((row) => (
            <WorkspaceRow
              key={row.saleKey}
              row={row}
              keywords={payload.keywords}
              needsName={!!publicToken && name.trim().length < 2}
              onSave={save}
            />
          ))}
        </details>
      )}
    </div>
  );
}

function WorkspaceRow({
  row,
  keywords,
  needsName,
  onSave,
}: {
  row: Row;
  keywords: { clientKey: string; keyword: string }[];
  needsName: boolean;
  onSave: (row: Row, keyword: string | null, notAd: boolean, note: string) => Promise<void>;
}) {
  const [keyword, setKeyword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listId = useMemo(() => `aw-kw-${row.saleKey.replace(/[^a-zA-Z0-9_-]/g, "")}`, [row.saleKey]);

  const doSave = async (notAd: boolean) => {
    if (needsName) {
      setErr("Add your name above first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(row, notAd ? null : keyword, notAd, note);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aw-row">
      <div className="aw-row-facts">
        <span className="aw-day">{row.day}</span>
        <span className="aw-prospect">{row.prospect || "Unnamed"}</span>
        <span className="aw-cash">{money(row.cashUsdCents)}</span>
        {row.clientKey && <span className="aw-tag">{row.clientKey}</span>}
        {row.setter && <span className="aw-meta">set by {row.setter}</span>}
        {row.closer && <span className="aw-meta">closed by {row.closer}</span>}
        {row.manychatLink && (
          <a className="aw-link" href={row.manychatLink} target="_blank" rel="noreferrer">
            ManyChat thread
          </a>
        )}
        {row.hasKeywordEvents && (
          <span className="aw-hint" title="This person sent ad keywords, so the thread likely shows which ad.">
            sent keywords
          </span>
        )}
      </div>
      <div className="aw-row-actions">
        <input
          className="aw-input aw-kw"
          list={listId}
          placeholder="Ad keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          disabled={busy}
        />
        <datalist id={listId}>
          {keywords.map((k) => (
            <option key={`${k.clientKey}:${k.keyword}`} value={k.keyword}>
              {k.clientKey}
            </option>
          ))}
        </datalist>
        <input
          className="aw-input aw-note-input"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
        <button
          className="ghost-btn aw-save"
          disabled={busy || !keyword.trim()}
          onClick={() => doSave(false)}
        >
          Save
        </button>
        <button className="ghost-btn" disabled={busy} onClick={() => doSave(true)}>
          Not an ad
        </button>
      </div>
      {err && <div className="aw-err">{err}</div>}
    </div>
  );
}
