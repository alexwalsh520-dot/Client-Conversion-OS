"use client";

/**
 * Daily Coacher row-icon for the Client Roster.
 *
 * Renders a sparkle by default and swaps to a spinning loader while the
 * parent <Link> is navigating. Without this, the Daily Coacher page does
 * 1-3 seconds of server-side work (Supabase fetch + transcript + summary)
 * before painting, which felt like a dead button to coaches and led to
 * spam-clicking.
 *
 * MUST be rendered as a child of <Link> from next/link. useLinkStatus is
 * scoped to its parent Link's pending state.
 */

import { useLinkStatus } from "next/link";
import { Sparkles, Loader2 } from "lucide-react";

export default function DailyCoacherIcon() {
  const { pending } = useLinkStatus();

  if (pending) {
    return (
      <>
        <Loader2 size={13} className="dc-icon-spin" />
        <style jsx>{`
          :global(.dc-icon-spin) {
            animation: dc-icon-spin-rot 0.7s linear infinite;
          }
          @keyframes dc-icon-spin-rot {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </>
    );
  }

  return <Sparkles size={13} />;
}
