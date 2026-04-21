"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  Mic,
  PlayCircle,
  Send,
} from "lucide-react";
import {
  VOICE_NOTE_ENVIRONMENTS,
  VoiceNoteEnvironment,
  normalizeInstagramUsername,
  normalizeVoiceNoteText,
} from "@/lib/voice-notes";

interface PublicVoiceProfile {
  id: string;
  slug: string;
  creator_name: string;
}

interface PublicProfilesResponse {
  elevenLabsReady: boolean;
  instagramSendReady: boolean;
  profiles: PublicVoiceProfile[];
}

interface GeneratedVoiceNoteResult {
  creatorName: string;
  creatorSlug: string;
  fileName: string;
  mimeType: string;
  script: string;
  audioBase64: string;
}

const shellStyle: React.CSSProperties = {
  minHeight: "calc(100vh - 64px)",
  display: "grid",
  placeItems: "center",
};

const wrapStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  display: "grid",
  gap: 20,
};

const cardStyle: React.CSSProperties = {
  padding: 24,
  borderRadius: 20,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-card)",
  backdropFilter: "blur(14px)",
};

const actionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 16px",
  borderRadius: 12,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-glass)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default function PublicVoiceNotesPage() {
  const [profiles, setProfiles] = useState<PublicVoiceProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState("");
  const [elevenLabsReady, setElevenLabsReady] = useState(false);
  const [instagramSendReady, setInstagramSendReady] = useState(false);

  const [creatorSlug, setCreatorSlug] = useState("");
  const [environment, setEnvironment] = useState<VoiceNoteEnvironment>("car");
  const [instagramUsername, setInstagramUsername] = useState("");
  const [message, setMessage] = useState("");

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [result, setResult] = useState<GeneratedVoiceNoteResult | null>(null);
  const [audioUrl, setAudioUrl] = useState("");

  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      setProfilesLoading(true);
      setProfilesError("");

      try {
        const res = await fetch("/api/public/voice-notes/profiles");
        const data = (await res.json()) as PublicProfilesResponse & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || "Failed to load creator voices");
        }

        if (!active) return;
        setProfiles(data.profiles || []);
        setElevenLabsReady(Boolean(data.elevenLabsReady));
        setInstagramSendReady(Boolean(data.instagramSendReady));
        setCreatorSlug((current) => current || data.profiles?.[0]?.slug || "");
      } catch (error) {
        if (!active) return;
        setProfilesError(error instanceof Error ? error.message : "Failed to load creator voices");
      } finally {
        if (active) setProfilesLoading(false);
      }
    }

    void loadProfiles();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const messageLength = normalizeVoiceNoteText(message).length;

  async function handleGenerate() {
    setGenerateLoading(true);
    setGenerateError("");
    setSendError("");
    setSendSuccess("");

    try {
      const res = await fetch("/api/public/voice-notes/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creatorSlug,
          environment,
          instagramUsername: normalizeInstagramUsername(instagramUsername),
          message: normalizeVoiceNoteText(message),
        }),
      });

      const data = (await res.json()) as GeneratedVoiceNoteResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Voice note generation failed");
      }

      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      const binary = Uint8Array.from(atob(data.audioBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([binary], { type: data.mimeType });
      const nextAudioUrl = URL.createObjectURL(blob);

      setAudioUrl(nextAudioUrl);
      setResult(data);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Voice note generation failed");
    } finally {
      setGenerateLoading(false);
    }
  }

  function handleDownload() {
    if (!audioUrl || !result) return;
    const link = document.createElement("a");
    link.href = audioUrl;
    link.download = result.fileName;
    link.click();
  }

  async function handleSend() {
    if (!result) return;

    setSendLoading(true);
    setSendError("");
    setSendSuccess("");

    try {
      const res = await fetch("/api/public/voice-notes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creatorSlug,
          environment,
          instagramUsername: normalizeInstagramUsername(instagramUsername),
          message: normalizeVoiceNoteText(message),
          audioBase64: result.audioBase64,
          fileName: result.fileName,
          mimeType: result.mimeType,
          script: result.script,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        messageId?: string;
        recipient?: { username?: string };
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Instagram send failed");
      }

      setSendSuccess(`Sent to @${data.recipient?.username || normalizeInstagramUsername(instagramUsername)}.`);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Instagram send failed");
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div className="fade-up" style={shellStyle}>
      <div style={wrapStyle}>
        <section style={cardStyle} className="glass">
          <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                background: "var(--tyson-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Mic size={24} style={{ color: "var(--tyson)" }} />
            </div>

            <div>
              <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.05, color: "var(--text-primary)" }}>
                Voice Notes
              </h1>
              <p style={{ margin: "8px 0 0", fontSize: 15, color: "var(--text-muted)", maxWidth: 640 }}>
                Pick the creator. Pick the vibe. Type the message. Hit generate. Preview it. Then send it if the Instagram contact is already linked.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              marginBottom: 16,
            }}
          >
            <div>
              <label className="form-label">Creator</label>
              <select
                className="form-input"
                value={creatorSlug}
                onChange={(event) => setCreatorSlug(event.target.value)}
                disabled={profilesLoading || profiles.length === 0}
              >
                {profiles.length === 0 ? (
                  <option value="">No creator voices ready yet</option>
                ) : (
                  profiles.map((profile) => (
                    <option key={profile.id} value={profile.slug}>
                      {profile.creator_name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="form-label">Environment</label>
              <select
                className="form-input"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as VoiceNoteEnvironment)}
              >
                {VOICE_NOTE_ENVIRONMENTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">Instagram Username</label>
              <input
                className="form-input"
                value={instagramUsername}
                onChange={(event) => setInstagramUsername(event.target.value)}
                placeholder="@leadname"
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="form-label">Message</label>
            <textarea
              className="form-input form-textarea"
              rows={7}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Hey Sarah, I saw your message. If your goal is to lose 15 pounds before summer, tell me what feels hardest right now."
            />
            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <span>
                The environment changes delivery a little. It does not add real car, walk, or gym background noise yet.
              </span>
              <span style={{ color: messageLength > 420 ? "var(--danger)" : "var(--text-muted)" }}>
                {messageLength}/420
              </span>
            </div>
          </div>

          {profilesError && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--danger-soft)",
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <AlertCircle size={16} />
              {profilesError}
            </div>
          )}

          {!elevenLabsReady && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--danger-soft)",
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <AlertCircle size={16} />
              ElevenLabs is not connected yet.
            </div>
          )}

          {generateError && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--danger-soft)",
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              <AlertCircle size={16} />
              {generateError}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={
              generateLoading ||
              !creatorSlug ||
              !normalizeVoiceNoteText(message) ||
              messageLength > 420 ||
              !elevenLabsReady
            }
            style={{
              opacity:
                generateLoading ||
                !creatorSlug ||
                !normalizeVoiceNoteText(message) ||
                messageLength > 420 ||
                !elevenLabsReady
                  ? 0.6
                  : 1,
            }}
          >
            {generateLoading ? (
              <>
                <Loader2 size={14} className="spin" />
                Generating...
              </>
            ) : (
              <>
                <PlayCircle size={14} />
                Generate Voice Note
              </>
            )}
          </button>
        </section>

        {result && audioUrl && (
          <section style={cardStyle} className="glass">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <CheckCircle2 size={18} style={{ color: "var(--success)" }} />
              <div>
                <h2 style={{ margin: 0, fontSize: 20, color: "var(--text-primary)" }}>Preview Ready</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                  Play it first. Then download it or send it.
                </p>
              </div>
            </div>

            <audio controls src={audioUrl} style={{ width: "100%", marginBottom: 16 }} />

            <div
              style={{
                marginBottom: 16,
                padding: 14,
                borderRadius: 14,
                border: "1px solid var(--border-primary)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Spoken Script
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}>
                {result.script}
              </p>
            </div>

            {sendError && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <AlertCircle size={16} />
                {sendError}
              </div>
            )}

            {sendSuccess && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--success-soft)",
                  color: "var(--success)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <CheckCircle2 size={16} />
                {sendSuccess}
              </div>
            )}

            {!instagramSendReady && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(250,204,21,0.12)",
                  color: "var(--warning)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <AlertCircle size={16} />
                Instagram send is not connected yet. Download still works.
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button style={actionButtonStyle} onClick={handleDownload}>
                <Download size={14} />
                Download MP3
              </button>

              <button
                className="btn-primary"
                onClick={handleSend}
                disabled={
                  sendLoading ||
                  !instagramSendReady ||
                  !normalizeInstagramUsername(instagramUsername)
                }
                style={{
                  opacity:
                    sendLoading ||
                    !instagramSendReady ||
                    !normalizeInstagramUsername(instagramUsername)
                      ? 0.6
                      : 1,
                }}
              >
                {sendLoading ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Send on Instagram
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
