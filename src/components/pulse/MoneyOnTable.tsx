"use client";

interface MoneyOnTableProps {
  total: number;
  biggestLever: string;
}

export default function MoneyOnTable({ total, biggestLever }: MoneyOnTableProps) {
  const formatted = `$${Math.round(total).toLocaleString()}/mo`;

  return (
    <div
      className="glass glow-accent"
      style={{
        padding: "40px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 2,
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
        className="fade-up"
      >
        You&apos;re leaving on the table
      </div>
      <div
        className="gradient-text fade-up-delay-1"
        style={{
          fontSize: 56,
          fontWeight: 800,
          letterSpacing: "-2px",
          lineHeight: 1.1,
        }}
      >
        {formatted}
      </div>
      <div
        className="fade-up-delay-2"
        style={{
          fontSize: 16,
          color: "var(--text-secondary)",
          marginTop: 16,
          maxWidth: 600,
          margin: "16px auto 0",
          lineHeight: 1.5,
        }}
      >
        {biggestLever}
      </div>
    </div>
  );
}
