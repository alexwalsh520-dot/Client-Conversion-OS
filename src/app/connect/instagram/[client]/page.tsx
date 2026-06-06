import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Instagram } from "lucide-react";
import {
  getInstagramClient,
  readInstagramSetupToken,
} from "@/lib/instagram-connections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect Instagram · CCOS",
  description: "Connect your Instagram professional account to CCOS.",
  robots: { index: false, follow: false, nocache: true },
};

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function StatusBox({
  kind,
  message,
}: {
  kind: "success" | "error";
  message: string;
}) {
  const success = kind === "success";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        border: `1px solid ${success ? "rgba(126, 211, 170, 0.34)" : "rgba(225, 108, 108, 0.34)"}`,
        borderRadius: 10,
        padding: 12,
        color: success ? "var(--success)" : "var(--danger)",
        background: success ? "rgba(126, 211, 170, 0.08)" : "rgba(225, 108, 108, 0.08)",
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      {success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <div>{message}</div>
    </div>
  );
}

export default async function InstagramConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { client: clientSlug } = await params;
  const query = await searchParams;
  const token = firstString(query.token) || "";
  const status = firstString(query.status);
  const message = firstString(query.message);
  const client = getInstagramClient(clientSlug);

  let tokenError = "";
  if (client && status !== "success") {
    try {
      readInstagramSetupToken(client.slug, token);
    } catch (err) {
      tokenError = err instanceof Error ? err.message : "This setup link is not valid.";
    }
  }

  const canConnect = Boolean(client && token && !tokenError);
  const startUrl =
    client && canConnect
      ? `/api/public/instagram-connect/start?client=${encodeURIComponent(client.slug)}&token=${encodeURIComponent(token)}`
      : "#";

  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="glass-static"
        style={{
          width: "100%",
          maxWidth: 680,
          padding: 24,
          borderRadius: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Instagram size={26} style={{ color: "var(--accent)" }} />
          <div>
            <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 800 }}>
              Connect Instagram
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 3 }}>
              {client ? `${client.label} setup` : "Setup link"}
            </div>
          </div>
        </div>

        {status === "success" ? (
          <StatusBox
            kind="success"
            message="Instagram is connected. You can close this page and tell the CCOS team it is done."
          />
        ) : (
          <>
            {(status === "error" || tokenError || !client) && (
              <div style={{ marginBottom: 14 }}>
                <StatusBox
                  kind="error"
                  message={message || tokenError || "This Instagram setup link is not valid."}
                />
              </div>
            )}

            <div style={{ color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.55, marginBottom: 18 }}>
              This lets CCOS track how fast your team replies to Instagram DMs. It does not give CCOS your Instagram password.
            </div>

            <div
              style={{
                border: "1px solid var(--border-primary)",
                borderRadius: 10,
                padding: 14,
                marginBottom: 18,
              }}
            >
              <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 750, marginBottom: 10 }}>
                Before you click connect
              </div>
              {[
                "Use the Facebook account that has full access to the Facebook Page tied to this Instagram.",
                "Make sure the Instagram account is a Business or Creator account.",
                "When Meta asks, select the right Facebook Page and Instagram account.",
                "Approve all permissions Meta shows for the CCOS app.",
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    gap: 9,
                    alignItems: "flex-start",
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    lineHeight: 1.45,
                    marginTop: 9,
                  }}
                >
                  <CheckCircle2 size={15} style={{ color: "var(--success)", marginTop: 1, flex: "0 0 auto" }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <a
              href={startUrl}
              aria-disabled={!canConnect}
              style={{
                display: "inline-flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 8,
                width: "100%",
                border: "1px solid var(--border-hover)",
                borderRadius: 8,
                padding: "13px 16px",
                color: canConnect ? "var(--bg-primary)" : "var(--text-muted)",
                background: canConnect ? "var(--accent)" : "var(--hover-bg-subtle)",
                fontSize: 15,
                fontWeight: 800,
                pointerEvents: canConnect ? "auto" : "none",
                textDecoration: "none",
              }}
            >
              <Instagram size={18} />
              Connect Instagram
            </a>

            <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, marginTop: 14 }}>
              If Meta does not show the right Instagram account, check that the Instagram is connected to a Facebook Page and that this Facebook login has full access.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
