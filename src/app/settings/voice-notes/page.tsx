"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Mic,
  PlayCircle,
  Settings2,
  Upload,
} from "lucide-react";
import {
  CreatorVoiceProfile,
  DEFAULT_CLIENT_KEY,
  DEFAULT_CREATOR_NAME,
  DEFAULT_CREATOR_SLUG,
  MAX_SCRIPT_CHARS,
  MAX_VOICE_FILES,
  VoiceNoteTemplate,
  buildVoiceNoteDraft,
  normalizeVoiceNoteText,
  slugifyVoiceProfile,
} from "@/lib/voice-notes";

interface ProfilesResponse {
  elevenLabsReady: boolean;
  defaults: {
    creatorName: string;
    slug: string;
    clientKey: string;
  };
  profiles: CreatorVoiceProfile[];
}

interface VoiceNoteResult {
  creatorName: string;
  script: string;
  fileName: string;
  mimeType: string;
  audioBase64: string;
}

const gridStyle: React.CSSProperties = {
  display: "grid",
  gap: 20,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  alignItems: "start",
};

const cardStyle: React.CSSProperties = {
  padding: 20,
  borderRadius: 16,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-card)",
  backdropFilter: "blur(14px)",
};

const compactButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-glass)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function VoiceNotesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  const [profiles, setProfiles] = useState<CreatorVoiceProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState("");
  const [elevenLabsReady, setElevenLabsReady] = useState(false);

  const [setupName, setSetupName] = useState(DEFAULT_CREATOR_NAME);
  const [setupSlug, setSetupSlug] = useState(DEFAULT_CREATOR_SLUG);
  const [setupClientKey, setSetupClientKey] = useState(DEFAULT_CLIENT_KEY);
  const [setupNotes, setSetupNotes] = useState("");
  const [existingVoiceId, setExistingVoiceId] = useState("");
  const [setupFiles, setSetupFiles] = useState<File[]>([]);
  const [confirmConsent, setConfirmConsent] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const [setupError, setSetupError] = useState("");

  const [creatorSlug, setCreatorSlug] = useState(DEFAULT_CREATOR_SLUG);
  const [template, setTemplate] = useState<VoiceNoteTemplate>("goal_clear");
  const [prospectName, setProspectName] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [goal, setGoal] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [currentSituation, setCurrentSituation] = useState("");
  const [callToAction, setCallToAction] = useState("");
  const [customScript, setCustomScript] = useState("");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [result, setResult] = useState<VoiceNoteResult | null>(null);
  const [audioUrl, setAudioUrl] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      setProfilesLoading(true);
      setProfilesError("");
      try {
        const res = await fetch("/api/voice-notes/profiles");
        const data = (await res.json()) as ProfilesResponse | { error?: string };
        if (!res.ok || !("profiles" in data)) {
          throw new Error(("error" in data && data.error) || "Failed to load voices");
        }

        if (!active) return;
        setProfiles(data.profiles || []);
        setElevenLabsReady(Boolean(data.elevenLabsReady));

        if ((data.profiles || []).length > 0) {
          setCreatorSlug((current) =>
            data.profiles.some((profile) => profile.slug === current)
              ? current
              : data.profiles[0].slug,
          );
        }
      } catch (error) {
        if (!active) return;
        setProfilesError(error instanceof Error ? error.message : "Failed to load voices");
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
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.slug === creatorSlug) || null,
    [profiles, creatorSlug],
  );

  const draftScript = useMemo(
    () =>
      buildVoiceNoteDraft({
        creatorName: selectedProfile?.creator_name || setupName,
        template,
        prospectName,
        instagramHandle,
        goal,
        painPoint,
        currentSituation,
        callToAction,
        customScript,
      }),
    [
      callToAction,
      currentSituation,
      customScript,
      goal,
      instagramHandle,
      painPoint,
      prospectName,
      selectedProfile?.creator_name,
      setupName,
      template,
    ],
  );

  const draftLength = draftScript.length;
  async function refreshProfiles() {
    setProfilesLoading(true);
    setProfilesError("");
    try {
      const res = await fetch("/api/voice-notes/profiles");
      const data = (await res.json()) as ProfilesResponse | { error?: string };
      if (!res.ok || !("profiles" in data)) {
        throw new Error(("error" in data && data.error) || "Failed to load voices");
      }
      setProfiles(data.profiles || []);
      setElevenLabsReady(Boolean(data.elevenLabsReady));
      if ((data.profiles || []).length > 0 && !data.profiles.some((profile) => profile.slug === creatorSlug)) {
        setCreatorSlug(data.profiles[0].slug);
      }
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : "Failed to load voices");
    } finally {
      setProfilesLoading(false);
    }
  }

  async function handleSetupSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSetupLoading(true);
    setSetupError("");
    setSetupMessage("");

    try {
      const formData = new FormData();
      formData.append("creatorName", setupName);
      formData.append("slug", slugifyVoiceProfile(setupSlug || setupName));
      formData.append("clientKey", normalizeVoiceNoteText(setupClientKey));
      formData.append("notes", setupNotes);
      formData.append("existingVoiceId", normalizeVoiceNoteText(existingVoiceId));
      formData.append("confirmConsent", String(confirmConsent));
      for (const file of setupFiles) {
        formData.append("files", file, file.name);
      }

      const res = await fetch("/api/voice-notes/profiles", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { error?: string; profile?: CreatorVoiceProfile };
      if (!res.ok) {
        throw new Error(data.error || "Voice setup failed");
      }

      setSetupMessage(
        data.profile?.status === "pending_verification"
          ? "Voice saved. Finish the verification step inside ElevenLabs before setters use it."
          : "Voice saved. Tyson is ready to use.",
      );
      setCreatorSlug(data.profile?.slug || DEFAULT_CREATOR_SLUG);
      setExistingVoiceId("");
      setSetupFiles([]);
      await refreshProfiles();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Voice setup failed");
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerateLoading(true);
    setGenerateError("");

    try {
      const res = await fetch("/api/voice-notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorSlug,
          template,
          prospectName,
          instagramHandle,
          goal,
          painPoint,
          currentSituation,
          callToAction,
          customScript: template === "custom" ? customScript : "",
        }),
      });

      const data = (await res.json()) as VoiceNoteResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Voice note failed");
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
      setGenerateError(error instanceof Error ? error.message : "Voice note failed");
    } finally {
      setGenerateLoading(false);
    }
  }

  async function copyScript() {
    if (!result?.script) return;
    await navigator.clipboard.writeText(result.script);
  }

  function downloadAudio() {
    if (!audioUrl || !result) return;
    const link = document.createElement("a");
    link.href = audioUrl;
    link.download = result.fileName;
    link.click();
  }

  return (
    <div className="fade-up">
      <div className="page-header">
        <h1 className="page-title">Voice Notes</h1>
        <p className="page-subtitle">
          Admin setup lives here. Setters should use the public Voice Notes tool.
        </p>
      </div>

      <div
        style={{
          ...cardStyle,
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            Setter link
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Share the public page below with setters. They do not need to open Settings.
          </div>
        </div>

        <Link href="/voice-notes" className="btn-primary">
          Open Public Voice Notes
        </Link>
      </div>

      <div style={gridStyle}>
        <section style={{ display: "grid", gap: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "var(--tyson-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mic size={18} style={{ color: "var(--tyson)" }} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>Setter Voice Note Builder</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                  Keep it short. Make it feel like Tyson talking right to the lead.
                </p>
              </div>
            </div>

            {profilesError && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "var(--danger-soft)",
                  color: "var(--danger)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <AlertCircle size={16} />
                {profilesError}
              </div>
            )}

            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div>
                  <label className="form-label">Creator Voice</label>
                  <select
                    className="form-input"
                    value={creatorSlug}
                    onChange={(event) => setCreatorSlug(event.target.value)}
                    disabled={profilesLoading || profiles.length === 0}
                  >
                    {profiles.length === 0 ? (
                      <option value="">No voices set yet</option>
                    ) : (
                      profiles.map((profile) => (
                        <option key={profile.id} value={profile.slug}>
                          {profile.creator_name} {profile.status === "pending_verification" ? "(verification needed)" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="form-label">Template</label>
                  <select
                    className="form-input"
                    value={template}
                    onChange={(event) => setTemplate(event.target.value as VoiceNoteTemplate)}
                  >
                    <option value="goal_clear">Goal Clear</option>
                    <option value="follow_up">Follow Up</option>
                    <option value="custom">Custom Script</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div>
                  <label className="form-label">Lead First Name</label>
                  <input
                    className="form-input"
                    value={prospectName}
                    onChange={(event) => setProspectName(event.target.value)}
                    placeholder="Sarah"
                  />
                </div>
                <div>
                  <label className="form-label">Instagram Handle</label>
                  <input
                    className="form-input"
                    value={instagramHandle}
                    onChange={(event) => setInstagramHandle(event.target.value)}
                    placeholder="@sarahfit"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Main Goal</label>
                <input
                  className="form-input"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Lose 20 pounds and feel good on camera"
                />
              </div>

              <div>
                <label className="form-label">What They Are Stuck On</label>
                <input
                  className="form-input"
                  value={painPoint}
                  onChange={(event) => setPainPoint(event.target.value)}
                  placeholder="They keep starting and stopping"
                />
              </div>

              <div>
                <label className="form-label">Extra Context</label>
                <textarea
                  className="form-input form-textarea"
                  rows={3}
                  value={currentSituation}
                  onChange={(event) => setCurrentSituation(event.target.value)}
                  placeholder="They said they work long days and never stay consistent on weekends"
                />
              </div>

              <div>
                <label className="form-label">Call To Action</label>
                <input
                  className="form-input"
                  value={callToAction}
                  onChange={(event) => setCallToAction(event.target.value)}
                  placeholder="Reply and tell me what you're doing now and where it's falling apart"
                />
              </div>

              {template === "custom" && (
                <div>
                  <label className="form-label">Custom Script</label>
                  <textarea
                    className="form-input form-textarea"
                    rows={5}
                    value={customScript}
                    onChange={(event) => setCustomScript(event.target.value)}
                    placeholder="Write the exact words you want Tyson to say."
                  />
                </div>
              )}

              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid var(--border-primary)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                    Script Preview
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: draftLength > MAX_SCRIPT_CHARS ? "var(--danger)" : "var(--text-muted)",
                    }}
                  >
                    {draftLength}/{MAX_SCRIPT_CHARS} chars
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}>
                  {draftScript || "Add the lead details above and your script will show here."}
                </p>
              </div>

              {generateError && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--danger-soft)",
                    color: "var(--danger)",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} />
                  {generateError}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  className="btn-primary"
                  onClick={handleGenerate}
                  disabled={
                    generateLoading ||
                    !selectedProfile ||
                    selectedProfile.status !== "ready" ||
                    draftLength === 0 ||
                    draftLength > MAX_SCRIPT_CHARS
                  }
                  style={{
                    opacity:
                      generateLoading ||
                      !selectedProfile ||
                      selectedProfile.status !== "ready" ||
                      draftLength === 0 ||
                      draftLength > MAX_SCRIPT_CHARS
                        ? 0.6
                        : 1,
                  }}
                >
                  {generateLoading ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      Building Voice Note...
                    </>
                  ) : (
                    <>
                      <PlayCircle size={14} />
                      Generate Tyson Voice Note
                    </>
                  )}
                </button>

                {profilesLoading && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                    <Loader2 size={14} className="spin" />
                    Loading voices...
                  </span>
                )}
              </div>
            </div>
          </div>

          {result && audioUrl && (
            <div style={{ ...cardStyle, borderColor: "rgba(126,201,160,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <CheckCircle2 size={18} style={{ color: "var(--success)" }} />
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, color: "var(--text-primary)" }}>Voice Note Ready</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                    Play it, download it, then send it from your normal DM workflow.
                  </p>
                </div>
              </div>

              <audio controls src={audioUrl} style={{ width: "100%", marginBottom: 16 }} />

              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid var(--border-primary)",
                  background: "rgba(255,255,255,0.02)",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>
                  Spoken Script
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" }}>{result.script}</p>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button style={compactButtonStyle} onClick={copyScript}>
                  <Copy size={14} />
                  Copy Script
                </button>
                <button style={compactButtonStyle} onClick={downloadAudio}>
                  <Download size={14} />
                  Download MP3
                </button>
              </div>
            </div>
          )}
        </section>

        <aside style={{ display: "grid", gap: 20 }}>
          {isAdmin && (
            <form onSubmit={handleSetupSubmit} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Settings2 size={18} style={{ color: "var(--accent)" }} />
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, color: "var(--text-primary)" }}>Creator Setup</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                    Start with Tyson. Add the next creators here later.
                  </p>
                </div>
              </div>

              {!elevenLabsReady && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--danger-soft)",
                    color: "var(--danger)",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} />
                  Add `ELEVENLABS_API_KEY` before you try to clone a voice.
                </div>
              )}

              {setupError && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--danger-soft)",
                    color: "var(--danger)",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} />
                  {setupError}
                </div>
              )}

              {setupMessage && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--success-soft)",
                    color: "var(--success)",
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <CheckCircle2 size={16} />
                  {setupMessage}
                </div>
              )}

              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label className="form-label">Creator Name</label>
                  <input
                    className="form-input"
                    value={setupName}
                    onChange={(event) => {
                      setSetupName(event.target.value);
                      if (!setupSlug || setupSlug === DEFAULT_CREATOR_SLUG) {
                        setSetupSlug(slugifyVoiceProfile(event.target.value));
                      }
                    }}
                  />
                </div>

                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <div>
                    <label className="form-label">Slug</label>
                    <input
                      className="form-input"
                      value={setupSlug}
                      onChange={(event) => setSetupSlug(slugifyVoiceProfile(event.target.value))}
                      placeholder="tyson"
                    />
                  </div>
                  <div>
                    <label className="form-label">Client Key</label>
                    <input
                      className="form-input"
                      value={setupClientKey}
                      onChange={(event) => setSetupClientKey(event.target.value)}
                      placeholder="tyson_sonnek"
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label">Voice Notes</label>
                  <textarea
                    className="form-input form-textarea"
                    rows={3}
                    value={setupNotes}
                    onChange={(event) => setSetupNotes(event.target.value)}
                    placeholder="Short notes like tone, words to avoid, or how Tyson usually talks."
                  />
                </div>

                <div>
                  <label className="form-label">Existing ElevenLabs Voice ID</label>
                  <input
                    className="form-input"
                    value={existingVoiceId}
                    onChange={(event) => setExistingVoiceId(event.target.value)}
                    placeholder="Optional. Paste this if Tyson is already cloned in ElevenLabs."
                  />
                </div>

                <div>
                  <label className="form-label">Upload Voice Files</label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px dashed var(--border-hover)",
                      background: "rgba(255,255,255,0.02)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-primary)" }}>
                      <Upload size={14} />
                      Add up to {MAX_VOICE_FILES} clean Tyson samples
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Use MP3, WAV, M4A, or similar. Short, clean talking clips work best.
                    </span>
                    <input
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4"
                      multiple
                      style={{ display: "none" }}
                      onChange={(event) => setSetupFiles(Array.from(event.target.files || []).slice(0, MAX_VOICE_FILES))}
                    />
                  </label>
                  {setupFiles.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                      {setupFiles.map((file) => file.name).join(", ")}
                    </div>
                  )}
                </div>

                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={confirmConsent}
                    onChange={(event) => setConfirmConsent(event.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  Tyson gave permission to use these voice files for AI voice notes.
                </label>

                <button
                  className="btn-primary"
                  type="submit"
                  disabled={setupLoading || !confirmConsent || !elevenLabsReady}
                  style={{
                    opacity: setupLoading || !confirmConsent || !elevenLabsReady ? 0.6 : 1,
                  }}
                >
                  {setupLoading ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      Saving Voice...
                    </>
                  ) : (
                    <>
                      <Mic size={14} />
                      Save Tyson Voice
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          <div style={cardStyle}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, color: "var(--text-primary)" }}>Voice Library</h2>
            {profilesLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                <Loader2 size={14} className="spin" />
                Loading voices...
              </div>
            ) : profiles.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                No creator voices are saved yet. Set up Tyson first.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid var(--border-primary)",
                      background: profile.slug === DEFAULT_CREATOR_SLUG ? "var(--tyson-soft)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{profile.creator_name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          `{profile.slug}` • {profile.sample_count || 0} sample file{profile.sample_count === 1 ? "" : "s"}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          textTransform: "uppercase",
                          color: profile.status === "ready" ? "var(--success)" : "var(--warning)",
                        }}
                      >
                        {profile.status === "ready" ? "Ready" : "Verify"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, color: "var(--text-primary)" }}>Setter Playbook</h2>
            <div style={{ display: "grid", gap: 10, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              <div>1. Open this page and choose Tyson.</div>
              <div>2. Add the lead’s first name, goal, and what they are stuck on.</div>
              <div>3. Keep the note short. Ask one clear question.</div>
              <div>4. Hit generate, listen once, then download the MP3.</div>
              <div>5. Send it through your normal DM workflow and wait for the reply.</div>
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
              Need the full handoff steps? Share the SOP at{" "}
              <span style={{ color: "var(--accent)" }}>/docs/Voice-Notes-SOP.md</span>.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
