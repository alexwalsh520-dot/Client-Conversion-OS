"use client";

import { useHub } from "./HubShell";
import { Dot } from "./bits";
import type { Level } from "@/lib/coaching-v2/types";

/** A Today row. Click opens the peek drawer; the name is still a real link for a new tab. */
export default function ClientRow({ id, name, coach, health, text, num, showCoach }: { id: number; name: string; coach: string; health: Level; text: string; num: string; showCoach: boolean }) {
  const { openClient } = useHub();
  return (
    <div className={`h2-li ${showCoach ? "" : "nocoach"}`} role="button" tabIndex={0} onClick={() => openClient(id)} onKeyDown={(e) => { if (e.key === "Enter") openClient(id); }}>
      <Dot lvl={health} />
      <span className="who">{name}</span>
      {showCoach && <span className="co">{coach || "–"}</span>}
      <span className="why">{text}</span>
      <span className="num">{num}</span>
    </div>
  );
}
