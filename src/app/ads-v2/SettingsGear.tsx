"use client";

import { useEffect, useState } from "react";
import { buildHowItWorks } from "@/lib/ads-v2/definitions";
import type { AdsV2Payload } from "@/lib/ads-v2/types";

interface OrganicKeyword {
  id: number;
  client_key: string;
  keyword_display: string;
}

const CLIENTS = [
  { key: "tyson", name: "Tyson" },
  { key: "jake", name: "Jake" },
];

export default function SettingsGear({ payload }: { payload: AdsV2Payload | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"organic" | "how">("organic");

  return (
    <>
      <button className="icon-btn" title="Settings" onClick={() => setOpen(true)}>
        <span className="lbl">Settings</span>
        <span>⚙</span>
      </button>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">Ads v2 settings</div>
              <button className="modal-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="gear-tabs">
                <button
                  className={`gear-tab${tab === "organic" ? " active" : ""}`}
                  onClick={() => setTab("organic")}
                >
                  Organic keywords
                </button>
                <button className={`gear-tab${tab === "how" ? " active" : ""}`} onClick={() => setTab("how")}>
                  How your numbers work
                </button>
              </div>
              {tab === "organic" ? <OrganicManager /> : <HowItWorks payload={payload} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OrganicManager() {
  const [keywords, setKeywords] = useState<OrganicKeyword[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/organic-keywords");
    if (res.ok) {
      const data = await res.json();
      setKeywords(data.keywords || []);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const add = async (client: string) => {
    const keyword = (drafts[client] || "").trim();
    if (!keyword) return;
    setBusy(true);
    await fetch("/api/organic-keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, keyword }),
    });
    setDrafts((d) => ({ ...d, [client]: "" }));
    await load();
    setBusy(false);
  };

  const remove = async (id: number) => {
    setBusy(true);
    await fetch("/api/organic-keywords", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
    setBusy(false);
  };

  return (
    <div>
      <div className="how-note">
        Organic keywords are tracked quietly through the same chain as ads and saved for a later Metrics
        card. Nothing organic shows in this paid ads view. If a word is marked organic while a paid ad is
        running it, the paid side wins during the overlap.
      </div>
      {CLIENTS.map((c) => {
        const list = keywords.filter((k) => k.client_key === c.key);
        return (
          <div key={c.key}>
            <div className="sec-title">{c.name}</div>
            <div className="kw-row">
              {list.length === 0 && <span className="freshness">No organic keywords yet.</span>}
              {list.map((k) => (
                <span className="kw-chip" key={k.id}>
                  {k.keyword_display}
                  <button onClick={() => remove(k.id)} disabled={busy} aria-label="Remove">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="kw-row">
              <input
                className="kw-input"
                placeholder="Add a keyword"
                value={drafts[c.key] || ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(c.key)}
              />
              <button className="ghost-btn" onClick={() => add(c.key)} disabled={busy}>
                Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HowItWorks({ payload }: { payload: AdsV2Payload | null }) {
  const how = buildHowItWorks();
  return (
    <div>
      <div className="how-note">{how.scopeNote}</div>

      <div className="sec-title">What each column means</div>
      {how.columns.map((col) => (
        <div className="how-col" key={col.key}>
          <div className="h-label">{col.label}</div>
          <div className="h-rule">{col.sentence}</div>
          <div className="h-src">Source: {col.source}</div>
        </div>
      ))}

      <div className="sec-title">How a sale is tied to a keyword</div>
      <ol className="how-chain">
        {how.revenueChain.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className="sec-title">Time</div>
      <div className="how-note">{how.etNote}</div>

      {payload && (
        <>
          <div className="sec-title">Freshness</div>
          <div className="freshness">
            {Object.entries(payload.freshness).map(([source, f]) => (
              <div key={source}>
                {source}: last data {f.lastEtDay || "unknown"}
                {f.ageHours != null ? `, synced ${f.ageHours}h ago` : ""}
                {f.stale ? <span className="stale"> (stale)</span> : ""}
              </div>
            ))}
            <div>Data version {payload.dataVersion}</div>
          </div>
        </>
      )}
    </div>
  );
}
