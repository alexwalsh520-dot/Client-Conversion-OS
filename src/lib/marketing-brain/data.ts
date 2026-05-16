export type BrainTab = "verdicts" | "precall" | "library" | "rules" | "neural";
export type LibraryTab = "people" | "calls" | "phrases" | "ads" | "briefs" | "trends";
export type PeopleTab = "buyers" | "filter";

export type ReceiptBlock =
  | { type: "text"; title: string; body: string }
  | { type: "stats"; title: string; items: Array<{ label: string; value: string }> }
  | { type: "compare"; title: string; headers: [string, string]; items: Array<{ label: string; a: string; b: string }> }
  | { type: "quotes"; title: string; items: Array<{ source: string; text: string }> }
  | { type: "phrases"; title: string; items: Array<{ phrase: string; lift: string; negative?: boolean }> };

export type Verdict = {
  id: string;
  type: "kill" | "scale" | "test" | "watch" | "fix";
  when: string;
  claim: string;
  why: string;
  basis: string;
  action: string;
  receipts: ReceiptBlock[];
};

export type Avatar = {
  id: string;
  name: string;
  age: string;
  calls: number;
  closeRate: number;
  avgDeal: string;
  revenue: string;
  ltv: string;
  rank: number;
  desc: string;
  closesOn: string;
  who: string[];
  hooks: Array<{ text: string; lift: string }>;
  quote: string;
  targeting: string;
};

export type AntiAvatar = {
  id: string;
  name: string;
  lostRevenue: string;
  calls: number;
  desc: string;
  why: string[];
  action: string;
  examples: string[];
};

export type Phrase = {
  phrase: string;
  lift: string;
};

export type AdIntel = {
  id: string;
  copy: string;
  imageText: string;
  calls: number;
  closed: number;
  rate: number;
};

export type CampaignBrief = {
  id: string;
  status: "draft" | "approved";
  title: string;
  generated: string;
  calls: number;
  ads: number;
  summary: string;
  audience: string;
  hooks: Array<{ text: string; lift: string }>;
  avoid: string[];
  creative: string;
  budget: string;
};

export type UpcomingCall = {
  name: string;
  score: number;
  avatar: string;
  source: string;
  time: string;
  angle: string;
};

export type CallBrief = {
  takeaway: string;
  avatarMatch: string;
  breakdown: Array<{ label: string; value: number; positive: boolean }>;
  pains: string[];
  goals: string[];
  dm: Array<{ time: string; text: string }>;
  dmMeta: string;
  opener: string;
  ask: string[];
  dont: string[];
};

export type CallHistory = {
  name: string;
  date: string;
  time?: string;
  status: "upcoming" | "closed" | "lost" | "followup";
  score: number;
  avatar: string;
  source: string;
  deal: string | null;
  detail?: {
    dm: Array<{ time: string; text: string }>;
    outcome: string;
    quote: string;
  };
};

export type Trends = {
  closeRate: number[];
  phrases: Array<{ name: string; color: string; data: number[] }>;
  avatarMix: {
    stages: string[];
    colors: string[];
    weeks: number[][];
  };
  antiICP: Array<{ name: string; color: string; data: number[] }>;
};

export type DecisionRule = {
  id: string;
  category: "scoring" | "copy" | "filtering" | "strategy";
  active: boolean;
  text: string;
  basis: string;
  edited: string;
};

export type NeuralNode = {
  id: string;
  col: number;
  row: number;
  label: string;
  sub: string;
  type: "input" | "data" | "rules" | "synth" | "output";
  glyph: string;
  desc: string;
};

export type NeuralEdge = {
  from: string;
  to: string;
  emphasis?: boolean;
};

export type MarketingBrainData = {
  syncLabel: string;
  verdicts: Verdict[];
  avatars: Avatar[];
  antiAvatars: AntiAvatar[];
  phrasesUp: Phrase[];
  phrasesDown: Phrase[];
  ads: AdIntel[];
  briefs: CampaignBrief[];
  upcoming: UpcomingCall[];
  callBriefs: Record<string, CallBrief>;
  callsHistory: CallHistory[];
  trends: Trends;
  rules: DecisionRule[];
  neural: {
    nodes: NeuralNode[];
    edges: NeuralEdge[];
  };
  cost: {
    spend: string;
    cap: string;
    perCall: string;
    backfill: string;
  };
};

