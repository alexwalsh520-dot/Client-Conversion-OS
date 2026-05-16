export type BrainTab = "overview" | "avatars" | "copy" | "briefs" | "leads" | "cost";

export type BrainMetric = {
  label: string;
  value: string;
  unit: string;
  meta: string;
  tone: "gold" | "green" | "blue" | "red";
};

export type BrainSource = {
  name: string;
  status: "live" | "planned" | "scaffold";
  detail: string;
};

export type BrainAvatar = {
  id: string;
  name: string;
  glyph: string;
  color: "gold" | "green" | "blue" | "violet" | "teal";
  confidence: "Strong" | "Emerging" | "Forming";
  calls: number;
  revenue: string;
  avgDeal: string;
  closeRate: string;
  ltv: string;
  traits: string[];
  quote: string;
  evidence: string;
  trend: string;
};

export type AntiAvatar = {
  name: string;
  calls: number;
  lostRevenue: string;
  share: string;
  quote: string;
  filter: string;
};

export type CopyPhrase = {
  phrase: string;
  result: string;
  source: string;
  tone: "win" | "loss";
};

export type WinningAd = {
  keyword: string;
  hook: string;
  avatar: string;
  spend: string;
  cash: string;
  note: string;
};

export type CampaignBrief = {
  id: string;
  title: string;
  status: "Draft" | "Ready" | "Live";
  avatar: string;
  summary: string;
  proof: string;
  hooks: string[];
  avoid: string[];
  creative: string;
};

export type LeadScore = {
  name: string;
  time: string;
  score: number;
  avatar: string;
  source: string;
  dmSignal: string;
  flag: string;
  opener: string;
};

export type CostControl = {
  label: string;
  value: string;
  detail: string;
  tone: "green" | "gold" | "blue" | "red";
};

export type CostRule = {
  name: string;
  detail: string;
  status: string;
};

export type BrainOverview = {
  updatedAt: string;
  metrics: BrainMetric[];
  sources: BrainSource[];
  avatars: BrainAvatar[];
  antiAvatars: AntiAvatar[];
  copyPhrases: CopyPhrase[];
  winningAds: WinningAd[];
  briefs: CampaignBrief[];
  leadScores: LeadScore[];
  costControls: CostControl[];
  costRules: CostRule[];
};

