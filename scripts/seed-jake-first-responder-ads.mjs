// Seed the "Jake - First Responder Ads (25)" Factory project.
//
// Each item is ad_on_background mode with TWO local reference images:
//   [0] the PROVEN Tyson FIT Direct-CTA winner  -> text styling only
//   [1] an APPROVED Jake background photo       -> the actual photo, kept as-is
//
// Backgrounds are drawn only from the ones Alex approved (stage=completed).
// Flags are deliberately a minority (7 of 25) and every flag background used
// here is one he already signed off as having a correct star count, so the ad
// pass inherits a correct flag instead of regenerating one.
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
function env(key) {
  const line = envText.split(/\r?\n/).find((x) => x.startsWith(key + "="));
  if (!line) return "";
  let v = line.slice(key.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const PROJECT_NAME = "Jake - First Responder Ads (25)";
const CLIENT = "jake";
const STYLE_REF =
  "/Users/alexwalsh/Documents/All/Agency/Tyson/01_CAMPAIGNS/06:07:2026 - Tyson - Direct CTA Winners/Tyson-fit-var-01.png";
const BG_DIR = "/Users/alexwalsh/Documents/All/Agency/Jake/Ad Backgrounds";

// Smart quotes / non-breaking hyphens render as odd glyphs, so normalise to ASCII.
const clean = (s) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/ /g, " ")
    .trim();

// bg chosen per copy: run copy -> track, pushup copy -> pushup shot, etc.
const ADS = [
  ["FR01", "BG06", `I'm looking for 5 people who've been stuck at the same body and fitness for 6-18 months and need to pass a police / fire / EMS fitness test this year.

- Clear plan from today to passing your exact test
- Built around shifts, kids, and your busy schedule
- Daily 1:1 check-ins so you finally stay consistent

DM me for more details on 1 of the 5 spots.`],

  ["FR02", "BG16", `I'm looking for 5 future first responders who have already failed a fitness test once and refuse to feel that again.

- Find exactly what's stopping you (time, strength, cardio, consistency)
- Simple training days that target those gaps
- Daily 1:1 check-ins so you don't repeat old patterns

DM me for more details on 1 of the 5 spots.`],

  ["FR03", "BG15", `I'm looking for 5 people stuck in a job they don't respect who know the fitness test is the last thing between them and a badge.

- Test-specific running, strength, and circuits (no random gym days)
- 3-5 short sessions per week built around work and family
- All inside one app so you just open it and follow

DM me for more details on 1 of the 5 spots.`],

  ["FR04", "BG08", `I'm looking for 5 candidates who can lift but are nervous they'll fail the run on test day.

- Step-by-step plan to bring your run time down
- Strength work that supports your run instead of fighting it
- Daily 1:1 check-ins so you don't skip the hard days

DM me for more details on 1 of the 5 spots.`],

  ["FR05", "BG14", `I'm looking for 5 aspiring first responders who aren't worried about the run but know push-ups and bodyweight work might fail them.

- Simple, repeatable upper-body sessions to build reps fast
- Fits in 30-40 minutes around shifts and kids
- All tracked in the app so you can see reps going up each week

DM me for more details on 1 of the 5 spots.`],

  ["FR06", "BG04", `I'm looking for 5 future firefighters who are stressed that the physical test will be the thing that keeps them out.

- Training built around carries, stairs, and real fire-style work
- Sessions short enough to do on duty days and off days
- Daily 1:1 check-ins so you don't disappear for a week

DM me for more details on 1 of the 5 spots.`],

  ["FR07", "BG21", `I'm looking for 5 people with a police academy fitness test already booked who feel behind every time they think about it.

- Clear weekly targets for run, strength, and conditioning
- Adjusted around your life, not a perfect schedule
- One tap in the app to see exactly what today's session is

DM me for more details on 1 of the 5 spots.`],

  ["FR08", "BG19", `I'm looking for 5 future first responders who are scared of being the slowest one at academy PT.

- Conditioning that matches what you'll see at the academy
- Progressions so you improve without wrecking yourself
- Daily 1:1 check-ins so you don't back off when it gets uncomfortable

DM me for more details on 1 of the 5 spots.`],

  ["FR09", "BG09", `I'm looking for 5 people with kids and rotating shifts who think there's no way to fit academy prep into their life.

- Training schedule built around YOUR week, not a template
- Short, focused sessions that still move your numbers
- All in one app so you don't waste time planning

DM me for more details on 1 of the 5 spots.`],

  ["FR10", "BG13", `I'm looking for 5 aspiring first responders who are already in the gym every week but their times and reps haven't moved in months.

- Stop guessing: every session tied to your test standard
- Simple changes to fix what's holding you back
- Daily 1:1 check-ins so you don't drift back to "whatever" workouts

DM me for more details on 1 of the 5 spots.`],

  ["FR11", "BG32", `I'm looking for 5 people who have already watched at least one intake go by because they weren't ready for the fitness test.

- Turn the next intake into a real deadline with a plan
- Built so you can keep working while you prepare
- Daily 1:1 support so you don't talk yourself out of it again

DM me for more details on 1 of the 5 spots.`],

  ["FR12", "BG18", `I'm looking for 5 future first responders who know they'll handle the written and interviews, but are worried the fitness test will be why they don't get in.

- Simple run and strength plan matched to your exact test
- Basic nutrition changes so your body actually responds
- All inside one app so you're never wondering what to do

DM me for more details on 1 of the 5 spots.`],

  ["FR13", "BG10", `I'm looking for 5 people who have talked about joining police / fire / EMS for years and are sick of hearing themselves say "next year."

- Choose a realistic time frame and build backwards from it
- Training, nutrition, and check-ins all in one place
- Structure that makes it easier to do the work than to skip it

DM me for more details on 1 of the 5 spots.`],

  ["FR14", "BG31", `I'm looking for 5 people who want to be in an academy in the next 6-12 months and do NOT want fitness to be what breaks them once they're in.

- Prepare for the test and the daily PT, not just one day
- Sessions that fit beside work and study, not instead of it
- Daily 1:1 check-ins so you keep moving forward every week

DM me for more details on 1 of the 5 spots.`],

  ["FR15", "BG12", `I'm looking for 5 candidates who have missed their standard by seconds on the run or a few reps on the test.

- Focused plan to push those numbers safely over the line
- Weekly adjustments based on how your body responds
- Clear proof inside the app that you're improving before test day

DM me for more details on 1 of the 5 spots.`],

  ["FR16", "BG02", `I'm looking for 5 people who have tried hard 6-12 week challenges and ended up exhausted, sore, and still not test-ready.

- No gimmicks, just repeatable sessions you can live with
- Training matched to YOUR test date, not a promotion
- Daily 1:1 check-ins so you don't crash and quit again

DM me for more details on 1 of the 5 spots.`],

  ["FR17", "BG05", `I'm looking for 5 future first responders who are tired of telling their family "I'm going to do it" without backing it up.

- Weekly targets you and your family can see you hitting
- Plan that shows them you're serious, not just talking
- Support when life gets messy so you don't stop altogether

DM me for more details on 1 of the 5 spots.`],

  ["FR18", "BG03", `I'm looking for 5 people who keep starting training and falling off after a few good weeks.

- Simple schedule that doesn't rely on motivation
- Daily 1:1 check-ins so someone notices when you go quiet
- Adjustments when work or family blows up, instead of quitting

DM me for more details on 1 of the 5 spots.`],

  ["FR19", "BG07", `I'm looking for 5 candidates who are done trying to piece it together themselves and just want to be told exactly what to do for their test.

- Your whole week laid out in the app
- Clear numbers to hit so you know you're on track
- One place for training, nutrition, and check-ins

DM me for more details on 1 of the 5 spots.`],

  ["FR20", "BG29", `I'm looking for 5 people who are more scared of explaining in 10 years why they never applied, than they are of the fitness test right now.

- Turn that into a date, a plan, and simple daily actions
- Built around a real job and real responsibilities
- Daily 1:1 check-ins so you don't slide back into "maybe later"

DM me for more details on 1 of the 5 spots.`],

  ["FR21", "BG01", `I'm looking for 5 future police / fire / EMS recruits who want their entire fitness plan built around their body, test, and schedule.

- Custom plan for YOUR academy / hiring test and starting point
- Adjusted every week based on your results and feedback
- You never have to think "what should I do today?" again

DM me for more details on 1 of the 5 spots.`],

  ["FR22", "BG17", `I'm looking for 5 future first responders who are done guessing and want a coach to handle all the planning for their police / fire / EMS fitness test.

- I design every training day for your exact test
- I adjust it as shifts, overtime, and family change
- You only have one job: open the app and do today's session

DM me for more details on 1 of the 5 spots.`],

  ["FR23", "BG38", `I'm looking for 5 police / fire / EMS applicants who want fast feedback so they stop wasting weeks on plans that don't move their test numbers.

- Daily 1:1 check-ins so we see what's working and what isn't
- Weekly tweaks based on your run times, reps, and how you feel
- Clear proof you're getting closer to passing your fitness test

DM me for more details on 1 of the 5 spots.`],

  ["FR24", "BG33", `I'm looking for 5 future academy recruits who want maximum support with the least friction possible.

- Training, nutrition, and check-ins all in one app
- Sessions short enough to fit around shifts and kids
- Direct access to me so you're never stuck on what to do for your test

DM me for more details on 1 of the 5 spots.`],

  ["FR25", "BG36", `I'm looking for 5 future first responders who want the highest chance possible of passing their police / fire / EMS fitness test.

- Custom plan for your specific test and current level
- Daily 1:1 accountability so you don't fall off again
- Pass your test or you don't pay

DM me for more details on 1 of the 5 spots.`],
];

// --- preflight: every reference file must exist before we write any rows ------
if (!fs.existsSync(STYLE_REF)) throw new Error(`Style reference missing: ${STYLE_REF}`);
const missing = [];
for (const [, bg] of ADS) {
  const p = path.join(BG_DIR, `${bg}.png`);
  if (!fs.existsSync(p)) missing.push(p);
}
if (missing.length) throw new Error(`Missing background files:\n${missing.join("\n")}`);
console.log(`Style ref OK. All ${ADS.length} background files present.`);

// --- project ------------------------------------------------------------------
let { data: project } = await sb
  .from("factory_projects")
  .select("id, name")
  .eq("name", PROJECT_NAME)
  .maybeSingle();

if (!project) {
  const { data, error } = await sb
    .from("factory_projects")
    .insert({ name: PROJECT_NAME, client: CLIENT })
    .select("id, name")
    .single();
  if (error) throw new Error(`Project insert failed: ${error.message}`);
  project = data;
  console.log(`Created project ${project.id}`);
} else {
  console.log(`Project already exists ${project.id}`);
}

// --- items --------------------------------------------------------------------
const rows = ADS.map(([label, bg, copy], i) => ({
  project_id: project.id,
  label,
  bucket: "direct_cta",
  kind: "image_ad",
  copy_text: clean(copy),
  image_direction: `Ad text over approved background ${bg}`,
  prompt_mode: "ad_on_background",
  reference_paths: [STYLE_REF, path.join(BG_DIR, `${bg}.png`)],
  stage: "copy_written",
  sort_order: i + 1,
}));

const { error: insErr } = await sb
  .from("factory_items")
  .upsert(rows, { onConflict: "project_id,label" });
if (insErr) {
  // table may not have that unique constraint; fall back to plain insert
  const { error: e2 } = await sb.from("factory_items").insert(rows);
  if (e2) throw new Error(`Item insert failed: ${insErr.message} / ${e2.message}`);
}

console.log(`Seeded ${rows.length} items into "${PROJECT_NAME}".`);
const flagged = ADS.filter(([, bg]) => ["BG21", "BG29", "BG31", "BG32", "BG33", "BG36", "BG38"].includes(bg));
console.log(`Flag backgrounds used: ${flagged.length} of ${ADS.length} (${flagged.map((f) => f[1]).join(", ")})`);
