"use client";

import { useEffect, useState } from "react";
import { buildHowItWorks } from "@/lib/ads-v2/definitions";
import type { AdsV2Payload } from "@/lib/ads-v2/types";
import { IcGear } from "./icons";

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
      <button
        className="icon-btn gear-btn"
        title="Settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <IcGear />
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
  const freshness = payload && !payload.preparing ? Object.entries(payload.freshness) : [];
  return (
    <div className="how-legend">
      <p className="legend-intro">{how.scopeNote}</p>

      <section className="legend-section">
        <h4 className="legend-h">What each column means</h4>
        {how.columns.map((col) => (
          <div className="legend-row" key={col.key}>
            <div className="legend-term">{col.label}</div>
            <div className="legend-def">
              {col.sentence}
              <span className="legend-src">Source: {col.source}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="legend-section">
        <h4 className="legend-h">How revenue gets tied to an ad</h4>
        <ol className="legend-chain">
          {how.revenueChain.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="legend-section">
        <h4 className="legend-h">Time and freshness</h4>
        <p className="legend-note">{how.etNote}</p>
        {freshness.length > 0 && (
          <div className="legend-fresh">
            {freshness.map(([source, f]) => (
              <div key={source}>
                {source}: last data {f.lastEtDay || "unknown"}
                {f.ageHours != null ? `, synced ${f.ageHours}h ago` : ""}
                {f.stale ? <span className="stale"> (stale)</span> : ""}
              </div>
            ))}
            {payload && <div>Data version {payload.dataVersion}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