export const marketingBrainOverview: BrainOverview = {
  updatedAt: "May 16, 2026",
  metrics: [
    {
      label: "Calls analyzed",
      value: "147",
      unit: "last 60 days",
      meta: "23 new calls ready to process",
      tone: "gold",
    },
    {
      label: "Buyer avatars",
      value: "5",
      unit: "real patterns",
      meta: "2 strong, 2 emerging, 1 forming",
      tone: "green",
    },
    {
      label: "Revenue mapped",
      value: "$384k",
      unit: "closed deals",
      meta: "94% tied to an avatar",
      tone: "blue",
    },
    {
      label: "AI spend",
      value: "$41",
      unit: "this month",
      meta: "$250 cap, backfill locked",
      tone: "green",
    },
  ],
  sources: [
    {
      name: "Fathom",
      status: "scaffold",
      detail: "Call transcript facts, objections, buyer language, proof quotes",
    },
    {
      name: "Sales tracker",
      status: "live",
      detail: "Closed, lost, follow-up, cash collected, closer, objection",
    },
    {
      name: "Ads Tracker",
      status: "live",
      detail: "Keyword, spend, clicks, DMs, booked calls, close, cash",
    },
    {
      name: "DM threads",
      status: "scaffold",
      detail: "Lead intent, urgency, budget signal, no-show risk, pre-call notes",
    },
    {
      name: "LTV",
      status: "planned",
      detail: "Retention, referrals, refunds, long-term value by avatar",
    },
  ],
  avatars: [
    {
      id: "busy-dad",
      name: "Busy Dad",
      glyph: "BD",
      color: "gold",
      confidence: "Strong",
      calls: 41,
      revenue: "$148k",
      avgDeal: "$5.2k",
      closeRate: "68%",
      ltv: "$7.9k",
      traits: ["Kids at home", "Low energy", "Wants structure", "Feels behind"],
      quote: "I am tired of being the tired dad after work.",
      evidence: "28 closed, 13 lost, strongest LTV path",
      trend: "+$24k this month",
    },
    {
      id: "wedding-deadline",
      name: "Deadline Shred",
      glyph: "DS",
      color: "green",
      confidence: "Strong",
      calls: 33,
      revenue: "$96k",
      avgDeal: "$4.0k",
      closeRate: "61%",
      ltv: "$5.4k",
      traits: ["Wedding or trip", "Date on calendar", "High urgency", "Photo fear"],
      quote: "I have four months and I do not want to hate the pictures.",
      evidence: "24 closed, 9 lost, high show rate",
      trend: "+$18k this month",
    },
    {
      id: "former-athlete",
      name: "Former Athlete",
      glyph: "FA",
      color: "violet",
      confidence: "Emerging",
      calls: 21,
      revenue: "$72k",
      avgDeal: "$6.0k",
      closeRate: "57%",
      ltv: "$6.8k",
      traits: ["Used to compete", "Hates starting over", "Needs identity back"],
      quote: "I know what fit feels like. I just cannot get myself there again.",
      evidence: "12 closed, 9 lost, strong coach fit",
      trend: "+$12k this month",
    },
    {
      id: "busy-operator",
      name: "Busy Operator",
      glyph: "BO",
      color: "blue",
      confidence: "Emerging",
      calls: 19,
      revenue: "$48k",
      avgDeal: "$4.0k",
      closeRate: "63%",
      ltv: "$5.9k",
      traits: ["Long work days", "Travels", "Wants simple meals"],
      quote: "I need something that works when my week gets messy.",
      evidence: "12 closed, 7 lost, low refund risk",
      trend: "flat",
    },
    {
      id: "quiet-restart",
      name: "Quiet Restart",
      glyph: "QR",
      color: "teal",
      confidence: "Forming",
      calls: 8,
      revenue: "$20k",
      avgDeal: "$5.0k",
      closeRate: "50%",
      ltv: "$5.1k",
      traits: ["Ashamed to start", "Avoids gym", "Needs private win"],
      quote: "I do not want anyone watching me figure this out.",
      evidence: "4 closed, 4 lost, needs more proof",
      trend: "new pattern",
    },
  ],
  antiAvatars: [
    {
      name: "Free Plan Guy",
      calls: 14,
      lostRevenue: "$58k",
      share: "37%",
      quote: "Can you just send me the workout first?",
      filter: "Ask budget and paid-coaching intent before booking.",
    },
    {
      name: "Tomorrow Starter",
      calls: 11,
      lostRevenue: "$42k",
      share: "27%",
      quote: "I love it, I just need to wait until life calms down.",
      filter: "Make urgency real in DMs or keep them in nurture.",
    },
    {
      name: "Info Shopper",
      calls: 8,
      lostRevenue: "$28k",
      share: "18%",
      quote: "I have been on a few calls and I am comparing options.",
      filter: "Push proof and decision timeline before calendar link.",
    },
    {
      name: "Injury Escape Hatch",
      calls: 5,
      lostRevenue: "$26k",
      share: "17%",
      quote: "I would start, but my knee might flare up again.",
      filter: "Route to medical-safe qualification and coach notes.",
    },
  ],
  copyPhrases: [
    {
      phrase: "I need energy for my kids",
      result: "+31% close lift",
      source: "Fathom calls and DM replies",
      tone: "win",
    },
    {
      phrase: "I know what to do, I just need the system",
      result: "+24% close lift",
      source: "Closed call transcripts",
      tone: "win",
    },
    {
      phrase: "free workout plan",
      result: "-38% cash quality",
      source: "DM thread and lost calls",
      tone: "loss",
    },
    {
      phrase: "six-pack transformation",
      result: "-19% close rate",
      source: "Ad copy vs closed revenue",
      tone: "loss",
    },
  ],
  winningAds: [
    {
      keyword: "FORGE-01",
      hook: "Stop being the tired dad",
      avatar: "Busy Dad",
      spend: "$3.2k",
      cash: "$42k",
      note: "Lower lead volume, highest cash quality",
    },
    {
      keyword: "IRON-04",
      hook: "System, not more fitness knowledge",
      avatar: "Former Athlete",
      spend: "$2.6k",
      cash: "$31k",
      note: "Best close rate with warm DMs",
    },
    {
      keyword: "EDGE-07",
      hook: "Four months until the pictures",
      avatar: "Deadline Shred",
      spend: "$1.9k",
      cash: "$24k",
      note: "Strong urgency, short sales cycle",
    },
  ],
  briefs: [
    {
      id: "dad-energy",
      title: "Busy Dad Energy Reset",
      status: "Ready",
      avatar: "Busy Dad",
      summary: "Lead with daily energy, kids, and being proud in family photos. Do not lead with abs.",
      proof: "Built from 41 calls, 4 top ads, and 28 closed deals.",
      hooks: ["Stop being the tired dad", "Your kids see the version you bring home", "Energy first, weight loss second"],
      avoid: ["Six-pack", "grind harder", "free plan"],
      creative: "Real dad after work, kitchen or garage gym, warm but not soft.",
    },
    {
      id: "deadline-shred",
      title: "Deadline Shred Sprint",
      status: "Draft",
      avatar: "Deadline Shred",
      summary: "Use the date on the calendar. The event makes action feel obvious.",
      proof: "33 calls and 24 closed deals show deadline pain moves fast.",
      hooks: ["Four months until the pictures", "Do not wait until the trip is three weeks away", "Make the deadline useful"],
      avoid: ["Lifetime change", "slow journey", "whenever you are ready"],
      creative: "Calendar, suitcase, wedding mirror, real progress screenshots.",
    },
    {
      id: "athlete-identity",
      title: "Former Athlete Identity",
      status: "Live",
      avatar: "Former Athlete",
      summary: "This person buys back identity. They do not want beginner language.",
      proof: "21 calls, high AOV, strong coach-led close pattern.",
      hooks: ["You are not lazy, your old system expired", "Get the athlete back without training like college", "Stop restarting from zero"],
      avoid: ["Beginner friendly", "easy mode", "newbie"],
      creative: "Training floor, old team photo, simple performance tracking.",
    },
  ],
  leadScores: [
    {
      name: "Daniel Reyes",
      time: "10:30 AM",
      score: 92,
      avatar: "Busy Dad",
      source: "FORGE-01",
      dmSignal: "Said he has no energy after work and wants to keep up with his kids.",
      flag: "Money objection possible, no anti-avatar match.",
      opener: "Start with his after-work energy, then tie it to the dad he wants to be.",
    },
    {
      name: "Mike Calloway",
      time: "11:15 AM",
      score: 88,
      avatar: "Deadline Shred",
      source: "EDGE-07",
      dmSignal: "Wedding in 16 weeks, asked about weekly check-ins.",
      flag: "Strong urgency, needs belief in timeline.",
      opener: "Anchor the call around the date and the weekly plan.",
    },
    {
      name: "Sam Kestrel",
      time: "2:30 PM",
      score: 71,
      avatar: "Former Athlete",
      source: "IRON-04",
      dmSignal: "Old ACL injury came up twice.",
      flag: "Injury Escape Hatch risk.",
      opener: "Respect the injury first, then ask what training used to feel like.",
    },
    {
      name: "Brent McCullough",
      time: "4:00 PM",
      score: 48,
      avatar: "No clean match",
      source: "BLAZE-02",
      dmSignal: "Asked for free plan and did not answer budget question.",
      flag: "Free Plan Guy match.",
      opener: "Qualify paid-coaching intent in the first five minutes.",
    },
  ],
  costControls: [
    {
      label: "AI spend this month",
      value: "$41",
      detail: "$250 monthly cap",
      tone: "green",
    },
    {
      label: "Average per call",
      value: "$0.28",
      detail: "Transcript read once",
      tone: "gold",
    },
    {
      label: "Backfill status",
      value: "Locked",
      detail: "Needs approval before old calls run",
      tone: "blue",
    },
    {
      label: "Daily max",
      value: "$18",
      detail: "Auto-pause at cap",
      tone: "red",
    },
  ],
  costRules: [
    {
      name: "Analyze once",
      detail: "Big transcripts are read one time, then saved as tiny facts.",
      status: "On",
    },
    {
      name: "Cheap model first",
      detail: "Simple extraction jobs use cheaper models before premium strategy runs.",
      status: "On",
    },
    {
      name: "No silent backfills",
      detail: "Old call processing cannot start without a human approval click.",
      status: "Locked",
    },
    {
      name: "Evidence reuse",
      detail: "Briefs use stored facts and quotes instead of re-reading every source.",
      status: "On",
    },
  ],
};
