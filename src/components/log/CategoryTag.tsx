"use client";

const categoryConfig: Record<string, { bg: string; color: string }> = {
  ad_creative: { bg: "var(--accent-soft)", color: "var(--accent)" },
  dm_script: { bg: "var(--tyson-soft)", color: "var(--tyson)" },
  pricing: { bg: "var(--success-soft)", color: "var(--success)" },
  team: { bg: "var(--warning-soft)", color: "var(--warning)" },
  process: { bg: "var(--keith-soft)", color: "var(--keith)" },
  offer: { bg: "var(--danger-soft)", color: "var(--danger)" },
};

interface CategoryTagProps {
  category: string;
}

export default function CategoryTag({ category }: CategoryTagProps) {
  const config = categoryConfig[category] || {
    bg: "var(--bg-glass)",
    color: "var(--text-muted)",
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "3px 10px",
        borderRadius: 4,
        background: config.bg,
        color: config.color,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {category.replace(/_/g, " ")}
    </span>
  );
}
