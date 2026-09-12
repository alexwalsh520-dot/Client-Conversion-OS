import { normalizeEmail, record } from "./validation";
export interface SyncClient {
  id: string;
  name: string;
  owner: string;
  training7: number | null;
  training30: number | null;
  tasks7: number | null;
  lastAccess: string | null;
}
export interface SyncCapture {
  id: string;
  email: string | null;
  owner: string;
  capturedAt: string;
  messages: {
    id: string;
    date: string;
    time: string;
    sender: string;
    text: string;
    attachments: boolean;
  }[];
  updates: { text: string; age: string }[];
  notes: string[];
  historyComplete: boolean;
}
function str(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || v.length > max || (!empty && !v.trim()))
    throw new Error("Invalid sync text.");
  return v.trim();
}
function id(v: unknown): string {
  const s = str(v, 24);
  if (!/^[a-f0-9]{24}$/.test(s)) throw new Error("Invalid Everfit ID.");
  return s;
}
function pct(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
    throw new Error("Invalid percentage.");
  return v;
}
export function parseSyncPlan(value: unknown): SyncClient[] {
  if (!Array.isArray(value) || !value.length || value.length > 2000)
    throw new Error("A sync requires 1–2000 clients.");
  const plan = value.map((v) => {
    const c = record(v);
    return {
      id: id(c.id),
      name: str(c.name, 200),
      owner: str(c.owner, 100),
      training7: pct(c.training7),
      training30: pct(c.training30),
      tasks7: pct(c.tasks7),
      lastAccess: c.lastAccess == null ? null : str(c.lastAccess, 100),
    };
  });
  if (new Set(plan.map((c) => c.id)).size !== plan.length)
    throw new Error("Duplicate clients in roster.");
  return plan;
}
export function parseCapture(value: unknown): SyncCapture {
  const c = record(value);
  if (
    !Array.isArray(c.messages) ||
    c.messages.length > 4000 ||
    !Array.isArray(c.updates) ||
    c.updates.length > 2000 ||
    !Array.isArray(c.notes) ||
    c.notes.length > 20
  )
    throw new Error("Capture exceeds supported limits.");
  const capturedAt = str(c.capturedAt, 40);
  if (
    !Number.isFinite(Date.parse(capturedAt)) ||
    Math.abs(Date.now() - Date.parse(capturedAt)) > 86400000
  )
    throw new Error("Capture must be from the last day.");
  const messages = c.messages.map((v) => {
    const m = record(v),
      sender = str(m.sender, 20);
    if (!["coach", "client", "unknown"].includes(sender))
      throw new Error("Invalid message sender.");
    return {
      id: str(m.id, 100),
      date: str(m.date, 100, true),
      time: str(m.time, 100, true),
      sender,
      text: str(m.text, 12000, true),
      attachments: m.attachments === true,
    };
  });
  if (new Set(messages.map((m) => m.id)).size !== messages.length)
    throw new Error("Duplicate message IDs.");
  return {
    id: id(c.id),
    email: normalizeEmail(c.email),
    owner: str(c.owner, 100),
    capturedAt,
    messages,
    updates: c.updates.map((v) => {
      const u = record(v);
      return { text: str(u.text, 2000), age: str(u.age, 100, true) };
    }),
    notes: c.notes.map((n) => str(n, 1000)),
    historyComplete: c.historyComplete === true,
  };
}
