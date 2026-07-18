# Tyson — April 2026 revenue forensics

**Question:** Tyson's monthly revenue stepped up in spring 2026. What was his content doing
differently in April vs now, what actually drove the revenue, and what should he recommit to?

**Short answer, up front:** The premise ("April jumped to ~$100k because close rate / ticket moved →
the people changed") is **half right and importantly reframed by the data.** April was the peak of an
**organic-content acquisition engine** — every researched April buyer came in with **no keyword and no
ad attached**, and several say verbatim they *"saw Tyson's content, liked what he stood for, and
reached out."* That produced a 90% close rate on high-intent inbound. Since then the business
**switched its acquisition to paid keyword ads** (spend $0 → $9.7k → $18.7k; keyword-DM entries went
from 0% of April closes to ~68% of June–July closes). The true ~$100k month is **June**, and it was a
**paid-ads + higher-ticket** month, not a rerun of the April engine. **What faded is the volume of
personality-driven organic content that made people reach out on their own.**

Every claim below is tagged by evidence tier: **[DIRECT]** buyer's own words / hard attribution >
**[CORRELATION]** two things moved together > **[INFERENCE]** reasoned from partial data.

---

## 1. Funnel truth (the numbers that survive scrutiny)

Sources: `sales_tracker_rows` (offer = "Tyson Sonnek"), `ghl_appointments` (Strategy Session (TS)),
`ads_meta_insights_daily`, `ads_keyword_events`, `buyer_dossiers`. "WIN" outcome = a close.

| Month | SS booked* | Calls taken | Wins | Close % | Contracted | Collected | Avg ticket (all wins) | Ad spend |
|------|-----------:|------------:|-----:|-------:|-----------:|----------:|----------------------:|---------:|
| Mar  | n/a*       | 74          | 58   | 78%    | $48.8k     | $49.1k    | $841                  | **$0**   |
| **Apr** | 104     | 110         | **99** | **90%** | $77.2k   | $77.2k    | **$780**              | **$9.7k** |
| May  | 180        | 114         | 66   | 58%    | $77.3k     | $77.3k    | $1,171                | $17.1k   |
| Jun  | 135        | 105         | 87   | 83%    | **$98.5k** | **$98.5k**| $1,132                | $18.7k   |
| Jul† | 81         | 63          | 28   | 44%    | $35.3k     | $35.6k    | $1,262                | $7.6k    |

\* GHL Strategy-Session ingestion begins in April, so March SS booked isn't captured (not zero in
reality). † July is partial (month in progress at time of analysis).

**What this establishes:**
- **The step-up was March→April (+$28k), and the ~$100k peak is June — not April.** [DIRECT]
- **Call volume April→June really was similar** (110 → 105 taken), so the premise's "similar call
  volume" holds. [DIRECT]
- **April had the highest close rate (90%) and the most wins (99) at the *lowest* average ticket
  ($780).** April was a **volume + conversion** month, not a ticket month. [DIRECT]
- **The ticket rise happened in May–June ($1,130–1,170), not April.** [DIRECT]

### Two different ticket numbers — read them carefully
- `sales_tracker` April avg ticket **$780** across **all 99 wins** (includes cheap subscription /
  low-ticket closes).
- `buyer_dossiers` April **premium** closes: **35 buyers, median ticket $1,800.**

April was a **barbell**: a core of ~35 premium organic buyers at ~$1,800 **plus** a tail of cheaper
subscription closes that drag the blended average down to $780. The dossier'd 35 are the ones worth
studying — they're the premium, researched buyers. [DIRECT]

---

## 2. Rule out the non-content levers (what else moved in April?)

Three non-content levers moved in the spring. They must be separated from content before crediting
content with anything.

1. **Paid ads turned ON in April.** [DIRECT] March spend was **$0** (fully organic). April $9.7k →
   May $17.1k → June $18.7k. DM-keyword events went **0 (Mar) → 606 (Apr) → 2,172 (May) → 1,663
   (Jun).** The paid acquisition machine was *born* in April and *scaled* after.

2. **The offer/program mix shifted, lifting ticket.** [CORRELATION] April program mix was
   subscription-heavy (Subscription:44, 6-mo:27); May–June shifted to **3-month programs**
   (3-mo:28 then 32). The move off subscriptions into 3-month packages is the most likely driver of
   the May–June ticket rise — an **offer lever, not a content lever.**

3. **Closer mix changed.** [CORRELATION] Mar–Apr leaned Will/Broz/Amara; June added Austin (52),
   Wobbe, Chris; July is Broz/Wobbe-heavy. Closer performance is a real, non-content lever on close
   rate and ticket.

**Verdict:** The April revenue step is **confounded by the simultaneous launch of paid ads**, and the
later ticket rise is best explained by the **subscription→3-month offer change.** Neither is content.
What content *can* be credited for is isolated in §3–4 using buyer attribution, which is the one place
the people tell us directly why they came.

---

## 3. Who April pulled vs who June–July pulls (the "people changed" question)

This is the strongest evidence in the analysis, because it comes from the buyers' own researched
dossiers (`buyer_dossiers.research`), not inference.

