"use client";

/**
 * Unlinked intake forms → link to an existing active client.
 *
 * Linking POSTs `link_nutrition_form` on /api/coaching. The action sets
 * `nutrition_status = 'pending'` so the meal plan task materializes for
 * Daman's queue on the Nutrition tab. Phase 6 will move the endpoint
 * under /api/coaching-v3/.
 *
 * Client search is purely in-memory against the directory the server
 * passed in — no coaching-client search endpoint exists yet. Cheap: the
 * roster is at most a few hundred rows.
 */

import { useMemo, useState } from "react";
import { Link2, CheckCircle2 } from "lucide-react";

export type UnlinkedForm = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  submittedAt: string | null;
};

type ClientHit = { id: number; name: string; email: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export default function LinkFormsPanel({
  forms,
  clientDirectory,
}: {
  forms: UnlinkedForm[];
  clientDirectory: ClientHit[];
}) {
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const remaining = forms.filter((f) => !linked.has(f.id));

  if (remaining.length === 0) {
    return <div className="h3-empty">Every recent intake form is linked. 👍</div>;
  }

  return (
    <div>
      {remaining.map((f) => (
        <FormRow
          key={f.id}
          form={f}
          clientDirectory={clientDirectory}
          onLinked={() => setLinked((prev) => new Set(prev).add(f.id))}
        />
      ))}
    </div>
  );
}

function FormRow({
  form,
  clientDirectory,
  onLinked,
}: {
  form: UnlinkedForm;
  clientDirectory: ClientHit[];
  onLinked: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(`${form.firstName} ${form.lastName}`.trim());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Auto-match: any client whose email matches the form's email, then
  // ranked substring matches against name. Cap 8.
  const matches = useMemo<ClientHit[]>(() => {
    const q = norm(query);
    const formEmail = norm(form.email);
    if (!q && !formEmail) return [];
    const seen = new Set<number>();
    const out: ClientHit[] = [];
    if (formEmail) {
      for (const c of clientDirectory) {
        if (norm(c.email) === formEmail) {
          seen.add(c.id);
          out.push(c);
        }
      }
    }
    if (q) {
      for (const c of clientDirectory) {
        if (seen.has(c.id)) continue;
        if (norm(c.name).includes(q) || (c.email && norm(c.email).includes(q))) {
          out.push(c);
          seen.add(c.id);
        }
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [clientDirectory, query, form.email]);

  const linkTo = async (clientId: number) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link_nutrition_form",
          payload: { clientId, nutritionFormId: form.id },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setOk(true);
      setTimeout(onLinked, 700);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h3-li" style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span className="dot a" style={{ marginTop: 6 }} />
        <div className="main">
          <div className="row1">
            <span className="name">
              {form.firstName} {form.lastName}
            </span>
            {form.email && <span className="coach">{form.email}</span>}
          </div>
          <div className="row2">
            <span>Submitted {fmtDate(form.submittedAt)}</span>
            {form.phone && <span>{form.phone}</span>}
          </div>
        </div>
        {!ok ? (
          <button className="h3-btn" onClick={() => setExpanded((v) => !v)} disabled={busy}>
            <Link2 size={11} /> {expanded ? "Cancel" : "Link to client"}
          </button>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: "var(--success)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckCircle2 size={12} /> Linked
          </span>
        )}
      </div>

      {expanded && !ok && (
        <div
          style={{
            marginTop: 8,
            marginLeft: 26,
            padding: 10,
            border: "1px solid var(--border-primary)",
            borderRadius: 6,
            background: "var(--bg-secondary)",
          }}
        >
          <input
            className="h3-in"
            style={{ width: "100%" }}
            placeholder="Filter clients by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {err && <div style={{ marginTop: 6, fontSize: 11, color: "var(--danger)" }}>{err}</div>}
          <div style={{ marginTop: 8, display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {matches.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 4px" }}>
                No active client matches this filter.
              </div>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => linkTo(c.id)}
                  disabled={busy}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: 4,
                    cursor: busy ? "wait" : "pointer",
                    fontSize: 12,
                    color: "var(--text-primary)",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.email && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.email}</span>
                  )}
                </button>
              ))
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Linking creates a pending meal plan task on the Nutrition tab so Daman can pick it up.
          </div>
        </div>
      )}
    </div>
  );
}
