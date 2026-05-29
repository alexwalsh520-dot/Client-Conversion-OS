"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Folder, ImagePlus, Upload, Video, X } from "lucide-react";

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
}

interface FolderDetail {
  id: string;
  name: string;
  folderType: "design" | "media";
}

interface UploadedMedia {
  id: string;
  filename: string;
  kind: "image" | "video";
  folderId: string | null;
  url: string;
  thumbnailUrl?: string | null;
}

const brand = {
  bg: "#0a0a0a",
  panel: "#111111",
  panel2: "#151515",
  border: "#252525",
  text: "#f0f0f0",
  text2: "#a8a8a8",
  text3: "#6d6d6d",
  gold: "#d4b27a",
  goldSoft: "rgba(212,178,122,0.09)",
  danger: "#f87171",
};

function getUploadContentType(file: File) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "mov" || ext === "qt") return "video/quicktime";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function isSupportedMedia(file: File) {
  const contentType = getUploadContentType(file);
  return contentType.startsWith("image/") || contentType.startsWith("video/");
}

async function makeVideoPosterFile(file: File): Promise<File | null> {
  if (typeof document === "undefined" || !getUploadContentType(file).startsWith("video/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video preview failed"));
      video.src = url;
    });
    video.currentTime = Math.min(0.25, video.duration || 0.25);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 600);
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(320, video.videoWidth || 720);
    canvas.height = Math.max(180, video.videoHeight || 1280);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!blob) return null;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-poster.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadRawMediaFile(file: File, folderId: string) {
  const contentType = getUploadContentType(file);
  const presignRes = await fetch("/api/studio-2/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      fileSize: file.size,
      folderId,
    }),
  });

  if (!presignRes.ok) throw new Error("Upload could not start");
  const presign = await presignRes.json() as {
    key: string;
    publicUrl: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  };

  const uploadRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || { "Content-Type": contentType },
    body: file,
  });

  if (!uploadRes.ok) throw new Error("Upload failed");
  return { ...presign, contentType };
}

async function uploadClientMedia(file: File, folderId: string) {
  const contentType = getUploadContentType(file);
  const uploaded = await uploadRawMediaFile(file, folderId);
  let thumbnailUrl: string | null = null;

  if (contentType.startsWith("video/")) {
    const posterFile = await makeVideoPosterFile(file);
    if (posterFile) {
      try {
        const poster = await uploadRawMediaFile(posterFile, folderId);
        thumbnailUrl = poster.publicUrl;
      } catch {
        thumbnailUrl = null;
      }
    }
  }

  const completeRes = await fetch("/api/studio-2/media/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: uploaded.key,
      publicUrl: uploaded.publicUrl,
      filename: file.name,
      contentType,
      fileSize: file.size,
      folderId,
      thumbnailUrl,
    }),
  });

  if (!completeRes.ok) throw new Error("Upload could not be saved");
}

