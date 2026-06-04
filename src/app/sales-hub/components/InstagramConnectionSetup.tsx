"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface InstagramClientStatus {
  slug: "tyson" | "keith" | "lucy";
  clientKey: string;
  label: string;
  connected: boolean;
  instagramUserId: string | null;
  instagramUsername: string | null;
  facebookPageName: string | null;
  subscriptionStatus: string | null;
  subscriptionError: string | null;
  tokenStored: boolean;
  lastWebhookAt: string | null;
  connectedBy: string | null;
  updatedAt: string | null;
}

interface InstagramStatus {
  tableReady: boolean;
  tableError: string | null;
  env: {
    appIdConfigured: boolean;
    appSecretConfigured: boolean;
    appIdEnvName: string | null;
    appSecretEnvName: string | null;
    tokenEncryptionReady: boolean;
    webhookVerifyTokenReady: boolean;
    oauthMode: string;
    graphVersion: string;
    scopes: string[];
    redirectUri: string;
    webhookUrl: string;
  };
  clients: InstagramClientStatus[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function EnvChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 999,
        border: `1px solid ${ok ? "rgba(126, 211, 170, 0.32)" : "rgba(225, 196, 108, 0.35)"}`,
        padding: "5px 8px",
        color: ok ? "var(--success)" : "var(--warning)",
        fontSize: 11,
        fontWeight: 650,
      }}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {label}
    </span>
  );
}

export default function InstagramConnectionSetup() {
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await fetchJson<InstagramStatus>("/api/integrations/instagram/status"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Instagram setup");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  const connect = async (client: InstagramClientStatus) => {
    setConnecting(client.slug);
    setError("");
    try {
      const data = await fetchJson<{ url: string }>("/api/integrations/instagram/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client.slug }),
      });
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Instagram connect");
      setConnecting(null);
    }
  };

  if (loading) {
    return (
      <div className="glass-static" style={{ padding: 18, display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={16} className="spin" style={{ color: "var(--text-muted)" }} />
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading Instagram setup...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="glass-static" style={{ padding: 18, color: "var(--danger)", fontSize: 13 }}>
        {error || "Instagram setup could not load."}
      </div>
    );
  }

  const envReady =
    status.env.appIdConfigured &&
    status.env.appSecretConfigured &&
    status.env.tokenEncryptionReady &&
    status.env.webhookVerifyTokenReady &&
    status.tableReady;

  return (
    <div className="glass-static" style={{ padding: 16, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Instagram size={16} style={{ color: "var(--accent)" }} />
          <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 750 }}>
            Instagram DM Connection
          </div>
        </div>
        <button
          onClick={load}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--border-primary)",
            borderRadius: 6,
            background: "var(--hover-bg-subtle)",
            color: "var(--text-secondary)",
            padding: "6px 9px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <EnvChip ok={status.tableReady} label="DB tables" />
        <EnvChip ok={status.env.appIdConfigured} label="Meta App ID" />
        <EnvChip ok={status.env.appSecretConfigured} label="Meta App Secret" />
        <EnvChip ok={status.env.tokenEncryptionReady} label="Token encryption" />
        <EnvChip ok={status.env.webhookVerifyTokenReady} label="Webhook verify token" />
      </div>

      {!envReady && (
        <div
          style={{
            border: "1px solid rgba(225, 196, 108, 0.28)",
            borderRadius: 8,
            padding: 12,
            color: "var(--text-secondary)",
            fontSize: 12,
            lineHeight: 1.45,
            marginBottom: 12,
          }}
        >
          CCOS is not ready for Tyson to click connect yet. Set the missing env values, run the Instagram DB setup, then refresh this panel.
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <CopyRow
          label="Meta Redirect URL"
          value={status.env.redirectUri}
          copied={copied === "redirect"}
          onCopy={() => copyValue("redirect", status.env.redirectUri)}
        />
        <CopyRow
          label="Meta Webhook URL"
          value={status.env.webhookUrl}
          copied={copied === "webhook"}
          onCopy={() => copyValue("webhook", status.env.webhookUrl)}
        />
      </div>

      <div style={{ border: "1px solid var(--border-primary)", borderRadius: 8, overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1.2fr 1fr 1fr auto",
            gap: 12,
            minWidth: 760,
            padding: "10px 12px",
            color: "var(--text-muted)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div>Client</div>
          <div>Instagram</div>
          <div>Webhook</div>
          <div>Token</div>
          <div />
        </div>
        {status.clients.map((client) => (
          <div
            key={client.slug}
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1.2fr 1fr 1fr auto",
              gap: 12,
              minWidth: 760,
              alignItems: "center",
              padding: "12px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700 }}>
              {client.label}
            </div>
            <div style={{ color: client.connected ? "var(--success)" : "var(--text-secondary)", fontSize: 12 }}>
              {client.instagramUsername ? `@${client.instagramUsername}` : client.connected ? "Connected" : "Not connected"}
            </div>
            <div style={{ color: client.lastWebhookAt ? "var(--success)" : "var(--text-secondary)", fontSize: 12 }}>
              {formatDate(client.lastWebhookAt)}
            </div>
            <div style={{ color: client.tokenStored ? "var(--success)" : "var(--warning)", fontSize: 12 }}>
              {client.tokenStored ? "Stored" : "Missing"}
            </div>
            <button
              onClick={() => connect(client)}
              disabled={!envReady || connecting === client.slug}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid var(--border-primary)",
                borderRadius: 6,
                background: envReady ? "var(--accent-soft)" : "var(--hover-bg-subtle)",
                color: envReady ? "var(--accent)" : "var(--text-muted)",
                padding: "7px 10px",
                cursor: envReady ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 650,
                whiteSpace: "nowrap",
              }}
            >
              {connecting === client.slug ? <Loader2 size={12} className="spin" /> : <ExternalLink size={12} />}
              {client.connected ? "Reconnect" : "Connect"}
            </button>
          </div>
        ))}
      </div>

      <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>
        Mode: {status.env.oauthMode} / {status.env.graphVersion}. App env: {status.env.appIdEnvName || "missing"} /{" "}
        {status.env.appSecretEnvName || "missing"}. Scopes: {status.env.scopes.join(", ")}.
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        border: "1px solid var(--border-primary)",
        borderRadius: 8,
        padding: "8px 10px",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px" }}>
        {label}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
      <button
        onClick={onCopy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          border: "1px solid var(--border-primary)",
          borderRadius: 6,
          background: "var(--hover-bg-subtle)",
          color: copied ? "var(--success)" : "var(--text-secondary)",
          padding: "5px 8px",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 650,
        }}
      >
        <Copy size={11} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
