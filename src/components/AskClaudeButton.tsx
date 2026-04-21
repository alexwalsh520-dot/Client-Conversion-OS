"use client";

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function AskClaudeButton() {
  const pathname = usePathname();

  if (pathname === "/login" || pathname === "/review" || pathname === "/voice-notes") {
    return null;
  }

  return (
    <button
      className="float-in"
      onClick={() => {
        // Phase 2: open chat panel
      }}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 40,
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: "var(--accent)",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 24px rgba(124, 92, 252, 0.3)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.08)";
        e.currentTarget.style.boxShadow =
          "0 4px 32px rgba(124, 92, 252, 0.5)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.boxShadow =
          "0 4px 24px rgba(124, 92, 252, 0.3)";
      }}
      title="Ask Claude"
    >
      <Sparkles size={22} color="white" />
    </button>
  );
}