export default function Studio2ClientUploadPage() {
  const params = useParams<{ folderId: string }>();
  const folderId = params.folderId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [status, setStatus] = useState("Loading upload folder...");
  const [uploading, setUploading] = useState(false);
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);

  const completedCount = useMemo(() => queue.filter((item) => item.status === "done").length, [queue]);
  const hasQueuedFiles = queue.some((item) => item.status === "queued" || item.status === "error");
  const uploadedImageCount = uploadedMedia.filter((item) => item.kind === "image").length;
  const uploadedVideoCount = uploadedMedia.filter((item) => item.kind === "video").length;

  const refreshUploadedMedia = useCallback(async () => {
    try {
      const res = await fetch("/api/studio-2/media", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { media?: UploadedMedia[] };
      setUploadedMedia((data.media || []).filter((item) => item.folderId === folderId));
    } catch {
      setUploadedMedia([]);
    }
  }, [folderId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/studio-2/folders/${folderId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Folder not found");
        return res.json() as Promise<{ folder?: FolderDetail }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!data.folder || data.folder.folderType !== "media") {
          throw new Error("This upload link is not connected to a media folder");
        }
        setFolder(data.folder);
        setStatus("");
        void refreshUploadedMedia();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus(err instanceof Error ? err.message : "Upload link is not available.");
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, refreshUploadedMedia]);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files?.length) return;
    const supported = Array.from(files).filter(isSupportedMedia);
    if (!supported.length) {
      setStatus("Only photos and videos can be uploaded here.");
      return;
    }
    setQueue((prev) => [
      ...prev,
      ...supported.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        status: "queued" as const,
      })),
    ]);
    setStatus("");
  }, []);

  const uploadQueue = useCallback(async () => {
    if (!folder || uploading) return;
    const targets = queue.filter((item) => item.status === "queued" || item.status === "error");
    if (!targets.length) return;
    setUploading(true);
    setStatus(`Uploading ${targets.length} file${targets.length === 1 ? "" : "s"}...`);

    for (const item of targets) {
      setQueue((prev) => prev.map((queued) => queued.id === item.id ? { ...queued, status: "uploading" } : queued));
      try {
        await uploadClientMedia(item.file, folder.id);
        setQueue((prev) => prev.map((queued) => queued.id === item.id ? { ...queued, status: "done" } : queued));
        void refreshUploadedMedia();
      } catch {
        setQueue((prev) => prev.map((queued) => queued.id === item.id ? { ...queued, status: "error" } : queued));
      }
    }

    setUploading(false);
    setStatus("Upload complete.");
    void refreshUploadedMedia();
  }, [folder, queue, refreshUploadedMedia, uploading]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: brand.bg,
        color: brand.text,
        fontFamily: "var(--font-geist-sans), Inter, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <section
        style={{
          width: "min(760px, 100%)",
          border: `1px solid ${brand.border}`,
          borderRadius: 14,
          background: brand.panel,
          boxShadow: "0 28px 90px rgba(0,0,0,0.42)",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: brand.goldSoft,
              color: brand.gold,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Folder size={21} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: brand.text3, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 }}>
              Client media upload
            </div>
            <h1 style={{ margin: "3px 0 0", fontSize: 26, lineHeight: 1.15, fontWeight: 760 }}>
              {folder?.name || "Studio 2.0"}
            </h1>
          </div>
        </div>

        {folder && (
          <div
            style={{
              border: `1px solid ${brand.border}`,
              borderRadius: 12,
              background: brand.panel2,
              padding: 12,
              marginBottom: 16,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ color: brand.text2, fontSize: 13, fontWeight: 760 }}>
                Uploaded to this folder
              </div>
              <div style={{ color: brand.gold, fontSize: 12, fontWeight: 760 }}>
                {uploadedMedia.length} total · {uploadedImageCount} image{uploadedImageCount === 1 ? "" : "s"} · {uploadedVideoCount} video{uploadedVideoCount === 1 ? "" : "s"}
              </div>
            </div>
            {uploadedMedia.length > 0 && (
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                {uploadedMedia.slice(0, 18).map((item) => (
                  <div
                    key={item.id}
                    title={item.filename}
                    style={{
                      width: 72,
                      flex: "0 0 72px",
                      border: `1px solid ${brand.border}`,
                      borderRadius: 9,
                      background: brand.bg,
                      overflow: "hidden",
                    }}
                  >
                    {item.thumbnailUrl || item.kind === "image" ? (
                      <img
                        src={item.thumbnailUrl || item.url}
                        alt=""
                        style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div style={{ width: "100%", aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", color: brand.text3 }}>
                        <Video size={18} />
                      </div>
                    )}
                    <div style={{ padding: "5px 6px", color: brand.text3, fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.filename}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: "none" }}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropActive(true);
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (!nextTarget || !event.currentTarget.contains(nextTarget)) setDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            addFiles(event.dataTransfer.files);
          }}
          disabled={!folder}
          style={{
            width: "100%",
            minHeight: 210,
            border: `2px dashed ${dropActive ? brand.gold : "rgba(255,255,255,0.16)"}`,
            borderRadius: 12,
            background: dropActive ? brand.goldSoft : brand.panel2,
            color: brand.text2,
            cursor: folder ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <Upload size={31} />
          <span style={{ fontSize: 16, fontWeight: 760 }}>Drop photos or videos here</span>
          <span style={{ fontSize: 13, color: brand.text3 }}>or click to choose files</span>
        </button>

        {queue.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
            {queue.map((item) => {
              const contentType = getUploadContentType(item.file);
              const isVideo = contentType.startsWith("video/");
              return (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 42,
                    border: `1px solid ${brand.border}`,
                    borderRadius: 9,
                    background: brand.panel2,
                    padding: "0 10px",
                    color: brand.text2,
                    fontSize: 13,
                  }}
                >
                  {isVideo ? <Video size={16} /> : <ImagePlus size={16} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.file.name}</span>
                  {item.status === "done" && <CheckCircle2 size={17} color={brand.gold} />}
                  {item.status === "error" && <AlertCircle size={17} color={brand.danger} />}
                  {item.status === "uploading" && <span style={{ color: brand.gold, fontSize: 12 }}>Uploading</span>}
                  {item.status === "queued" && (
                    <button
                      type="button"
                      aria-label="Remove file"
                      onClick={() => setQueue((prev) => prev.filter((queued) => queued.id !== item.id))}
                      style={{
                        width: 26,
                        height: 26,
                        border: "none",
                        borderRadius: 7,
                        background: "transparent",
                        color: brand.text3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 18 }}>
          <div style={{ color: status === "Upload complete." ? brand.gold : brand.text3, fontSize: 13 }}>
            {status || `${queue.length} file${queue.length === 1 ? "" : "s"} ready`}
            {completedCount > 0 && status !== "Upload complete." ? ` - ${completedCount} uploaded` : ""}
          </div>
          <button
            type="button"
            disabled={!folder || !hasQueuedFiles || uploading}
            onClick={() => void uploadQueue()}
            style={{
              height: 42,
              border: "none",
              borderRadius: 8,
              background: brand.gold,
              color: brand.bg,
              opacity: folder && hasQueuedFiles && !uploading ? 1 : 0.42,
              cursor: folder && hasQueuedFiles && !uploading ? "pointer" : "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "0 16px",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 760,
            }}
          >
            <Upload size={15} />
            {uploading ? "Uploading..." : "Upload media"}
          </button>
        </div>
      </section>
    </main>
  );
}
