/**
 * The one place the veteran/ICP extraction rules live.
 *
 * Shared by build-vet-corpus.mjs (writes the markdown corpus) and
 * sync-icp-corpus.mjs (writes the Supabase tables the /icp tab reads), so the
 * files on disk and the app can never drift apart.
 *
 * The rule that matters: a person is only counted as a veteran if HE HIMSELF
 * said he served. Austin Richard, one of our closers, is ex-Army and raises
 * the military on nearly every call, so matching on keywords alone drags in
 * dozens of civilians. Our side's words qualify nobody.
 */

// ---- internal / our-side speakers (closers, setters, owners, coaches) ----
export const INTERNAL = [
  'austin richard', 'jacob broz', 'will rincan', 'will  rincan', 'matthew conder', 'matt conder',
  'alex walsh', 'tyson', 'amara', 'erin', 'debbie', 'gideon', 'kelechi', 'wobbe', 'misha',
  'nicole', 'chris ', 'jake ', 'antwan', 'lucy', 'keith', 'coach jacob', 'broz',
];
const isInternal = (name) => {
  const n = name.toLowerCase().trim();
  return INTERNAL.some(i => n === i.trim() || n.startsWith(i.trim()) || i.trim().startsWith(n));
};

// ---- veteran self-identification: must come from the PROSPECT ----
export const VET_SELF = [
  /\bi(?:'m| am)\s+(?:a\s+)?(?:combat\s+)?veteran\b/i,
  /\bi(?:'m| am)\s+(?:currently\s+)?(?:in|active duty|still in)\b.{0,25}\b(?:army|navy|marines?|marine corps|air force|military|guard|reserve)/i,
  /\bi\s+(?:was|served|did)\b.{0,30}\b(?:army|navy|marines?|marine corps|air force|military|infantry|guard|reserve)\b/i,
  /\bi\s+joined\s+the\s+(?:army|navy|marines?|marine corps|air force|military|service|guard)\b/i,
  /\b(?:when|after|since|before)\s+i\s+(?:got out|separated|was discharged|joined|enlisted|deployed)\b/i,
  /\bi\s+(?:deployed|enlisted|reenlisted|re-enlisted)\b/i,
  /\bi(?:'ve| have)?\s+(?:been\s+)?deployed\b/i,
  /\bmy\s+(?:deployment|enlistment|discharge|platoon|battalion|squadron|unit|command|chain of command|first sergeant|drill sergeant)\b/i,
  /\bi(?:'m| am)\s+(?:still\s+)?active duty\b/i,
  /\bmy\s+(?:etsr?|ets)\b/i,
  /\bi\s+got\s+out\s+(?:of|in)\b/i,
  /\bi\s+go\s+to\s+boot camp\b/i,
  /\bi(?:'m| am)\s+(?:going|shipping)\s+(?:to|out)\b.{0,20}\bboot camp\b/i,
  /\b(?:i|we)\s+(?:do|did|had)\b.{0,20}\b(?:pft|acft|apft|pt test|ruck|rucking|formation)\b/i,
  /\bi(?:'m| am)\s+(?:in|at)\b.{0,20}\b(?:11 bravo|11b|68w|infantry|air national guard|national guard)\b/i,
  /\b(?:11 bravo|11b|mos)\b/i,
];

// ---- themes: Alex's brief, expanded ----
export const THEMES = [
  ['IDENTITY_SERVICE', /\b(?:army|navy|marines?|marine corps|air force|military|infantry|deployed|deployment|active duty|boot camp|basic training|my unit|platoon|battalion|got out|separated|discharge|enlist|reenlist|veteran|the va\b|national guard|reserve|ets\b|pft|acft|apft|ruck|formation|drill|barracks|base\b|overseas|iraq|afghanistan|combat|tour\b|mos\b|first sergeant|chain of command)/i],
  ['WHO_I_USED_TO_BE', /\b(?:used to (?:be|weigh|run|lift|look|do)|back then|back when|i was (?:in the best|shredded|jacked|lean|fast|strong|fit|a beast|an athlete)|prime|my peak|when i was younger|in high school|in college|playing (?:ball|football|sports)|athlete|i could (?:run|do|lift)\b.{0,30}(?:then|back)|before i|two years ago|five years ago|ten years ago|since then|not the same|shell of|used to be able)/i],
  ['DRINKING_VICES', /\b(?:drink|drinking|drank|alcohol|beer|beers|liquor|whiskey|bourbon|vodka|booze|hungover|hangover|drunk|buzz|sober|sobriety|(?:at|to|in) the bar\b|bar scene|going out|party|partying|dip\b|dipping|zyn|nicotine|smok|vape|weed|cigarette|chew\b|porn|gambl)/i],
  ['THE_JOB_EXCUSE', /\b(?:my (?:job|work|schedule|shift)|work schedule|shift work|night shift|12 hour|twelve hour|24 hour|long hours|overtime|no time|don'?t have (?:the )?time|too busy|busy schedule|between work|after work|by the time i get home|travel for work|on the road|deploy(?:ing|ed) so|field exercise|duty day|staff duty|cq\b|underway|shore duty|sea duty)/i],
  ['HELPLESS_STUCK', /\b(?:stuck|plateau|helpless|hopeless|no matter what|nothing (?:works|worked)|tried everything|that'?s just (?:how|who) i am|always been (?:this|that|the)|genetics|slow metabolism|impossible|never been able|keep failing|failed again|gave up|give up on|fall(?:en|ing)? off|fell off|start(?:ing)? over|restart|square one|yo-?yo|on and off|every time i (?:try|start|get)|lost (?:the )?motivation|lose motivation|two weeks in|last(?:s|ed)? (?:a|two|three|about)? ?(?:week|month)|burn(?:t|ed) out|spiral|rut\b|slipp?(?:ed|ing)|slid|backslide|self.?sabotage|excuse)/i],
  ['KNOW_BUT_DONT_DO', /\b(?:i know what (?:to do|i (?:need|should))|i know i (?:should|need|have to)|it'?s not (?:a )?knowledge|i have the knowledge|i just don'?t (?:do it|apply)|not applying|execution|accountability|discipline|willpower|motivation|consistent|consistency|inconsistent|follow through|follow-through|stick to it|stick with it|hold me accountable|someone to tell me|need structure|need a plan|need somebody)/i],
  ['FAMILY_LETTING_DOWN', /\b(?:my (?:wife|husband|girlfriend|fianc|kids?|son|daughter|family|marriage|boy|girl|children|partner)|letting (?:them|her|him|my family|everyone) down|let (?:her|them|him|my family) down|be there for|be around for|my kids? (?:see|watch|look)|role model|example for|dad bod|be a (?:better )?(?:dad|father|husband)|divorce|separated from|she says|she tells me|argu|resent)/i],
  ['SHAME_MIRROR_BODY', /\b(?:mirror|shirt off|take my shirt|photos?|pictures?|see myself|look at myself|disgust|ashamed|shame|embarrass|hate (?:the way|how) i look|hate my|self.?conscious|insecure|belly|gut\b|love handles|man boob|moobs|fat\b|fatter|overweight|obese|out of shape|slob|let myself|gross|the pool|beach|shirtless|clothes don'?t fit|pants)/i],
  ['MENTAL_HEALTH_PAIN', /\b(?:depress|anxiety|anxious|ptsd|mental health|therapy|therapist|meds?\b|medication|antidepress|zoloft|prozac|suicid|dark place|rock bottom|numb|empty|lost\b|no purpose|purpose|meaning|mission|direction|angry|anger|rage|irritab|snapp|mood|isolat|alone|lonely|withdraw)/i],
  ['SLEEP_ENERGY_STRESS', /\b(?:sleep|insomnia|tired|exhausted|fatigue|no energy|low energy|drained|stress|stressed|burnt out|burned out|cortisol|wake up|can'?t sleep|4 hours|five hours|caffeine|energy drink|monster|celsius|pre.?workout|coffee)/i],
  ['INJURY_PAIN_VA', /\b(?:injur|hurt my|torn|tore|acl|mcl|meniscus|shoulder|back pain|my back|knee|knees|hip|surgery|rehab|physical therapy|pt\b.{0,10}appointment|disability|rated|percent|va\b|chronic pain|arthritis|herniat|disc\b|limitation|bad (?:back|knee|shoulder))/i],
  ['CONFIDENCE_SOCIAL', /\b(?:confiden|self.?esteem|self.?worth|respect|how i carry|presence|attract|dating|single|women|girls|social|friends|isolat|hiding|avoid people|don'?t go out|proud|pride)/i],
  ['MONEY_OBJECTION', /\b(?:afford|expensive|budget|money|cost|price|pay for|paycheck|financ|broke\b|tight right now|card|invest|worth it|spend|too much|cheap|deposit|paid in full|payment plan)/i],
  ['FAILED_PROGRAMS', /\b(?:tried|program|app\b|macro|myfitnesspal|coach before|another coach|last coach|online coach|gym membership|planet fitness|youtube|tiktok|instagram|free plan|cookie cutter|generic|template|noom|weight watchers|keto|carnivore|intermittent fasting|crash diet|cut before|bulk before)/i],
  ['DEADLINE_EVENT', /\b(?:wedding|vacation|deadline|by (?:the )?(?:summer|christmas|june|july|august|september|october|new year)|in (?:three|3|six|6|four|4) months|birthday|reunion|competition|selection|tryout|pt test|weigh.?in|tape|height and weight|body fat (?:test|standard)|promotion|board\b|flagged|profile)/i],
  ['WHAT_HE_WANTS', /\b(?:i want to (?:feel|be|look|get|have)|my goal|goals?\b|ideally|dream|if i could|end goal|where i want|be able to (?:run|play|keep up|do)|keep up with|feel like myself|feel good|feel confident|be proud|prove)/i],
];

function parse(transcript) {
  const out = [];
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]{1,45}):\s*(.*)$/);
    if (m) out.push({ speaker: m[1].trim(), text: m[2].trim() });
    else if (out.length) out[out.length - 1].text += ' ' + line;
  }
  return out;
}

export function extractMen(all) {
    const men = [];
    for (const c of all) {
    if (!c.transcript || c.transcript.length < 3000) continue;
    const title = c.title || '';
    if (!/^(strategy session|onboarding call)/i.test(title)) continue;

    const turns = parse(c.transcript);
    if (turns.length < 20) continue;

    // speaker tally
    const tally = {};
    for (const t of turns) tally[t.speaker] = (tally[t.speaker] || 0) + t.text.length;
    const speakers = Object.keys(tally);
    const prospectSpeakers = speakers.filter(s => !isInternal(s));
    if (!prospectSpeakers.length) continue;

    const prospectTurns = turns.filter(t => prospectSpeakers.includes(t.speaker));
    const prospectText = prospectTurns.map(t => t.text).join('\n');

    // veteran must be self-declared by the prospect
    const vetHits = [];
    for (const t of prospectTurns) {
      if (VET_SELF.some(r => r.test(t.text))) vetHits.push(t.text);
    }
    if (vetHits.length < 1) continue;

    // named prospect from title
    let name = title.replace(/^(strategy session|onboarding call)\s*-\s*/i, '')
                    .split(/<>|\sx\s/)[0].replace(/\s+/g, ' ').trim();
    const closer = speakers.filter(isInternal).sort((a, b) => tally[b] - tally[a])[0] || 'unknown';

    // theme extraction over prospect turns, with the closer's preceding line as context
    const themed = {};
    for (const [theme] of THEMES) themed[theme] = [];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (!prospectSpeakers.includes(t.speaker)) continue;
      if (t.text.length < 25) continue;
      for (const [theme, re] of THEMES) {
        if (re.test(t.text)) {
          let ctx = '';
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            if (isInternal(turns[j].speaker) && turns[j].text.length > 20) { ctx = `${turns[j].speaker}: ${turns[j].text}`; break; }
          }
          themed[theme].push({ ctx, speaker: t.speaker, text: t.text });
        }
      }
    }
    const themeCount = Object.values(themed).reduce((a, b) => a + b.length, 0);

    men.push({
      fathom_id: c.fathom_id, name, title, closer,
      date: (c.recorded_at || '').slice(0, 10),
      duration_sec: c.duration_sec,
      prospectSpeakers, vetHits, themed, themeCount,
      prospectWords: prospectText.split(/\s+/).length,
      prospectTurns, summary: c.summary,
    });
  }
  men.sort((a, b) => b.themeCount - a.themeCount);
  return men;
}
