import Link from "next/link";
import type { HubClient, Level } from "@/lib/coaching-v2/hub";
import { LEVEL_LABEL } from "@/lib/coaching-v2/hub";

export function Dot({ lvl }: { lvl: Level }) {
  return <span className={`h2-dot ${lvl}`} aria-label={LEVEL_LABEL[lvl]} />;
}

export function StatusChip({ lvl }: { lvl: Level }) {
  return (
    <span className="h2-st">
      <Dot lvl={lvl} />
      {LEVEL_LABEL[lvl]}
    </span>
  );
}

export function ClientLink({ c, children }: { c: HubClient; children?: React.ReactNode }) {
  return <Link href={`/coaching-v2/clients/${c.id}`}>{children ?? c.name}</Link>;
}

export function fmtDays(n: number | null): string {
  if (n === null) return "–";
  return `${n}d`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
