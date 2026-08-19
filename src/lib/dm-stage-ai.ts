// DM stage classification — the funnel's `in_discovery` stage.
//
// WAS: one Claude call per inbound webhook event, re-reading the whole thread every time.
// That had no cache and no gate, so it re-answered a settled question on every message —
// including every outbound one, which cannot change the verdict. It reached ~$414/month
// (84% of the app's entire Anthropic bill) to produce one bar on one chart.
//
// NOW: the same verdict from a local rule, at zero cost and zero latency. The rule counts
// CONTENT words the prospect has written — words remaining after acknowledgements
// ("yeah", "ok", "thanks"), filler and emoji are stripped. A prospect who has written
// >= DISCOVERY_WORD_THRESHOLD content words has, by the old prompt's own definition,
// "moved past a one-word acknowledgement and started opening up".
//
// Calibration: scored against 5,988 conversations the model had already labelled
// (Tyson + Jake, the two-way clients). Sweeping the threshold:
//     12 words -> 85.7%   |   20 words -> 86.7%   |   30 words -> 85.8%
// 20 is the peak and it is balanced — 86.2% agreement on the trues, 87.0% on the falses,
// so the funnel neither systematically over- nor under-counts. The residual ~13% are
// genuine judgement calls (sarcasm, terse-but-substantive replies) that no word count
// resolves; that is the price of the stage being free.
//
// The exported surface is unchanged, so callers did not move.

// The funnel on the client dashboard no longer uses goal/gap/stakes/qualified.
// Only `in_discovery` matters: after the `lead_engaged` tag, did the lead
// respond substantively to the next setter message (usually a discovery
// voice note)?
//
// `booking_readiness_score` is kept as a coarse 0–100 signal for the sales
// manager agent. `ai_confidence` is kept so we can down-weight uncertain
// calls. `stage_evidence` returns one short quote explaining the in_discovery
// verdict.
export interface DmStageClassification {
  in_discovery: boolean;
  booking_readiness_score: number;
  ai_confidence: number;
  stage_evidence: {
    in_discovery?: string;
  };
}

// Bumped when the CLASSIFIER changes so the webhook re-evaluates stale conversations.
// v3 = the local rule that replaced the model.
const ANALYSIS_VERSION = "dm-stage-v3";

// Peak-agreement threshold from the 5,988-conversation sweep above.
const DISCOVERY_WORD_THRESHOLD = 20;

// Words that carry no discovery signal: bare acknowledgements, greetings, reactions, and
// the handful of stopwords short enough to survive tokenisation. Anything left after this
// filter is the prospect actually saying something.
const NOISE_WORDS = new Set([
  "yeah", "yes", "yep", "ya", "yup", "ok", "okay", "k", "kk", "sure", "thanks", "thank",
  "ty", "cool", "nice", "sounds", "good", "great", "awesome", "perfect", "alright",
  "right", "true", "facts", "fr", "no", "nope", "nah", "hey", "hi", "hello", "yo", "sup",
  "lol", "haha", "bet", "word", "gotcha", "ight", "interested", "im", "i", "m", "a",
  "the", "you", "it", "that", "to", "is",
]);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu;

function contentWords(text: string): string[] {
  return text
    .replace(EMOJI, " ")
    .toLowerCase()
    .match(/[a-z']+/g)
    ?.filter((word) => !NOISE_WORDS.has(word)) ?? [];
}

// buildTranscript (instagram-dm.ts / ghl-conversation-webhook) emits one line per message as
// `Prospect (timestamp): body` or `Setter (timestamp): body`. Only the prospect's lines count —
// a setter typing can never move the prospect into discovery, which is precisely the asymmetry
// the old per-message model call kept paying to rediscover.
function prospectLines(transcript: string): string[] {
  return transcript
    .split("\n")
    .filter((line) => /^Prospect\b/.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);
}

export function getDmAnalysisVersion() {
  return ANALYSIS_VERSION;
}

// Kept `async` so every existing `await analyzeDmStages(...)` call site is untouched.
// Never returns null now — there is no key to be missing and no request to fail.
export async function analyzeDmStages(
  transcript: string,
): Promise<DmStageClassification | null> {
  const lines = prospectLines(transcript);
  const words = lines.flatMap(contentWords);
  const total = words.length;
  const inDiscovery = total >= DISCOVERY_WORD_THRESHOLD;

  // A coarse 0–100 stand-in for the model's old score, on the same scale: the threshold sits
  // at 50 so "just crossed into discovery" reads as the midpoint, saturating at 4x the bar.
  const bookingReadiness = Math.min(
    100,
    Math.round((total / DISCOVERY_WORD_THRESHOLD) * 50),
  );

  // Confidence tracks distance from the threshold — a conversation sitting right on the line is
  // exactly where the rule and the model used to disagree, and consumers can down-weight it.
  const distance = Math.abs(total - DISCOVERY_WORD_THRESHOLD);
  const confidence = Math.min(0.95, 0.5 + distance / (DISCOVERY_WORD_THRESHOLD * 2));

  const longest = lines.reduce((a, b) => (contentWords(b).length > contentWords(a).length ? b : a), "");
  const evidence = inDiscovery
    ? `${total} content words from the prospect; longest reply: "${longest.slice(0, 120)}"`
    : `Only ${total} content words from the prospect (needs ${DISCOVERY_WORD_THRESHOLD}).`;

  return {
    in_discovery: inDiscovery,
    booking_readiness_score: bookingReadiness,
    ai_confidence: Number(confidence.toFixed(2)),
    stage_evidence: { in_discovery: evidence },
  };
}
