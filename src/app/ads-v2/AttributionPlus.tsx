"use client";

// The + button under the gear and the accuracy shield. Opens the attribution
// workspace in the same modal shell as settings. Operator-only (never shown
// on the public ads share view). The footer manages the workspace's OWN
// share link: a no-login page that contains the attribution panel and
// nothing else.

import { useEffect, useState } from "react";
import { IcPlus } from "./icons";
import AttributionWorkspace from "./AttributionWorkspace";

export default function AttributionPlus() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="icon-btn gear-btn"
        title="Attribution workspace"
        aria-label="Attribution workspace"
        onClick={() => setOpen(true)}
      >
        <IcPlus />
      </button>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">Attribution</div>
              <button className="modal-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <AttributionWorkspace />
              <ShareRow />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// One business-wide link. Create shows it; Rotate/Revoke behave exactly like
// the client share links in settings.
function ShareRow() {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/ads-v2/attribution/share")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUrl(d?.url ?? null))
      .catch(() => {});
  }, []);

  const act = async (action: "mint" | "rotate" | "revoke") => {
    if (action === "rotate" && !confirm("Rotate this link? The current link stops working immediately.")) return;
    if (action === "revoke" && !confirm("Revoke this link? Anyone with it loses access immediately.")) return;
    setBusy(true);
    const res = await fetch("/api/ads-v2/attribution/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string | null };
    setUrl(data.url ?? null);
    setBusy(false);
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is visible to copy by hand */
    }
  };

  return (
    <div className="aw-share">
      <div className="sec-title">Share link</div>
      <div className="how-note">
        Opens this panel alone — no login, no sidebar, nothing else. For whoever helps clear the
        queue.
      </div>
      {url ? (
        <div className="share-row">
          <input className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="ghost-btn" onClick={copy} disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="ghost-btn" onClick={() => act("rotate")} disabled={busy}>
            Rotate
          </button>
          <button className="ghost-btn danger" onClick={() => act("revoke")} disabled={busy}>
            Revoke
          </button>
        </div>
      ) : (
        <div className="share-row">
          <span className="freshness">No active link.</span>
          <button className="ghost-btn" onClick={() => act("mint")} disabled={busy}>
            Create link
          </button>
        </div>
      )}
    </div>
  );
}
