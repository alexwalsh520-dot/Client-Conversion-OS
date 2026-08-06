// Smoke test for the lead-magnet funnel lib against live data.
// Run: npx tsx scripts/lead-magnet-smoke.ts <from> <to>
// Reads env from .env.local unless vars are already exported.

import { buildLeadMagnetReport } from "../src/lib/lead-magnet/data";

// With MOCK_SLACK=1, serve the real 8/5–8/6 #fresh-leads pings without hitting
// Slack (the bot may not be in the channel yet) so GHL + sheets run live.
const REAL_PINGS: Array<[string, string, string]> = [
  ["1785967837.884069", "JosephRoemer", "9518524882"],
  ["1785965779.522119", "SebastianPadilla", "9255259318"],
  ["1785961081.661349", "RachelArmstrong", "5135091854"],
  ["1785956413.355049", "AlexDelgado", "5625325817"],
  ["1785955720.076349", "DemetriusContreras", "7192319330"],
  ["1785955162.049469", "BrittonMehanna", "7013082871"],
  ["1785932307.497599", "ErinSperry", "4802763629"],
];

if (process.env.MOCK_SLACK === "1") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("slack.com/api/conversations.history")) {
      return new Response(
        JSON.stringify({
          ok: true,
          has_more: false,
          messages: REAL_PINGS.map(([ts, name, number]) => ({
            ts,
            bot_id: "B08CKNQ1L7K",
            text: `NEW LEAD - GET ON THE PHONES!\nOffer: Tyson Sonnek\nName: ${name}\nNumber: ${number}`,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

async function main() {
  const from = process.argv[2] || "2026-08-05";
  const to = process.argv[3] || "2026-08-06";
  const report = await buildLeadMagnetReport(from, to);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