**Entry attribution (hard keys):**
- **April: 35/35 researched closes came in with `first_keyword = none` and *zero* ad copy
  attached.** [DIRECT] Not one April premium buyer entered through a tracked ad.
- **June–July: 39/57 closes came in on a keyword** (fit:18, focus:7, loaded:4, healthy:3, …), **35
  with ad copy attached.** [DIRECT] The paid "5 service members" ad is the dominant entry path.

**April cohort** (LLM synthesis of 22 researched dossiers, corroborated by the raw text): veterans in
transition and military-background civilians who found him through **organic content over time or
referral**, are **highly self-aware** (can articulate exactly what broke down), identity-driven
("reclaim who I was", "fill the structure the military gave me"). Direct content citations: [DIRECT]
- *"saw Tyson's content, liked what he stood for, and reached out because of it"*
- *"watched someone's transformation and thought 'if he could do it, I could too'"* (content social proof)
- multiple reference a **prior relationship with his material** before the call — so the call felt
  like a next step, not a cold pitch.

**June–July cohort:** skews **younger, more active-duty**, entered through a **specific paid ad hook**
("five service members", "warrior body", "summer shredding challenge"), **less narratively
developed** on the call (names the symptom, not the root cause), several **DM-only / pre-call**
sign-ups. They quote the **ad copy** almost verbatim as what made them act. [DIRECT]

**The shift in plain words:** April sold **warm, self-selected, high-intent organic inbound** who
already trusted him from his content. June–July sells **colder, ad-interrupted traffic** that the
sales team must warm up on the call. Same avatar (servicemen), different **temperature and origin.**
That is exactly the "the people changed" the premise sensed — but the change is **organic-trust →
paid-interrupt**, and it moved the business *away* from the April engine, not toward it.

---

## 4. What April's content was actually doing (and how much to trust it)

**Heavy caveat first:** April has **96 posts but only 22 transcripts (23% coverage)**; after
de-duplicating re-ingested rows, only **14 unique April transcripts** were analyzable vs **49** for
June–July. Every content-behavior number below is **[INFERENCE]** off a small, transcript-biased
sample — direction only, not precise proportions. (Engagement counts in `creator_content` are
lifetime-cumulative, so cross-month engagement comparison is unreliable and is not used here.)

LLM classification (`feature = april-analysis`) of the analyzable posts:

| Dimension | April | June–July |
|---|---|---|
| Format: lifestyle/entertainment | **64%** | 45% |
| Format: talking-head | 21% | **37%** |
| Narrative: entertainment | **79%** | 51% |
| Narrative: story / opinion / tips | 21% | 48% |
| Aimed at the ICP (military-accountability buyer) | 7% | 10% |
| In-content CTA (DM/keyword) | **0%** | 6% |
| Marine credibility invoked | 7% | 12% |

**What this says (all [INFERENCE], sample-limited):**
- April content was **more entertainment/personality-forward and *less* talking-head** than now. The
  April magic was **not** precision ICP messaging — it was **broad, high-volume, funny,
  personality-driven reach** (Topgolf bits, veteran-humor, patriotic content, singing).
- **Neither era targets the ICP tightly** (7% vs 10%) or uses in-content CTAs much (0% vs 6%). So the
  April organic inbound happened **despite** low explicit targeting/CTA — people reached out because
  they **liked him**, not because a post told them to DM a keyword.
- **Posting volume was high in April** (96 posts ≈ 3+/day). [DIRECT from row counts]

**Reconciliation:** the organic engine that produced April's premium buyers = **high volume of
authentic, entertaining, personality-first content that built trust and pulled warm inbound.** It was
reach-and-relatability, not funnel-engineered content.

---

## 5. What faded, and when

- **Organic-origin premium closes:** 100% of April premium closes → ~32% by June–July (68% now come
  via paid keyword). [DIRECT] The organic inbound engine didn't vanish, but it's now a minority of
  acquisition.
- **Content volume:** April 96 posts → July 38 (partial, but trending down from June's 109). [DIRECT
  from row counts] Fewer at-bats.
- **Entertainment/personality share** appears to have dropped from ~79% to ~51% of analyzable posts
  as the mix professionalized toward tips/opinion. [INFERENCE, sample-limited]
- **Transcript/production traceability improved** (23% → 73% transcript coverage), so the *system*
  got better even as the organic-inbound share fell. [DIRECT]

---

## 6. THE RECOMMIT LIST (countable, handable as-is)

Behaviors that the evidence ties to the April organic engine, written so Tyson can be held to them:

1. **Post at April cadence: ≥ 3 reels/day, ≥ 90 posts/month.** Volume was the substrate of the
   organic-inbound engine. [DIRECT: April = 96 posts]
2. **Keep ≥ 60% of reels personality/entertainment-forward** (humor, veteran-life, lifestyle,
   patriotic) — the content that made people "like what he stands for" and reach out. Do **not**
   over-rotate to talking-head tips. [INFERENCE, sample-limited — treat as a hypothesis to A/B]
