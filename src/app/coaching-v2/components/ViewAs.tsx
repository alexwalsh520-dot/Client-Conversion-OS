"use client";

import { useRouter } from "next/navigation";

/** Admin only. Switches the whole hub to what one coach sees, via a cookie the read model honors. */
export default function ViewAs({ coaches, current }: { coaches: string[]; current: string | null }) {
  const router = useRouter();
  const set = (v: string) => {
    document.cookie = v ? `ccos-v2-as=${encodeURIComponent(v)}; path=/; max-age=31536000` : "ccos-v2-as=; path=/; max-age=0";
    router.refresh();
  };
  return (
    <span className="h2-seg">
      <button className={current ? "" : "on"} onClick={() => set("")}>Manager</button>
      <select value={current ?? ""} onChange={(e) => set(e.target.value)} style={{ background: "none", border: "none", color: current ? "var(--text-primary)" : "var(--text-muted)", fontFamily: "inherit", fontSize: 12, padding: "5px 6px", cursor: "pointer" }}>
        <option value="">View as coach</option>
        {coaches.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </span>
  );
}
