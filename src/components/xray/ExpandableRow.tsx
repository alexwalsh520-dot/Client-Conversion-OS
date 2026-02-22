"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface ExpandableRowProps {
  title: string;
  subtitle?: string;
  badge?: { text: string; color: string; bg: string };
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function ExpandableRow({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: ExpandableRowProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-primary)",
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: 16,
          cursor: "pointer",
          background: "none",
          border: "none",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ChevronRight
            size={14}
            style={{
              color: "var(--text-muted)",
              transition: "transform 0.2s ease",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: badge.bg,
              color: badge.color,
            }}
          >
            {badge.text}
          </span>
        )}
      </button>
      <div
        style={{
          maxHeight: isOpen ? 1000 : 0,
          opacity: isOpen ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s ease, opacity 0.2s ease",
          padding: isOpen ? "0 16px 16px 42px" : "0 16px 0 42px",
        }}
      >
        {children}
      </div>
    </div>
  );
}
