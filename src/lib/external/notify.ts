// Ops visibility for the external content worker (Jeremy/Utari). Every external delivery — and every
// rejection — posts one line to the same channel the daily recap uses, so a silent worker outage is
// visible BEFORE the 6am internal fallback quietly covers for it. Fire-and-forget: a Slack failure
// never affects the API response, and if Slack isn't configured this is a no-op.

import { postToSlack, getSalesManagerChannel } from "@/lib/slack";

function fire(text: string): void {
  const channel = getSalesManagerChannel();
  if (!channel) return;
  // Detached — the POST handler never waits on Slack and never fails because of it.
  postToSlack(channel, text).catch((e) => console.error("[external-notify]", e instanceof Error ? e.message : e));
}

export function notifyCarouselDelivery(creator: string, forDate: string, written: number, topics: string[]): void {
  const list = topics.filter(Boolean).slice(0, 5).join(", ");
  fire(`✅ Jeremy delivered ${written}/5 carousels for *${creator}* (${forDate})${list ? ` — ${list}` : ""}`);
}

export function notifyPlaybookDelivery(creator: string, version: number): void {
  fire(`✅ Jeremy delivered a new *${creator}* playbook (v${version})`);
}

// A rejected/failed push — distinct wording so it reads as a problem, not a delivery.
export function notifyExternalRejected(kind: "carousels" | "playbook", creator: string, reason: string): void {
  fire(`⚠️ Jeremy ${kind} push REJECTED for *${creator || "unknown"}* — ${reason}`);
}
