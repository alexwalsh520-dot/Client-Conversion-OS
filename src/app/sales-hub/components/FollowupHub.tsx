"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, Zap, MessageSquare, TrendingUp, Pencil, Check, X,
  Play, Pause, Trash2, Plus, RefreshCw, ImagePlus, Type,
} from "lucide-react";
import type { Client } from "../types";

/* --------------------------- types --------------------------- */

type ClientKey = Exclude<Client, "all">;

const CLIENT_TO_SERVER: Record<ClientKey, string> = {
  tyson: "tyson_sonnek",
  keith: "keith_holland",
  zoeEmily: "zoe_and_emily",
};

interface Variant {
  id: number;
  slot: number;
  type: "text" | "meme" | "voicenote";
  body: string | null;
  media_url: string | null;
  status: "active" | "paused";
  note: string | null;
  sends: number;
  replies: number;
  reply_rate: number;
}

interface ActiveLead {
  subscriber_id: string;
  lead_name: string | null;
  next_slot: number | null;
  next_scheduled_at: string;
  total_pending: number;
  sends_so_far: number;
}

interface Send {
  id: number;
  subscriber_id: string;
  slot: number;
  sent_at: string;
  replied_at: string | null;
  reply_text: string | null;
  variant_id: number;
}

interface Overview {
  kpis: {
    total_sends_30d: number;
    total_replies_30d: number;
    reply_rate_30d: number;
    active_leads: number;
  };
  active_leads: ActiveLead[];
  recent_sends: Send[];
  recent_replies: Send[];
}

/* --------------------------- helpers --------------------------- */

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function fmtRelative(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const abs = Math.abs(diff);
  const past = diff >= 0;
  const minutes = Math.round(abs / 60000);
  if (minutes < 60) return `${past ? "" : "in "}${minutes}m${past ? " ago" : ""}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${past ? "" : "in "}${hours}h${past ? " ago" : ""}`;
  const days = Math.round(hours / 24);
  return `${past ? "" : "in "}${days}d${past ? " ago" : ""}`;
}
function slotLabel(slot: number | null) {
  if (slot === null) return "close";
  const labels: Record<number, string> = {
    2: "Slot 2 (+15m)",
    3: "Slot 3 (+24h)",
    4: "Slot 4 (+72h)",
    5: "Slot 5 (+120h)",
  };
  return labels[slot] ?? `Slot ${slot}`;
}

async function uploadMediaFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/followup/media/upload", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok || !json.url) throw new Error(json.error ?? "upload failed");
  return json.url as string;
}

/* --------------------------- component --------------------------- */

export default function FollowupHub({ selectedClient }: { selectedClient: Client }) {
  const clientKey: ClientKey = selectedClient === "all" ? "tyson" : selectedClient;
  const serverClient = CLIENT_TO_SERVER[clientKey];

  const [tab, setTab] = useState<"overview" | "splittest" | "variants">("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [oRes, vRes] = await Promise.all([
        fetch(`/api/followup/overview?client=${serverClient}`),
        fetch(`/api/followup/variants?client=${serverClient}`),
      ]);
      const oJson = await oRes.json();
      const vJson = await vRes.json();
      if (oJson.error) throw new Error(oJson.error);
      if (vJson.error) throw new Error(vJson.error);
      setOverview(oJson);
      setVariants(vJson.variants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [serverClient]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div>
      <Header
        kpis={overview?.kpis}
        onRefresh={fetchAll}
        loading={loading}
        selectedClient={selectedClient}
      />

      <div style={{ display: "flex", gap: 6, margin: "16px 0 18px" }}>
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>
          <MessageSquare size={13} /> Active + Replies
        </TabBtn>
        <TabBtn active={tab === "splittest"} onClick={() => setTab("splittest")}>
          <TrendingUp size={13} /> Split Tests
        </TabBtn>
        <TabBtn active={tab === "variants"} onClick={() => setTab("variants")}>
          <Pencil size={13} /> Scripts
        </TabBtn>
      </div>

      {error && <ErrorBanner message={error} />}

      {tab === "overview" && overview && <OverviewTab overview={overview} />}
      {tab === "splittest" && <SplitTestTab variants={variants} />}
      {tab === "variants" && (
        <VariantEditorTab
          variants={variants}
          client={serverClient}
          onChange={fetchAll}
        />
      )}
    </div>
  );
}

/* --------------------------- header --------------------------- */

