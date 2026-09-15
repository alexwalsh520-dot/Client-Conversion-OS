"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };

export default function TabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname() ?? "";
  // The Today tab lives at /coaching-v3 (root). Match it exactly. Every
  // deeper tab matches when the current path starts with that href.
  return (
    <nav className="h3-tabs">
      {tabs.map((t) => {
        const active =
          t.href === "/coaching-v3"
            ? pathname === "/coaching-v3"
            : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} className={active ? "on" : ""}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
