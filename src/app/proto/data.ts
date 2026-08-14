/**
 * Sample data for the prototype.
 *
 * INVENTED. Realistic in shape and magnitude so layouts are judged honestly —
 * long creator names, awkward keyword lengths, a losing ad, a blank cell — but
 * not one figure here is real. Nothing in this app reads the database, so no
 * number on screen should ever be quoted or acted on.
 */

export const SAMPLE_NOTICE =
  "Sample data. Invented figures, realistic shapes. Nothing here reads the live database.";

export const adsV2 = {
  headline: [
    { label: "Spend", value: "$2,340", sub: "last 7 days" },
    { label: "Booked", value: "38", sub: "calls" },
    { label: "Cost / booked", value: "$61.58", sub: "target $80" },
    { label: "Collected", value: "$14,400", sub: "cROAS 6.2x" },
  ],
  ads: [
    { keyword: "FEARLESS", creator: "Tyson", spend: 420, leads: 96, booked: 11, sales: 3, collected: 3600, verdict: "scale" },
    { keyword: "CAPTAIN", creator: "Jake", spend: 380, leads: 74, booked: 9, sales: 2, collected: 2400, verdict: "scale" },
    { keyword: "TEMPO", creator: "Jake", spend: 300, leads: 61, booked: 7, sales: 2, collected: 2400, verdict: "hold" },
    { keyword: "MISSION", creator: "Jake", spend: 285, leads: 52, booked: 5, sales: 1, collected: 1200, verdict: "hold" },
    { keyword: "WORTHY", creator: "Tyson", spend: 265, leads: 44, booked: 4, sales: 1, collected: 1200, verdict: "hold" },
    { keyword: "ANCHOR", creator: "Tyson", spend: 240, leads: 31, booked: 2, sales: 0, collected: 0, verdict: "watch" },
    { keyword: "SUMMIT", creator: "Jake", spend: 220, leads: 28, booked: 1, sales: 0, collected: 0, verdict: "kill" },
    { keyword: "RELENTLESS", creator: "Tyson", spend: 230, leads: 24, booked: 0, sales: 0, collected: 0, verdict: "kill" },
  ],
};

export const salesHub = {
  headline: [
    { label: "Calls taken", value: "64", sub: "this week" },
    { label: "Show rate", value: "72%", sub: "46 of 64 booked" },
    { label: "Close rate", value: "23%", sub: "15 closes" },
    { label: "Collected", value: "$28,800", sub: "cash in" },
  ],
  closers: [
    { name: "Broz", taken: 18, closed: 5, rate: 28, collected: 9600, response: "4m" },
    { name: "Will", taken: 16, closed: 4, rate: 25, collected: 7200, response: "6m" },
    { name: "Austin", taken: 14, closed: 3, rate: 21, collected: 5400, response: "11m" },
    { name: "Chris", taken: 9, closed: 2, rate: 22, collected: 3600, response: "9m" },
    { name: "Wobbe", taken: 7, closed: 1, rate: 14, collected: 3000, response: "22m" },
  ],
  calls: [
    { time: "09:00", prospect: "Marcus Bell", closer: "Broz", outcome: "Closed", value: "$2,200" },
    { time: "10:30", prospect: "Devon Ruiz", closer: "Will", outcome: "Follow-up", value: "" },
    { time: "11:15", prospect: "Aaron Whitfield", closer: "Austin", outcome: "No show", value: "" },
    { time: "13:00", prospect: "Terrance Cole", closer: "Broz", outcome: "Closed", value: "$1,200" },
    { time: "14:45", prospect: "Sam Okafor", closer: "Chris", outcome: "Lost", value: "" },
    { time: "16:00", prospect: "Isaiah Grant", closer: "Will", outcome: "Closed", value: "$2,200" },
  ],
};

export const managerAds = {
  creators: [
    { name: "Tyson", spend: 1155, booked: 17, sales: 4, collected: 6000, trend: [3, 5, 4, 6, 8, 7, 9] },
    { name: "Jake", spend: 1185, booked: 21, sales: 5, collected: 8400, trend: [2, 4, 6, 5, 7, 9, 11] },
  ],
  alerts: [
    { level: "warn", text: "RELENTLESS has spent $230 with no booked call in 6 days." },
    { level: "ok", text: "CAPTAIN cleared 3 sales and 3x ROAS — eligible to graduate to SCALE." },
    { level: "warn", text: "Tyson's cost per booked drifted from $54 to $68 week over week." },
  ],
};

export const factory = {
  projects: [
    { name: "Vet ICP — August batch", assets: 24, status: "In review", updated: "2h ago" },
    { name: "Jake · Alex's Scripts", assets: 10, status: "Live", updated: "yesterday" },
    { name: "Tyson · Direct CTA", assets: 18, status: "Draft", updated: "3 days ago" },
    { name: "Lead magnet carousel", assets: 6, status: "Live", updated: "last week" },
  ],
  queue: [
    { name: "fearless-01.jpg", state: "done" },
    { name: "fearless-02.jpg", state: "done" },
    { name: "captain-hook-a.mp4", state: "rendering" },
    { name: "captain-hook-b.mp4", state: "queued" },
    { name: "tempo-static-03.jpg", state: "queued" },
  ],
};

export const content = {
  posts: [
    { title: "The 3am promotion nobody applauds", platform: "Instagram", state: "Scheduled", when: "Thu 09:00" },
    { title: "What I miss about the barracks", platform: "Instagram", state: "Drafted", when: "—" },
    { title: "You are not lazy, you are unstructured", platform: "TikTok", state: "Posted", when: "Mon 18:00" },
    { title: "The mirror test", platform: "Instagram", state: "Posted", when: "Sun 12:00" },
  ],
  voc: [
    "I know exactly what to do. I just don't do it.",
    "The structure was never mine, it was issued to me.",
    "I do not want to be the fat one in charge.",
  ],
};