function Header({
  kpis, onRefresh, loading, selectedClient,
}: {
  kpis?: Overview["kpis"];
  onRefresh: () => void;
  loading: boolean;
  selectedClient: Client;
}) {
  const k = kpis ?? { total_sends_30d: 0, total_replies_30d: 0, reply_rate_30d: 0, active_leads: 0 };
  const clientLabel = selectedClient === "all" ? "Tyson (default)" :
    selectedClient === "tyson" ? "Tyson" :
    selectedClient === "keith" ? "Keith" : "Zoe & Emily";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Zap size={16} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {clientLabel} — last 30 days
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
            borderRadius: 6, border: "1px solid var(--border-subtle)",
            background: "transparent", color: "var(--text-muted)",
            fontSize: 11, cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <Kpi label="Sends" value={k.total_sends_30d.toLocaleString()} />
        <Kpi label="Replies" value={k.total_replies_30d.toLocaleString()} />
        <Kpi label="Reply rate" value={fmtPct(k.reply_rate_30d)} highlight />
        <Kpi label="Active leads" value={k.active_leads.toLocaleString()} />
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderLeft: highlight ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

/* --------------------------- overview tab --------------------------- */

function OverviewTab({ overview }: { overview: Overview }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Card title={`Active leads (${overview.active_leads.length})`}>
        {overview.active_leads.length === 0 ? (
          <Empty>No leads currently in the cadence.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Lead</Th><Th>Next</Th><Th>When</Th><Th align="right">Sent</Th>
              </tr>
            </thead>
            <tbody>
              {overview.active_leads.map((l) => (
                <tr key={l.subscriber_id} style={rowStyle}>
                  <Td mono>{l.lead_name || l.subscriber_id.slice(0, 12)}</Td>
                  <Td>{slotLabel(l.next_slot)}</Td>
                  <Td>{fmtRelative(l.next_scheduled_at)}</Td>
                  <Td align="right">{l.sends_so_far}/4</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Recent replies (${overview.recent_replies.length})`}>
        {overview.recent_replies.length === 0 ? (
          <Empty>No replies yet.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Lead</Th><Th>Slot</Th><Th>Reply</Th><Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {overview.recent_replies.map((s) => (
                <tr key={s.id} style={rowStyle}>
                  <Td mono>{s.subscriber_id.slice(0, 12)}</Td>
                  <Td>{slotLabel(s.slot)}</Td>
                  <Td title={s.reply_text ?? ""}>
                    {(s.reply_text ?? "").slice(0, 40) || "—"}
                  </Td>
                  <Td align="right">{fmtRelative(s.replied_at!)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Recent sends (${overview.recent_sends.length})`} span={2}>
        {overview.recent_sends.length === 0 ? (
          <Empty>No sends yet. Tag a lead in ManyChat to start.</Empty>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Lead</Th><Th>Slot</Th><Th>Sent</Th><Th>Replied</Th>
              </tr>
            </thead>
            <tbody>
              {overview.recent_sends.map((s) => (
                <tr key={s.id} style={rowStyle}>
                  <Td mono>{s.subscriber_id.slice(0, 12)}</Td>
                  <Td>{slotLabel(s.slot)}</Td>
                  <Td>{fmtRelative(s.sent_at)}</Td>
                  <Td>{s.replied_at ? <span style={{ color: "#49d17e" }}>✓ {fmtRelative(s.replied_at)}</span> : <span style={{ color: "var(--text-muted)" }}>—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* --------------------------- split test tab --------------------------- */

function SplitTestTab({ variants }: { variants: Variant[] }) {
  const bySlot = useMemo(() => {
    const m = new Map<number, Variant[]>();
    for (const v of variants) {
      const list = m.get(v.slot) ?? [];
      list.push(v);
      m.set(v.slot, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => b.reply_rate - a.reply_rate);
    }
    return m;
  }, [variants]);

  const slots = [2, 3, 4, 5];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {slots.map((slot) => {
        const list = bySlot.get(slot) ?? [];
        const totalSends = list.reduce((s, v) => s + v.sends, 0);
        return (
          <Card key={slot} title={`${slotLabel(slot)} — ${list.length} variants, ${totalSends} sends`}>
            {list.length === 0 ? (
              <Empty>No variants for this slot.</Empty>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <Th>Message</Th><Th align="right">Sends</Th><Th align="right">Replies</Th>
                    <Th align="right">Rate</Th><Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v, i) => (
                    <tr key={v.id} style={rowStyle}>
                      <Td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 480 }}>
                          {i === 0 && v.sends >= 15 && v.reply_rate > 0 && (
                            <span style={{ color: "#d4ae5a", fontWeight: 700 }}>★</span>
                          )}
                          <MediaPreview variant={v} />
                          <span style={{
                            color: "var(--text-primary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {v.body ?? (v.type === "meme" ? "[image]" : v.type === "voicenote" ? "[voice note]" : `[${v.type}]`)}
                          </span>
                        </div>
                      </Td>
                      <Td align="right">{v.sends}</Td>
                      <Td align="right">{v.replies}</Td>
                      <Td align="right">
                        <span style={{
                          color: v.sends >= 15
                            ? (v.reply_rate > 0.4 ? "#49d17e" : v.reply_rate < 0.1 ? "#e06666" : "var(--text-primary)")
                            : "var(--text-muted)",
                          fontWeight: 600,
                        }}>
                          {v.sends === 0 ? "—" : fmtPct(v.reply_rate)}
                        </span>
                      </Td>
                      <Td>
                        <StatusPill status={v.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* --------------------------- variant editor tab --------------------------- */

function VariantEditorTab({
  variants, client, onChange,
}: {
  variants: Variant[];
  client: string;
  onChange: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState("");

  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);
  const [newType, setNewType] = useState<"text" | "meme">("text");
  const [newBody, setNewBody] = useState("");
  const [newMediaUrl, setNewMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);

  const bySlot = useMemo(() => {
    const m = new Map<number, Variant[]>();
    for (const v of variants) {
      const list = m.get(v.slot) ?? [];
      list.push(v);
      m.set(v.slot, list);
    }
    return m;
  }, [variants]);

  const resetCreateForm = () => {
    setCreatingSlot(null);
    setNewType("text");
    setNewBody("");
    setNewMediaUrl(null);
    setUploadErr("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFilePicked = async (file: File) => {
    setUploading(true);
    setUploadErr("");
    try {
      const url = await uploadMediaFile(file);
      setNewMediaUrl(url);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (v: Variant) => {
    setEditingId(v.id);
    setDraftBody(v.body ?? "");
  };

  const saveEdit = async (id: number) => {
    setBusy(true);
    try {
      await fetch(`/api/followup/variants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draftBody }),
      });
      setEditingId(null);
      onChange();
    } finally { setBusy(false); }
  };

  const toggleStatus = async (v: Variant) => {
    setBusy(true);
    try {
      await fetch(`/api/followup/variants/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: v.status === "active" ? "paused" : "active" }),
      });
      onChange();
    } finally { setBusy(false); }
  };

  const removeVariant = async (id: number) => {
    if (!confirm("Delete this variant? (Only allowed if it has no sends yet.)")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/followup/variants/${id}`, { method: "DELETE" });
      if (!r.ok) alert((await r.json()).error ?? "delete failed");
      onChange();
    } finally { setBusy(false); }
  };

  const createVariant = async (slot: number) => {
    if (newType === "text" && !newBody.trim()) return;
    if (newType === "meme" && !newMediaUrl) return;
    setBusy(true);
    try {
      await fetch(`/api/followup/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client, slot,
          type: newType,
          body: newBody.trim() || null,
          media_url: newType === "meme" ? newMediaUrl : null,
        }),
      });
      resetCreateForm();
      onChange();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {[2, 3, 4, 5].map((slot) => {
        const list = bySlot.get(slot) ?? [];
        return (
          <Card key={slot} title={`${slotLabel(slot)} — ${list.length} variants`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px", borderRadius: 8,
                    background: v.status === "paused" ? "rgba(255,255,255,0.02)" : "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    opacity: v.status === "paused" ? 0.55 : 1,
                  }}
                >
                  <MediaPreview variant={v} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingId === v.id ? (
                      <textarea
                        value={draftBody}
                        onChange={(e) => setDraftBody(e.target.value)}
                        rows={2}
                        style={textareaStyle}
                      />
                    ) : (
                      <div>
                        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                          {v.body ?? (v.type === "meme" ? "[image — no caption]" : v.type === "voicenote" ? "[voice note]" : `[${v.type}]`)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                          {v.sends} sends · {fmtPct(v.reply_rate)} reply
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {editingId === v.id ? (
                      <>
                        <IconBtn onClick={() => saveEdit(v.id)} disabled={busy} title="Save"><Check size={13} /></IconBtn>
                        <IconBtn onClick={() => setEditingId(null)} title="Cancel"><X size={13} /></IconBtn>
                      </>
                    ) : (
                      <>
                        <IconBtn onClick={() => startEdit(v)} title="Edit caption/body"><Pencil size={12} /></IconBtn>
                        <IconBtn onClick={() => toggleStatus(v)} disabled={busy} title={v.status === "active" ? "Pause" : "Activate"}>
                          {v.status === "active" ? <Pause size={12} /> : <Play size={12} />}
                        </IconBtn>
                        <IconBtn onClick={() => removeVariant(v.id)} disabled={busy || v.sends > 0} title="Delete"><Trash2 size={12} /></IconBtn>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {creatingSlot === slot ? (
                <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px dashed var(--border-subtle)", background: "rgba(201,169,110,0.05)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Type selector */}
                  <div style={{ display: "flex", gap: 4 }}>
                    <TypeBtn active={newType === "text"} onClick={() => setNewType("text")}>
                      <Type size={11} /> Text
                    </TypeBtn>
                    <TypeBtn active={newType === "meme"} onClick={() => setNewType("meme")}>
                      <ImagePlus size={11} /> Meme
                    </TypeBtn>
                  </div>

                  {/* Meme uploader */}
                  {newType === "meme" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {newMediaUrl ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <img src={newMediaUrl} alt="preview" style={{ width: 60, height: 60, borderRadius: 6, objectFit: "cover", border: "1px solid var(--border-subtle)" }} />
                          <div style={{ fontSize: 11, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {newMediaUrl}
                          </div>
                          <button onClick={() => setNewMediaUrl(null)} style={{ ...btnStyle, padding: "4px 8px" }}>
                            <X size={11} /> Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleFilePicked(f);
                            }}
                            style={{ display: "none" }}
                          />
                          <button
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            style={{ ...btnStyle, borderStyle: "dashed", padding: "14px", justifyContent: "center" }}
                          >
                            {uploading ? <Loader2 size={12} className="spin" /> : <ImagePlus size={12} />}
                            {uploading ? "Uploading…" : "Pick an image (jpg, png, gif, webp · max 5MB)"}
                          </button>
                        </>
                      )}
                      {uploadErr && <div style={{ fontSize: 10, color: "var(--danger)" }}>{uploadErr}</div>}
                    </div>
                  )}

                  {/* Body / caption textarea (optional for memes) */}
                  <textarea
                    placeholder={newType === "meme" ? "Optional caption…" : "Variant message body…"}
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    rows={2}
                    style={textareaStyle}
                  />

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => createVariant(slot)}
                      disabled={busy || uploading || (newType === "text" && !newBody.trim()) || (newType === "meme" && !newMediaUrl)}
                      style={{ ...btnStyle, background: "var(--accent)", color: "#111", opacity: (busy || uploading) ? 0.6 : 1 }}
                    >
                      <Check size={12} /> Add
                    </button>
                    <button onClick={resetCreateForm} style={btnStyle}>
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingSlot(slot)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
                    borderRadius: 6, border: "1px dashed var(--border-subtle)",
                    background: "transparent", color: "var(--text-muted)",
                    fontSize: 11, cursor: "pointer",
                  }}
                >
                  <Plus size={12} /> Add variant
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* --------------------------- primitives --------------------------- */

function MediaPreview({ variant }: { variant: Variant }) {
  if (variant.type === "meme" && variant.media_url) {
    return (
      <img
        src={variant.media_url}
        alt=""
        style={{
          width: 36, height: 36, borderRadius: 6, objectFit: "cover",
          border: "1px solid var(--border-subtle)", flexShrink: 0,
        }}
      />
    );
  }
  if (variant.type === "voicenote" && variant.media_url) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: 6,
        background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontSize: 10, flexShrink: 0,
      }}>🎙️</div>
    );
  }
  return null;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        fontSize: 11, fontWeight: 500, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TypeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
        borderRadius: 5, border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
        fontSize: 10, fontWeight: 500, cursor: "pointer",
      }}
    >{children}</button>
  );
}

function Card({ title, children, span }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{
      gridColumn: span ? `span ${span}` : undefined,
      border: "1px solid var(--border-subtle)",
      borderRadius: 10,
      background: "var(--bg-card)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: 0.6,
      }}>
        {title}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "paused" }) {
  const styles = status === "active"
    ? { bg: "rgba(73,209,126,0.1)", color: "#49d17e" }
    : { bg: "rgba(255,255,255,0.05)", color: "var(--text-muted)" };
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
      background: styles.bg, color: styles.color, textTransform: "uppercase",
    }}>{status}</span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      padding: "10px 14px", marginBottom: 12, borderRadius: 8,
      background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12,
    }}>{message}</div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "20px 4px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{children}</div>;
}

function IconBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 5,
        border: "1px solid var(--border-subtle)",
        background: "transparent", color: "var(--text-muted)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >{children}</button>
  );
}

/* --- inline styles, extracted to keep JSX readable --- */
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const rowStyle: React.CSSProperties = { borderTop: "1px solid var(--border-subtle)" };
const textareaStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)",
  color: "var(--text-primary)", fontSize: 13, resize: "vertical", fontFamily: "inherit",
};
const btnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "6px 12px", borderRadius: 6,
  border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)",
  color: "var(--text-primary)", fontSize: 11, cursor: "pointer",
};

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{
      textAlign: align ?? "left", padding: "8px 10px", fontSize: 10,
      fontWeight: 600, color: "var(--text-muted)",
      textTransform: "uppercase", letterSpacing: 0.4,
      borderBottom: "1px solid var(--border-subtle)",
    }}>{children}</th>
  );
}

function Td({ children, align, mono, title }: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  title?: string;
}) {
  return (
    <td
      title={title}
      style={{
        padding: "8px 10px", textAlign: align ?? "left",
        color: "var(--text-primary)", fontSize: 12,
        fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
        maxWidth: 480,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >{children}</td>
  );
}
