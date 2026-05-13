"use client";

/**
 * Renders a file-type icon for a SOP based on its MIME type. Picks an
 * appropriate lucide icon and tints it with a distinct color so the
 * library cards are scannable at a glance.
 */

import {
  FileText,
  FileSpreadsheet,
  FileImage,
  Presentation,
  File as FileIcon,
} from "lucide-react";

interface Props {
  fileType: string | null;
  size?: number;
}

interface IconSpec {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  background: string;
}

function specForFileType(fileType: string | null): IconSpec {
  if (!fileType) return { Icon: FileIcon, color: "var(--text-muted)", background: "var(--bg-glass)" };
  if (fileType === "application/pdf") {
    return { Icon: FileText, color: "var(--danger)", background: "var(--danger-soft)" };
  }
  if (fileType.includes("word") || fileType === "text/plain" || fileType === "text/markdown") {
    return { Icon: FileText, color: "var(--keith)", background: "var(--keith-soft)" };
  }
  if (fileType.includes("sheet") || fileType.includes("excel")) {
    return { Icon: FileSpreadsheet, color: "var(--success)", background: "var(--success-soft)" };
  }
  if (fileType.includes("presentation") || fileType.includes("powerpoint")) {
    return { Icon: Presentation, color: "var(--warning)", background: "var(--warning-soft)" };
  }
  if (fileType.startsWith("image/")) {
    return { Icon: FileImage, color: "var(--tyson)", background: "var(--tyson-soft)" };
  }
  return { Icon: FileIcon, color: "var(--text-muted)", background: "var(--bg-glass)" };
}

export default function SopFileIcon({ fileType, size = 20 }: Props) {
  const { Icon, color, background } = specForFileType(fileType);
  const padding = Math.round(size * 0.5);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background,
        color,
        borderRadius: 8,
        padding,
        flexShrink: 0,
      }}
    >
      <Icon size={size} color={color} />
    </span>
  );
}
