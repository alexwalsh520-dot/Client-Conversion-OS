"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SerializedClient } from "@/lib/coaching-v2/types";
import { LEVEL_LABEL } from "@/lib/coaching-v2/types";
import { Dot } from "./bits";

function fmt(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Drawer({ clientId, onClose, onAsk }: { clientId: number | null; onClose: () => void; onAsk: (about: string) => void }) {
  const [loaded, setLoaded] = useState<{ id: number; client: SerializedClient | null; err: string | null } | null>(null);
  const c = loaded && loaded.id === clientId ? loaded.client : null;
  const err = loaded && loaded.id === clientId ? loaded.err : null;

  useEffect(() => {
    if (clientId === null) return;
    let live = true;
    const id = clientId;
    fetch(`/api/coaching-v2/client/${id}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error || "Could not load"); return r.json(); })
      .then((j) => { if (live) setLoaded({ id, client: j.client, err: null }); })
      .catch((e) => { if (live) setLoaded({ id, client: null, err: e instanceof Error ? e.message : "Could not load" }); });
    return () => { live = false; };
  }, [clientId]);

  const open = clientId !== null;
  return (
    <aside className={`h2-dr ${open ? "open" : ""}`} aria-hidden={!open}>
      {open && (
        <>
          <div className="hd">
            <div className="top">
              <div className="nm">
                {c ? <Link href={`/coaching-v2/clients/${c.id}`} title="Open the full record">{c.name}</Link> : <span className="h2-m">Loading</span>}
                {c && <span className="h2-st"><Dot lvl={c.health} />{LEVEL_LABEL[c.health]}</span>}
              </div>
              <button className="close" onClick={onClose} aria-label="Close">×</button>
            </div>
            {c && (
              <div className="meta">
                Coach <b>{c.coach || "–"}</b><span className="sep">·</span>{c.program || "No program set"}<span className="sep">·</span>{c.stage}
              </div>
            )}
          </div>
          <div className="bd">
            {err && <p className="h2-quiet">{err}</p>}
            {c && (
              <>
                {c.goal && <p className="h2-goal">{c.goal}</p>}
                <div className="h2-flags" style={{ margin: "0 0 18px" }}>
                  {c.flags.length ? c.flags.map((f, i) => <div key={i} className={`f ${f.lvl}`}>{f.text}</div>) : <div className="ok">Nothing is flagged.</div>}
                </div>
                <div className="h2-h">Latest check in</div>
                {c.checkin ? (
                  <div className="h2-ci" style={{ marginBottom: 18 }}>
                    <div className="top"><b>{c.checkin.score}/100</b><span>{fmt(c.checkin.at)}, {c.checkin.daysAgo} days ago</span></div>
                    {c.checkin.text ? <p className="q" style={{ fontSize: 14 }}>“{c.checkin.text}”</p> : <p className="q h2-m" style={{ fontSize: 13 }}>No written answer.</p>}
                    {c.checkin.followUp && <div className={`ft ${c.checkin.followUp.startsWith("No") ? "r" : ""}`}>{c.checkin.followUp}</div>}
                  </div>
                ) : <p className="h2-quiet">No check ins yet.</p>}
                <div className="h2-h">Conversation</div>
                {c.messages.length ? (
                  <div className="h2-conv" style={{ marginBottom: 18 }}>
                    {c.messages.map((m, i) => (
                      <div key={i} className={`h2-msg ${m.sender}`}>
                        <span className="w">{fmt(m.at)}</span>
                        <span className="t">{m.text}<span className="who">{m.sender === "client" ? c.name : c.coach}</span></span>
                      </div>
                    ))}
                    <div className="more">{c.owedDays ? <span className="h2-r">Client has waited {c.owedDays} day{c.owedDays === 1 ? "" : "s"} for a reply.</span> : <span>Last message {c.messages[0].daysAgo} days ago.</span>}</div>
                  </div>
                ) : <p className="h2-quiet">No Everfit conversation matched yet.</p>}
                <p className="h2-quiet">
                  <Link className="h2-lk" href={`/coaching-v2/clients/${c.id}`}>Open the full record</Link> for retention, asks, nutrition, and payment.
                  {" "}<button className="h2-lk" style={{ background: "none", border: "none", padding: 0, font: "inherit", marginLeft: 10 }} onClick={() => onAsk(c.name)}>Ask Ahmad about {c.name.split(" ")[0]}</button>
                </p>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
