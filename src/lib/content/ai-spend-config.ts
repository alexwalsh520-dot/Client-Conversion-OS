// AI SPEND SWITCHES — which paid buyer-DNA passes are allowed to run.
//
// Every flag here maps 1:1 to a line in the `ai_usage` table, so what this file turns off is
// exactly what stops appearing on the Anthropic bill. Owner decision, Aug 2026, after the
// monthly spend reached ~$494 (see the audit that produced this file).
//
// Flipping a flag back to `true` fully restores the pass — nothing was deleted, and the routes,
// prompts and tables are all still in place. That is deliberate: these are cost decisions, not
// architectural ones, and they should be cheap to revisit.

// `buyer-dna-grade` — scores each of the creator's IG posts against the locked ICP.
// Was ~$26/mo (2,263 calls). OFF.
// KNOCK-ON: `content_grades` stops gaining rows. The Buyers tab, the content studio, the
// content calendar and the shift brief all read that table — they keep showing grades for
// posts already scored, but NEW posts stay ungraded. The shift brief in particular is built
// from "recent scored posts", so its sample stops refreshing.
export const POST_GRADING_ENABLED = false;

// `buyer-dna-idea-grade` — a second pass that ranks each video idea against the trend brief.
// Was ~$15/mo (572 calls). OFF.
// KNOCK-ON: video ideas are still generated (that pass is kept); they simply arrive unranked,
// so the Playbook shows them in build order rather than trend-graded order.
export const IDEA_TREND_GRADING_ENABLED = false;

// `buyer-dna-trends` — weekly live web search for what is working on social right now.
// Was ~$2/mo (11 calls). OFF.
// KNOCK-ON: `content_trend_briefs` stops gaining versions. The playbook (kept) reads the
// CURRENT brief and is null-safe, so it keeps building — but from a brief frozen at its last
// value, which drifts further out of date every week it stays off.
export const TREND_BRIEFS_ENABLED = false;

// `buyer-dna-carousels` — the daily carousel set. Kept, but narrowed on both axes: fewer per
// day (see CAROUSELS_PER_DAY in ./carousel-config) and only for the creators listed here.
// Tyson was dropped from carousels by owner decision; Jake is the only one who gets them.
// Matched against the creator registry key (lib/creators.ts).
export const CAROUSEL_CREATORS: readonly string[] = ["jake"];
export const carouselsEnabledFor = (creatorKey: string) => CAROUSEL_CREATORS.includes(creatorKey);