const commonDm = [
  { time: "9:12 AM", text: "I know what to do. I just cannot stay consistent when work gets crazy." },
  { time: "9:18 AM", text: "The ad about needing a system hit me. That is exactly it." },
  { time: "9:21 AM", text: "I am not looking for a free plan. I want someone to actually keep me on track." },
];

export const marketingBrainOverview: MarketingBrainData = {
  syncLabel: "synced just now",
  cost: {
    spend: "$41",
    cap: "$250",
    perCall: "$0.28",
    backfill: "locked",
  },
  verdicts: [
    {
      id: "scale-system-copy",
      type: "scale",
      when: "today",
      claim: "Scale the system-not-discipline angle before launching new hooks.",
      why: "It is winning in ads, DMs, and closed calls. The same phrase keeps showing up before high-quality buyers book.",
      basis: "64 calls, 7 ads, 28 closed deals",
      action: "Send to Campaign Launcher",
      receipts: [
        { type: "stats", title: "Pattern strength", items: [
          { label: "Close rate when phrase appears", value: "67%" },
          { label: "Baseline close rate", value: "22%" },
          { label: "Cash tied to angle", value: "$126k" },
        ] },
        { type: "quotes", title: "Buyer language", items: [
          { source: "Closed call", text: "I do not need more knowledge. I need a system that keeps me honest." },
          { source: "DM", text: "The discipline line is what made me book." },
        ] },
        { type: "phrases", title: "Language lift", items: [
          { phrase: "You are not lacking discipline. You are lacking a system.", lift: "+47%" },
          { phrase: "Who is checking on you now?", lift: "+38%" },
        ] },
      ],
    },
    {
      id: "kill-free-plan",
      type: "kill",
      when: "yesterday",
      claim: "Stop feeding free-plan seekers into booked calls.",
      why: "They create volume, but the Brain sees them converting into low intent calls and dead follow-up threads.",
      basis: "19 lost calls, $72k missed pipeline",
      action: "Add filter to DM flow",
      receipts: [
        { type: "compare", title: "Lead quality", headers: ["Free plan", "Paid intent"], items: [
          { label: "Close rate", a: "14%", b: "61%" },
          { label: "Show rate", a: "58%", b: "84%" },
          { label: "Avg deal", a: "$2.1k", b: "$5.4k" },
        ] },
        { type: "quotes", title: "Lost-call tells", items: [
          { source: "Lost call", text: "Can you just send me the workout first so I can see if I like it?" },
        ] },
      ],
    },
    {
      id: "test-new-dad",
      type: "test",
      when: "2 days ago",
      claim: "Test a New Dad brief as a sibling to the Marine and Athlete winners.",
      why: "Dad language appears inside two winning avatars, but the trigger is strong enough to deserve its own controlled test.",
      basis: "21 calls, $72k revenue, 57% close",
      action: "Generate campaign brief",
      receipts: [
        { type: "text", title: "What changed", body: "The dad trigger is no longer just a trait. It is behaving like a buying moment." },
        { type: "quotes", title: "Trigger quote", items: [
          { source: "Closed call", text: "I want to be the dad who runs with them, not the one watching from the bench." },
        ] },
      ],
    },
    {
      id: "fix-ad-image-text",
      type: "fix",
      when: "today",
      claim: "Ad images need OCR before copy intel can be trusted.",
      why: "Some winning ads carry the hook inside the image, not the primary text. The Brain has to read on-image text to score the real message.",
      basis: "Meta image ads + source attribution",
      action: "Wire creative OCR",
      receipts: [
        { type: "text", title: "Rule", body: "Every image creative should store extracted text beside primary text before phrase mining runs." },
        { type: "stats", title: "Current coverage", items: [
          { label: "Ads with primary text", value: "100%" },
          { label: "Ads with image text extracted", value: "planned" },
          { label: "OCR cost mode", value: "analyze once" },
        ] },
      ],
    },
  ],
  avatars: [
    {
      id: "marine",
      name: "The Plateaued Marine",
      age: "25-35",
      calls: 41,
      closeRate: 68,
      avgDeal: "$5.2k",
      revenue: "$148k",
      ltv: "$7.9k",
      rank: 1,
      desc: "Active-duty Marines and Army Reserve, plateaued 1-2 years despite high effort. Stable income and strong response to structure.",
      closesOn: "You are not lacking discipline. You are lacking a system.",
      who: [
        "Military 25-35: Marines, Army Reserve, Combat Engineer, Artillery.",
        "Plateaued 1-2 years despite high effort and lost structured PT.",
        "Stable income: housing allowance, dual income, or $60k+ household.",
        "Often married with kids under 5; dad identity is the trigger.",
      ],
      hooks: [
        { text: "You are not lacking discipline. You are lacking a system.", lift: "+47%" },
        { text: "Your sergeant is not checking on you anymore. Who is?", lift: "+38%" },
        { text: "Still in shape, or did civilian life catch up?", lift: "+24%" },
      ],
      quote: "I know what to do. I just cannot stay consistent without someone holding me to it.",
      targeting: "age: 25-35\ngender: male\ninterests: tactical fitness, military lifestyle\nbehaviors: active military OR veteran\nHH income: $60k+\nexclude: students, fixed income",
    },
    {
      id: "athlete",
      name: "The Returning Athlete",
      age: "25-35",
      calls: 33,
      closeRate: 61,
      avgDeal: "$4.0k",
      revenue: "$96k",
      ltv: "$6.8k",
      rank: 2,
      desc: "Former college athletes hitting their first real plateau post-sport. Built a base before, then fell off.",
      closesOn: "You do not need to start from zero. You need to rebuild the base.",
      who: [
        "Soccer, football, and lacrosse backgrounds.",
        "Feels worse at 30 than at 22; identity changed faster than habits.",
        "Old injuries create hesitation: ACL, SLAP, hamstring, shoulder.",
        "Wants strong, lean, athletic; not bulky or beginner-coded.",
      ],
      hooks: [
        { text: "You do not need to start from zero. You need to rebuild the base.", lift: "+31%" },
        { text: "You are not the same athlete. Your training should not be either.", lift: "+22%" },
        { text: "Strong, lean, athletic. Not beefy.", lift: "+18%" },
      ],
      quote: "I played D1 soccer. I know how to train. I just do not have a sport anymore.",
      targeting: "age: 25-35\ngender: male\ninterests: college sports alumni, hybrid training\nlookalike: former athlete closed deals\nexclude: free challenge leads",
    },
    {
      id: "dad",
      name: "The New Dad",
      age: "28-38",
      calls: 21,
      closeRate: 57,
      avgDeal: "$6.0k",
      revenue: "$72k",
      ltv: "$8.4k",
      rank: 3,
      desc: "Kid under 5. The trigger is not abs; it is being the dad who can still run, play, and last.",
      closesOn: "Be the dad who runs with them, not the one watching from the bench.",
      who: [
        "First or second kid, identity shift in motion.",
        "Does not want his kid to think this is what dad looks like.",
        "Often overlaps Marine or Athlete, but dad trigger is dominant.",
        "Long-term health beats short-term aesthetic framing.",
      ],
      hooks: [
        { text: "Be the dad who runs with them, not the one watching from the bench.", lift: "+29%" },
        { text: "If nothing changes in 12 months, where are you?", lift: "+21%" },
      ],
      quote: "I want to be the dad who is still chasing them around when they are teenagers.",
      targeting: "age: 28-38\nlife event: new parent\ninterests: dad content, baby brands\ncreative: garage, kitchen, family schedule\navoid: abs-first framing",
    },
    {
      id: "trade",
      name: "The Trade Operator",
      age: "28-45",
      calls: 19,
      closeRate: 63,
      avgDeal: "$4.0k",
      revenue: "$48k",
      ltv: "$5.9k",
      rank: 4,
      desc: "Police, electricians, firefighters, and tradesmen. They pay for expertise because they are the expertise.",
      closesOn: "You would not let YouTube rewire your house. Why do it to your body?",
      who: [
        "Skilled trades, union or commission, $60k-$90k income.",
        "Shift work, on-call weeks, and unpredictable eating windows.",
        "Values done-for-you expertise and dislikes vague coaching.",
      ],
      hooks: [
        { text: "A system that works around 16-hour shifts. Not against them.", lift: "+26%" },
        { text: "Be a client when it is your turn.", lift: "+19%" },
      ],
      quote: "I charge people for what I know. I would rather pay you for what you know.",
      targeting: "age: 28-45\njob titles: trades, police, fire\ninterests: union member, truck owner\nexclude: free PDF intent",
    },
    {
      id: "hybrid",
      name: "The Hybrid Athlete",
      age: "26-38",
      calls: 8,
      closeRate: 50,
      avgDeal: "$5.0k",
      revenue: "$20k",
      ltv: "$5.1k",
      rank: 5,
      desc: "Runs, lifts, climbs, and wants strong plus functional with a deadline-driven aesthetic goal.",
      closesOn: "You are not choosing between performance and looking sharp.",
      who: [
        "Mixes running, lifting, and outdoor activities.",
        "Deadline-driven: trip, race, or event.",
        "Needs sharper proof before scaling.",
      ],
      hooks: [
        { text: "Strong enough to perform. Lean enough to like the photos.", lift: "+14%" },
      ],
      quote: "I want to look athletic, not just be lighter.",
      targeting: "age: 26-38\ninterests: hybrid training, trail running, climbing\nstatus: forming\nbudget: test only",
    },
  ],
  antiAvatars: [
    {
      id: "free-plan",
      name: "The Free Plan Collector",
      lostRevenue: "$58k",
      calls: 14,
      desc: "Looks like volume, but turns into requests for PDFs, free trials, and comparison shopping.",
      why: ["Asks for workouts before talking price.", "Avoids paid-coaching intent questions.", "Shows low urgency after booking."],
      action: "Ask paid intent before calendar link. If unclear, keep in nurture.",
      examples: ["Can you send me the workout first?", "I just want to see what you would recommend."],
    },
    {
      id: "exact-proof",
      name: "The Exact Proof Seeker",
      lostRevenue: "$42k",
      calls: 11,
      desc: "Needs perfect niche-specific proof before making any decision.",
      why: ["Requests a case study matching every life detail.", "Delays decision even after proof.", "Often compares five programs."],
      action: "Pre-empt with broad proof and decision timeline in DMs.",
      examples: ["Do you have someone exactly like me?", "I need to compare a few options."],
    },
    {
      id: "injury-exit",
      name: "The Injury Exit Hatch",
      lostRevenue: "$26k",
      calls: 5,
      desc: "Uses old injuries as a reason to avoid commitment, not as a constraint to solve.",
      why: ["Brings up injury repeatedly.", "Does not complete screening.", "Wants guarantee before sharing details."],
      action: "Route to safety screening and only book if they will complete the intake.",
      examples: ["My knee might flare up again.", "I do not want to risk anything."],
    },
  ],
  phrasesUp: [
    { phrase: "You are not lacking discipline. You are lacking a system.", lift: "+47%" },
    { phrase: "Who is checking on you now?", lift: "+38%" },
    { phrase: "Be the dad who runs with them.", lift: "+29%" },
    { phrase: "A system that works around 16-hour shifts.", lift: "+26%" },
  ],
  phrasesDown: [
    { phrase: "Free 6-week challenge", lift: "-42%" },
    { phrase: "Unlock your hidden potential", lift: "-31%" },
    { phrase: "Transform in 12 weeks", lift: "-24%" },
    { phrase: "Risk-free workout PDF", lift: "-19%" },
  ],
  ads: [
    {
      id: "IRON",
      copy: "You do not lack discipline. You lack a system. We rebuild it for active-duty guys who already know what to do.",
      imageText: "DISCIPLINE IS NOT THE PROBLEM",
      calls: 24,
      closed: 16,
      rate: 67,
    },
    {
      id: "GRIND",
      copy: "Your sergeant is not checking on you anymore. Who is? 24-week structured programs for vets.",
      imageText: "WHO IS CHECKING ON YOU NOW?",
      calls: 19,
      closed: 12,
      rate: 63,
    },
    {
      id: "FORGE",
      copy: "Be the dad who runs with them, not the one watching from the bench. Built for fathers, by fathers.",
      imageText: "BE THE DAD WHO CAN KEEP UP",
      calls: 16,
      closed: 9,
      rate: 56,
    },
    {
      id: "BLAZE",
      copy: "Free 6-week challenge. Try our approach risk-free. Get the workout PDF and see what you think.",
      imageText: "FREE 6 WEEK CHALLENGE",
      calls: 22,
      closed: 3,
      rate: 14,
    },
  ],
  briefs: [
    {
      id: "marine-system",
      status: "approved",
      title: "Plateaued Marine - System Reset",
      generated: "today",
      calls: 41,
      ads: 4,
      summary: "Scale structure, accountability, and post-military system language. Do not lead with motivation.",
      audience: "age: 25-35\ngender: male\nmilitary/veteran interests\nHH income: $60k+\nexclude: free challenge engagers",
      hooks: [
        { text: "You are not lacking discipline. You are lacking a system.", lift: "+47%" },
        { text: "Your sergeant is not checking on you anymore. Who is?", lift: "+38%" },
      ],
      avoid: ["Free challenge", "motivation", "beginner transformation"],
      creative: "Garage gym, base housing, tactical but not corny. Use real closer testimonial clips.",
      budget: "$150/day test, scale at 2.2x cash ROAS",
    },
    {
      id: "new-dad",
      status: "draft",
      title: "New Dad Longevity Test",
      generated: "today",
      calls: 21,
      ads: 2,
      summary: "Test dad identity as its own avatar, not just a trait inside Marine/Athlete segments.",
      audience: "age: 28-38\nnew parent signals\nengaged with dad content\nexclude: abs-first engagers",
      hooks: [
        { text: "Be the dad who runs with them, not the one watching from the bench.", lift: "+29%" },
      ],
      avoid: ["six-pack", "shredded dad", "no excuses"],
      creative: "Kitchen, stroller, evening routine, family time. Quiet pride, not hype.",
      budget: "$75/day proof test",
    },
  ],
  upcoming: [
    { name: "Daniel Reyes", score: 92, avatar: "Plateaued Marine", source: "IRON", time: "10:30 AM", angle: "System problem, not knowledge problem. Open with structure and accountability." },
    { name: "Mike Calloway", score: 88, avatar: "New Dad", source: "FORGE", time: "11:15 AM", angle: "New dad. Open with being around and able at 70, not looking shredded." },
    { name: "Renata Ortiz", score: 84, avatar: "Trade Operator", source: "PHOENIX", time: "1:00 PM", angle: "Values expertise. Open with shift work and paying a pro to solve a real constraint." },
    { name: "Brent McCullough", score: 48, avatar: "Filter risk", source: "BLAZE", time: "4:00 PM", angle: "Free-plan language. Qualify paid intent in the first five minutes." },
  ],
  callBriefs: {
    "Daniel Reyes": {
      takeaway: "High-intent Marine match. He already believes knowledge is not the issue.",
      avatarMatch: "92% Marine - strong system language",
      breakdown: [
        { label: "Avatar match", value: 37, positive: true },
        { label: "Paid intent", value: 24, positive: true },
        { label: "Free-plan risk", value: -4, positive: false },
        { label: "Source ad quality", value: 35, positive: true },
      ],
      pains: ["Fell off after losing structured PT.", "Work schedule creates chaos.", "Wants someone checking in."],
      goals: ["Consistency", "Energy", "Look like himself again"],
      dm: commonDm,
      dmMeta: "Source ad carried both primary text and image text: DISCIPLINE IS NOT THE PROBLEM.",
      opener: "Daniel, you told us this is a system problem, not a knowledge problem. That is exactly the right diagnosis. Walk me through what has been getting in the way.",
      ask: ["What changed when structured PT left?", "Who currently sees whether you follow through?", "What happens if nothing changes in 12 months?"],
      dont: ["Do not pitch motivation.", "Do not call him a beginner.", "Do not lead with transformation language."],
    },
    "Mike Calloway": {
      takeaway: "New Dad trigger is the strongest signal. Keep the call on longevity and identity.",
      avatarMatch: "88% New Dad - Marine overlap",
      breakdown: [
        { label: "Dad trigger", value: 34, positive: true },
        { label: "Urgency", value: 20, positive: true },
        { label: "Source ad quality", value: 26, positive: true },
      ],
      pains: ["Second kid born recently.", "Feels energy dropping.", "Does not want health to drift."],
      goals: ["Play with kids", "Energy after work", "Long-term health"],
      dm: [
        { time: "8:02 AM", text: "I just had my second. The dad ad hit hard." },
        { time: "8:05 AM", text: "I do not care about abs as much as being around and able." },
      ],
      dmMeta: "Booked from FORGE. Image text: BE THE DAD WHO CAN KEEP UP.",
      opener: "Mike, congrats on the new baby. Your ad mentioned being the dad who can run with them. What does that look like to you five years from now?",
      ask: ["What are you worried your kids will see if nothing changes?", "What would a normal week need to look like?", "What support does your schedule actually need?"],
      dont: ["Do not lead with aesthetics.", "Do not use aggressive no-excuses framing."],
    },
    "Renata Ortiz": {
      takeaway: "Trade Operator. She values expertise and a plan that respects rotating shifts.",
      avatarMatch: "84% Trade Operator",
      breakdown: [
        { label: "Expertise fit", value: 29, positive: true },
        { label: "Schedule constraint", value: 21, positive: true },
        { label: "Injury concern", value: -6, positive: false },
      ],
      pains: ["Rotating shifts.", "Shoulder history.", "Meals collapse on night weeks."],
      goals: ["Feel athletic", "Simple meals", "No shoulder flare-up"],
      dm: [
        { time: "12:15 PM", text: "I work rotating shifts so normal plans do not work." },
        { time: "12:19 PM", text: "Also have a shoulder thing from last year." },
      ],
      dmMeta: "Source ad used the tradesman expertise frame.",
      opener: "Renata, you asked about shifts and your shoulder. Both matter. Let's start with shifts: what does a typical two-week cycle look like?",
      ask: ["What weeks usually break the plan?", "What shoulder movements are off limits?", "What have you already paid for that did not adapt?"],
      dont: ["Do not say just meal prep.", "Do not skip the shoulder screen."],
    },
    "Brent McCullough": {
      takeaway: "Low-intent lead. Treat this as qualification before pitch.",
      avatarMatch: "48% match - Free Plan Collector risk",
      breakdown: [
        { label: "Source ad quality", value: -22, positive: false },
        { label: "Paid intent", value: -16, positive: false },
        { label: "Urgency", value: 10, positive: true },
      ],
      pains: ["Wants a plan to try first.", "Avoided budget question.", "No clear urgency."],
      goals: ["Lose weight", "Get a workout", "See if coaching fits"],
      dm: [
        { time: "3:42 PM", text: "Can you send the workout first?" },
        { time: "3:46 PM", text: "I might book if I like the plan." },
      ],
      dmMeta: "Booked from BLAZE. Image text: FREE 6 WEEK CHALLENGE.",
      opener: "Brent, I want to be respectful of your time. What would have to be true on this call for you to say yes to coaching today?",
      ask: ["Are you looking for coaching or a plan to try alone?", "What budget did you have in mind?", "Why now?"],
      dont: ["Do not spend 40 minutes diagnosing.", "Do not send a free plan after the call."],
    },
  },
  callsHistory: [
    { name: "Daniel Reyes", date: "Today", time: "10:30 AM", status: "upcoming", score: 92, avatar: "Plateaued Marine", source: "IRON", deal: null },
    { name: "Mike Calloway", date: "Today", time: "11:15 AM", status: "upcoming", score: 88, avatar: "New Dad", source: "FORGE", deal: null },
    { name: "Aaron Price", date: "May 15", status: "closed", score: 90, avatar: "Plateaued Marine", source: "GRIND", deal: "$6,400", detail: { dm: commonDm, outcome: "Closed at pay-in-full after system/accountability frame.", quote: "I need someone to keep the system from falling apart." } },
    { name: "Sam Kestrel", date: "May 14", status: "followup", score: 71, avatar: "Returning Athlete", source: "EDGE", deal: null, detail: { dm: commonDm.slice(0, 2), outcome: "Follow-up. Injury concern needs proof and safety screen.", quote: "I know what fit feels like. I just do not trust my knee." } },
    { name: "Brent McCullough", date: "Today", time: "4:00 PM", status: "upcoming", score: 48, avatar: "Filter risk", source: "BLAZE", deal: null },
  ],
  trends: {
    closeRate: [22, 25, 27, 31, 29, 33, 36, 41, 39, 46, 52, 57],
    phrases: [
      { name: "system", color: "#d4b27a", data: [8, 12, 18, 22, 27, 31, 36, 41, 45, 47, 48, 47] },
      { name: "free", color: "#e89a94", data: [-8, -12, -17, -19, -24, -29, -31, -35, -38, -41, -42, -42] },
    ],
    avatarMix: {
      stages: ["Marine", "Athlete", "Dad", "Trade"],
      colors: ["#d4b27a", "#7aa7d4", "#7dd3a8", "#a98fd0"],
      weeks: [
        [4, 3, 1, 1], [5, 3, 1, 2], [5, 4, 2, 2], [6, 4, 2, 2],
        [7, 4, 3, 2], [6, 5, 4, 3], [7, 6, 4, 3], [8, 6, 5, 4],
        [8, 6, 6, 4], [9, 7, 6, 5], [10, 7, 7, 5], [11, 8, 7, 6],
      ],
    },
    antiICP: [
      { name: "free plan", color: "#e89a94", data: [8, 7, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3] },
      { name: "exact proof", color: "#c4a370", data: [3, 4, 4, 5, 5, 4, 4, 4, 3, 3, 2, 2] },
    ],
  },
  rules: [
    { id: "winning", category: "strategy", active: true, text: "If an ad is winning on cash quality, do not turn it off. Test sibling angles around it first.", basis: "User paradigm", edited: "today" },
    { id: "ocr", category: "copy", active: true, text: "Treat on-image text as ad copy. Run OCR on image creatives before phrase mining.", basis: "Image ads carry hooks", edited: "today" },
    { id: "free", category: "filtering", active: true, text: "Free-plan language lowers lead score unless paid intent is explicit in DMs.", basis: "19 lost calls", edited: "yesterday" },
    { id: "ltv", category: "scoring", active: true, text: "Long-term value beats raw close rate when choosing what avatar to scale.", basis: "Retention + referrals", edited: "this week" },
    { id: "self-diagnosis", category: "scoring", active: true, text: "When a lead names the real bottleneck in DMs before we explain it, weight the score higher.", basis: "DM-to-close pattern", edited: "this week" },
    { id: "sibling-tests", category: "copy", active: true, text: "When an angle is winning, test adjacent phrasing and creative variations before testing a brand-new angle.", basis: "Ad performance history", edited: "this week" },
  ],
  neural: {
    nodes: [
      { id: "fathom", col: 0, row: 0, label: "Fathom", sub: "call recordings + transcripts", type: "input", glyph: "F", desc: "Every sales call we record. The truth-source for everything the brain knows about buyers, objections, and what closes." },
      { id: "dms", col: 0, row: 1, label: "IG DMs", sub: "pre-call threads", type: "input", glyph: "DM", desc: "The full DM thread between an ad click and a booked call. Tells us how a lead self-identifies before we ever talk to them." },
      { id: "sales", col: 0, row: 2, label: "Sales tracker", sub: "outcomes + deals", type: "input", glyph: "$", desc: "Closed / lost / follow-up per call, deal size, who closed, source ad. The outcome layer that retroactively grades every other signal." },
      { id: "meta", col: 0, row: 3, label: "Meta Ads", sub: "copy + spend + clicks", type: "input", glyph: "M", desc: "Every ad we have shipped: primary text, creative image text from OCR, spend, clicks, and attribution into calls." },
      { id: "phrases", col: 1, row: 0, label: "Phrases", sub: "closes + flops", type: "data", glyph: "P", desc: "Words and phrases scored by close-rate lift. Mined continuously from transcripts, DMs, ad copy, and OCR text from image creatives." },
      { id: "avatars", col: 1, row: 1, label: "Avatars", sub: "buyers + filter-out", type: "data", glyph: "AV", desc: "Clustered customer types. Buyer avatars come from closed-call patterns; filter-out patterns come from lost calls." },
      { id: "calls", col: 1, row: 2, label: "Calls history", sub: "every booked call", type: "data", glyph: "#", desc: "The unified call ledger: every booked call, scored, with its DM thread, outcome, and source attribution attached." },
      { id: "ads", col: 1, row: 3, label: "Ads catalog", sub: "every ad shipped", type: "data", glyph: "A", desc: "Every ad with copy, OCR image text, calls generated, close rate, cost per close, and cash quality." },
      { id: "rules", col: 2, row: 1.5, label: "Decision rules", sub: "user-editable", type: "rules", glyph: "R", desc: "The paradigms the user teaches the brain. Every synthesis engine consults these. Edit a rule and the verdicts + scores re-balance." },
      { id: "verdictSynth", col: 3, row: 0, label: "Verdict synthesis", sub: "opinionated conclusions", type: "synth", glyph: "V", desc: "Looks across all data filtered by active rules and produces plain-language claims." },
      { id: "scorer", col: 3, row: 1.5, label: "Pre-call scorer", sub: "lead score + brief", type: "synth", glyph: "S", desc: "For every booked call, produces a score + a pre-call brief. Reads the DM thread, source ad, avatar match, and active scoring rules." },
      { id: "briefGen", col: 3, row: 3, label: "Brief generator", sub: "audience + hooks", type: "synth", glyph: "B", desc: "Builds campaign briefs for the media buyer. Picks the right avatar, top-converting hooks, words to avoid, and creative direction." },
      { id: "verdictsOut", col: 4, row: 0, label: "Verdicts feed", sub: "verdicts tab", type: "output", glyph: "!", desc: "What the user sees on the Verdicts tab. The headline output: what the brain thinks you should do this week." },
      { id: "precallOut", col: 4, row: 1.5, label: "Pre-call briefs", sub: "closer view", type: "output", glyph: ">", desc: "What the closer sees before a call. Score, DMs, suggested opening, questions to ask, things not to say." },
      { id: "briefsOut", col: 4, row: 3, label: "Campaign briefs", sub: "media buyer view", type: "output", glyph: "->", desc: "What the media buyer ships next. Audience definition, hooks ranked by lift, words to avoid, creative direction, spend." },
    ],
    edges: [
      { from: "fathom", to: "phrases" }, { from: "fathom", to: "avatars" }, { from: "fathom", to: "calls" },
      { from: "dms", to: "phrases" }, { from: "dms", to: "calls" }, { from: "sales", to: "avatars" }, { from: "sales", to: "calls" },
      { from: "meta", to: "phrases" }, { from: "meta", to: "ads" },
      { from: "phrases", to: "verdictSynth" }, { from: "avatars", to: "verdictSynth" }, { from: "calls", to: "verdictSynth" }, { from: "ads", to: "verdictSynth" }, { from: "rules", to: "verdictSynth", emphasis: true },
      { from: "avatars", to: "scorer" }, { from: "phrases", to: "scorer" }, { from: "calls", to: "scorer" }, { from: "dms", to: "scorer" }, { from: "rules", to: "scorer", emphasis: true },
      { from: "avatars", to: "briefGen" }, { from: "phrases", to: "briefGen" }, { from: "ads", to: "briefGen" }, { from: "rules", to: "briefGen", emphasis: true },
      { from: "verdictSynth", to: "verdictsOut" }, { from: "scorer", to: "precallOut" }, { from: "briefGen", to: "briefsOut" },
    ],
  },
};