3. **Put an unmistakable "reach out to me" surface on the organic content** (DM invite in reel/caption).
   April converted inbound with **0% in-content CTA** — that's upside left on the table, not a thing
   to preserve. Add a soft DM CTA to a share of organic reels and measure organic-origin DMs. [DIRECT:
   April CTA = 0%]
4. **Protect the organic channel as a distinct pipeline** — don't let paid ads fully replace it. Track
   `first_keyword = none` closes as a first-class metric; the goal is to grow that count back toward
   April's 35/month, not let it decay. [DIRECT]
5. **Lean into identity/transition storytelling** (military-to-civilian, "reclaim who I was") — the
   April premium buyers were the *narratively self-aware* ones who resonated with that. [DIRECT: buyer
   dossiers]

(The ticket lever — subscription → 3-month — is an **offer** decision for Matthew/sales, not a Tyson
content behavior, and is out of scope for the recommit list.)

---

## 7. What could not be determined (and the data that would settle it)

- **Follower conversion in April.** `creator_account_snapshots` starts **July** — there is **no April
  follower data.** Any "converting viewers to followers" claim can only be proxied and is not made
  here. *Settle it:* backfill IG follower history via the Graph API if available.
- **True April content mix.** Only 14/96 April posts are analyzable by transcript. The 82 without
  transcripts could skew the format/topic percentages either way. *Settle it:* transcribe the April
  back-catalogue (the pipeline can do it) and re-run the `april-analysis` classifier.
- **Causal split between "ads on" and "content quality" for the April jump.** Both moved in April;
  with the data available they can't be cleanly separated. The buyer attribution (0% ad-origin in
  April) argues content/organic carried April, but paid impressions may have assisted awareness.
  *Settle it:* a hold-out or spend-pause week to observe organic-only close volume.
- **Why close rate swung** (90% Apr → 58% May → 83% Jun → 44% Jul). Closer mix and lead temperature
  both moved. *Settle it:* per-closer close-rate by lead-origin (keyword vs none) month over month.

---

### Method & cost
Read-only over Supabase (`sales_tracker_rows`, `ghl_appointments`, `creator_content`, `fathom_calls`,
`buyer_dossiers`, `ads_meta_insights_daily`, `ads_keyword_events`), paginated with `.range()` to beat
PostgREST's 1,000-row cap. LLM classification + buyer synthesis logged under `ai_usage.feature =
'april-analysis'`. **Total LLM spend ≈ $0.21** (target was < $5).

---

## Addendum — post-backfill (April transcripts recovered)

The original content-mix percentages were **[INFERENCE]** off just **14 analyzable April posts**. The
April back-catalogue has since been transcribed: all 51 remaining April reels were downloaded
successfully (their Instagram CDN URLs were still live — no re-scrape needed) and **45 April reels now
carry a transcript**, taking the analyzable sample from **14 → 69 posts (5×)**.

**A finding fell out of the backfill itself:** of the newly transcribed reels, **20 returned fewer than
10 words** (median 9 words overall, 23 of 51 under 5 words). These are music/visual entertainment
reels with little or no speech. That is *independent, mechanical corroboration* of the entertainment
skew — it isn't a classifier judgement, it's the audio itself.

### Same classifier, 5× the sample

| Dimension | April (n=14, original) | **April (n=69, backfilled)** | June–July (n=49) | Held? |
|---|---|---|---|---|
| lifestyle/entertainment | 64% | **77%** | 45% | ✅ held, stronger |
| talking-head | 21% | **16%** | 37% | ✅ held, stronger |
| narrative = entertainment | 79% | **65%** | 51% | ✅ held |
| in-content CTA | 0% | **1%** | 6% | ✅ held |
| aimed at the ICP | 7% | **20%** | 10% | ⚠️ **revised up** |
| Marine credibility | 7% | **25%** | 12% | ⚠️ **revised up** |

**Verdict: the core inference held, and two numbers were wrong in an interesting direction.**
- The central claim is **confirmed and strengthened**: April was overwhelmingly
  entertainment/personality content (77% vs 45% now), *less* talking-head than today, and ran
  essentially **no in-content CTA** (1%).
- Two figures were **understated** by the thin original sample: April actually aimed at the
  military-accountability buyer **20%** of the time (not 7% — double June–July's 10%) and invoked
  **Marine credibility 25%** of the time (not 7% — also double today's 12%).

**What that revision changes in the argument:** April was *not* un-targeted content that happened to
work. It was **entertainment-first content that still carried the military identity** — the Marine
credibility and the servicemember address were present at roughly twice today's rate, wrapped inside
funny, personality-led reels rather than delivered as talking-head lectures. That is a more precise
description of the organic engine than the original write-up gave, and it sharpens recommit item #2:
keep the entertainment format, but keep the military identity visible inside it.

Nothing in §1–3 (the funnel truth or the buyer attribution — both **[DIRECT]** tier) is affected;
those never depended on transcripts.

*Backfill cost: transcription of 51 reels + one re-classification pass ≈ **$0.06** in LLM spend
(logged under `ai_usage.feature = 'april-analysis'`), well inside the $5 gate. No Apify re-scrape was
required.*
