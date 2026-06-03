"use client";

import { useRef, useState } from "react";

type Phase = "ready" | "preview" | "uploading" | "done" | "invalid" | "error";

const COLORS = {
  bg: "#0f1115",
  card: "#181b22",
  line: "#262b35",
  text: "#f3f4f6",
  sub: "#aab1bd",
  accent: "#e0b15e",
  accentInk: "#1a1205",
  danger: "#ef4444",
};

export default function RecordTestimonial({
  token,
  firstName,
  guide,
  initialState,
}: {
  token: string;
  firstName: string;
  guide: string[];
  initialState: "ready" | "done" | "invalid";
}) {
  const [phase, setPhase] = useState<Phase>(initialState);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pickVideo() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setPhase("preview");
    // Allow re-selecting the same file later
    e.target.value = "";
  }

  async function submit() {
    if (!file) return;
    setPhase("uploading");
    setProgress(0);
    setErrorMsg("");

    try {
      const presignRes = await fetch("/api/testimonials/video/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          filename: file.name || "testimonial.mp4",
          contentType: file.type || "video/mp4",
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not start the upload.");

      await putWithProgress(presign.uploadUrl, file, presign.headers || {}, setProgress);

      const completeRes = await fetch("/api/testimonials/video/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fileSize: file.size }),
      });
      const complete = await completeRes.json();
      if (!completeRes.ok) throw new Error(complete.error || "Could not finish the upload.");

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPhase("error");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        padding: "32px 18px 64px",
        fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="user"
        onChange={onFileChange}
        style={{ display: "none" }}
      />

      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        {phase === "invalid" ? (
          <Centered>
            <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>This link is not valid</h1>
            <p style={{ color: COLORS.sub, margin: 0, lineHeight: 1.6 }}>
              The testimonial link may be incorrect or has expired. Please reach out to your coach for a fresh link.
            </p>
          </Centered>
        ) : phase === "done" ? (
          <Centered>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>Thank you, {firstName}!</h1>
            <p style={{ color: COLORS.sub, margin: 0, lineHeight: 1.6 }}>
              Your testimonial has been received. We really appreciate you taking the time to share your story.
            </p>
          </Centered>
        ) : (
          <>
            <header style={{ marginBottom: 22 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
                Hi {firstName}, share your story
              </h1>
              <p style={{ color: COLORS.sub, margin: 0, fontSize: 15, lineHeight: 1.6 }}>
                Record a short video telling us about your journey. Film it in one take in a quiet, well lit spot,
                holding your phone steady. You can re-record as many times as you like before you submit.
              </p>
            </header>

            <section
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.line}`,
                borderRadius: 14,
                padding: "18px 18px 6px",
                marginBottom: 22,
              }}
            >
              <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.accent, margin: "0 0 12px" }}>
                What to talk about
              </h2>
              <ol style={{ margin: 0, padding: "0 0 0 20px" }}>
                {guide.map((line, i) => (
                  <li key={i} style={{ fontSize: 14.5, lineHeight: 1.55, color: COLORS.text, marginBottom: 12 }}>
                    {line}
                  </li>
                ))}
              </ol>
            </section>

            {previewUrl && (phase === "preview" || phase === "uploading" || phase === "error") && (
              <video
                src={previewUrl}
                controls
                playsInline
                style={{ width: "100%", borderRadius: 14, background: "#000", marginBottom: 18, border: `1px solid ${COLORS.line}` }}
              />
            )}

            {phase === "uploading" ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: COLORS.sub, margin: "0 0 10px", fontSize: 14 }}>
                  Uploading your testimonial... {progress}%
                </p>
                <div style={{ height: 8, background: COLORS.line, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: COLORS.accent, transition: "width 120ms linear" }} />
                </div>
                <p style={{ color: COLORS.sub, margin: "12px 0 0", fontSize: 12 }}>
                  Please keep this page open until it finishes.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {phase === "error" && (
                  <p style={{ color: COLORS.danger, fontSize: 14, margin: 0, textAlign: "center" }}>{errorMsg}</p>
                )}

                <button onClick={pickVideo} style={btn(phase === "ready")}>
                  {phase === "ready" ? "Record video" : "Record again"}
                </button>

                {file && (phase === "preview" || phase === "error") && (
                  <button onClick={submit} style={btn(true)}>
                    Submit testimonial
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
      {children}
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "15px 18px",
    fontSize: 16,
    fontWeight: 600,
    borderRadius: 12,
    cursor: "pointer",
    border: primary ? "none" : `1px solid ${COLORS.line}`,
    background: primary ? COLORS.accent : "transparent",
    color: primary ? COLORS.accentInk : COLORS.text,
  };
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}
