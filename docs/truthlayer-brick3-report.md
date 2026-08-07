# Truth Layer, Brick 3: kill_scale_read + health_check

**Built 2026-08-07. Migrations 076 and 077. Branch `truthlayer-brick3`.**

Brick 1 gave the door registries. Brick 2 made every answer carry its own receipt. Brick 3 puts the first two MONEY questions on the menu: the read the owner's Mondays run on, and the read his mornings run on.

**Two new questions. Fourteen on the locked list, up from twelve. No existing template's numbers changed.**

The weekly ad review used to be an improvised fifteen-query session whose numbers nobody could reproduce a week later. It is now one call.

---

## The architectural decision that shaped the brick

The owner's words, 2026-08-05:

> "I want to give this to Jeremy AI and let it make decisions differently than I have... I want the decision rules to evolve."

So facts and judgment are separated, and the separation is enforced rather than described:

| mode | what it returns |
|---|---|
| `facts` | The complete certified decision-inputs pack, **with no verdicts at all**. This is what an outside advisor consumes. |
| `decide` | Those identical numbers **plus** verdicts under a named, versioned ruleset, every one stamped `under_ruleset` and carrying a `basis`. |
| `watch` | The daily read. **Flags only**, no prescription of any kind. |

A verdict is advice under a lens. The facts are the truth. Adding `jeremy_v1` later is one signed registry row naming its components plus one branch in the verdict engine keyed by ruleset name: never a restructure, and it never edits `zakk_v1`, so the Impact scorecard can grade rulesets against outcomes later.

Facts mode is tested for purity two ways: no verdict FIELD, and none of the verdict VOCABULARY. It must not lead the witness even by word choice.

---

## The threshold law, and what it cost to keep

Every threshold, window and rule these templates apply is read from `registry_definitions` at answer time. `verdict-engine.ts` contains no number the owner signed; they all arrive in a `Ruleset` argument that `rulesets.ts` assembles from the registry.

When a needed definition is missing or unsigned, the answer comes back with **no numbers**, its receipt says `cannot_answer`, and it names what has to be signed. There is deliberately no built-in fallback, because a default is how an uncertified number learns to impersonate a signed one.

### Migration 076: `ruleset_zakk` v1

The one genuinely new registry row. It invents no rule: it **names** the already-signed definitions that together are Zakk's rules, and carries the few numbers the kill/scale read applies that had only ever been written down in prose: the protect and KPI-line ROI bands, the CAC share of ticket, the close-rate basis, and how to read "about 3 expected bookings".

Registering them is what makes the threshold law enforceable rather than aspirational.

### The $270 target reproduces from the registry

The 2026-07-31 session used a $270 target cost per booked call, worked out by hand. Nothing in the registry stated it. The derivation chain now does:

```
CAC target          = 20% x $2,400 standard ticket        = $480.00
close rate          = 75 wins / 138 taken calls (90d)     = 0.5435
cost per call target = $480.00 x 0.5435                   = $260.88
```

$260.88 against the session's $270 is a 3.4% difference, and it is the close rate moving between 7/31 and 8/6, not a different formula. That the chain lands within a few dollars of a number a human reached independently is the strongest evidence I have that the registry now encodes what the owner actually decides on.

### Migration 077: two freshness thresholds

`meta_graph_live` (1 hour) and `adsv2_budget_snapshots` (26 hours). Brick 2 only flags sources that have a threshold row, so without these a `health_check` answer that fell back to stored rows would have sailed through with an empty `stale` list: looking live while being anything but.

---

## What each question does

### `kill_scale_read(client, mode, date_from?, date_to?, ruleset?)`

Window defaults to the trailing 14 days ending yesterday Eastern, read from `decision_cadence v1`, not from a number typed in code.

Every funnel and spend number comes through `adsv2_window_leaves`, **the same pre-aggregation the Ads v2 tab paints from**. Windowing it differently is allowed; reimplementing it is not. A decision read that recomputed the funnel its own way would eventually disagree with the tab, and then the owner would have two numbers and no way to choose.

Per ad: spend, last-7-day run rate (`daily_run_rate v1`, never a calendar average), DMs, booked, taken, shown, closes, collected, collected ROI, cost per DM, cost per booked call, days live, link CTR, the 72-hour fatigue measurement, prior-window history, and copy pointers. Per ad set: the rollup, the live dial, freed-$/day if killed, the kill-kills-campaign warning, and scaling headroom off `scaling_ladder v1`. Plus per-creator economics, the budget map reconciled to yesterday's real spend, and the named closes so the owner can tie back to the sales sheet by eye.

### `health_check(client)`

The one template allowed a live external read, because its whole point is what stored rows cannot show: a campaign stuck in review burns nothing, so it writes nothing. 8-second budget per creator, one retry, per-creator isolation, 5-minute cache. Meta code 17 (rate limit) **stops**: no retry, no poll.

Its findings are the one exception to `touch_floor_72h v1`, which says so itself: breakage is acted on immediately, because it is not a performance signal.

---

## Test output, verbatim

### The 2026-07-31 verdict fixtures (pure, immune to data drift)

```
✔ GOLDEN 2026-07-31: the Direct CTA roster is a KILL: the one that freed $50/day (16.956375ms)
✔ GOLDEN 2026-07-31: FIT at 4.13x is PROTECT (0.23275ms)
✔ GOLDEN 2026-07-31: STRENGTH at 5.05x is PROTECT (0.150584ms)
✔ GOLDEN 2026-07-31: PRO at 2.93x sits on the KPI LINE, not in protect (0.159542ms)
✔ GOLDEN 2026-07-31: a $40 ad is TOO EARLY: below the evidence floor, no verdict lands (0.255291ms)
✔ GOLDEN 2026-07-31: a $685 ad with 0 bookings had a FAIR TEST, so it is kill-eligible, not starved (0.260209ms)
✔ GOLDEN: Jake's 4-day-old test set is never a KILL: no data, no verdict (0.389916ms)
✔ a tired PROVEN winner is FIXABLE by relaunch, never a kill (0.100208ms)
✔ fatigue younger than the 72 hour touch floor does NOT buy the fixable branch (0.124083ms)
✔ cheap calls that never close is a LEAD QUALITY kill, named as such (0.201292ms)
✔ a proven ad that is NOT fatiguing matches no signed branch, and is NOT defaulted to a kill (0.162625ms)
✔ fresh creative already tested, and still broken, IS a kill (0.243625ms)
✔ an ad whose age cannot be read is treated as young, never as mature (0.160958ms)
✔ every verdict the engine can reach carries under_ruleset and a basis (0.591875ms)
✔ an unknown ruleset is never approximated with the rules of a known one (0.296791ms)
✔ freed budget is claimed ONLY when every ad in the set is a kill (0.519083ms)
✔ killing the last live ad set warns that it takes the campaign with it (0.239541ms)
✔ the scaling ladder doubles at the bottom and steps 20-33% above $200/day (0.411875ms)
✔ no step is earned below the cash ROI at which budget becomes a floor (0.114792ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 336.240083
```

These feed FIXED inputs to the pure verdict engine, so they pin the LOGIC and are immune to data drift. The 2026-07-31 review reproduces here whatever the tables do next.

### kill_scale_read, against a constructed database

```
✔ FACTS MODE IS PURE: no verdict field, and none of the verdict vocabulary (5.702833ms)
✔ every verdict in a decide answer carries under_ruleset (5.802667ms)
✔ an unknown ruleset is REFUSED, and the refusal lists the ones that exist (0.7865ms)
✔ a ruleset cannot be smuggled into a mode that returns no verdicts (0.375292ms)
✔ WATCH MODE VERB SCAN: not one forbidden verb anywhere in the output (1.755917ms)
✔ the fatigue flag ships LABELLED as an unvalidated rule (0.667083ms)
✔ REGISTRY THRESHOLD LAW: a missing definition means cannot_answer, naming it (0.458417ms)
✔ a missing definition FIELD is reported as precisely as a missing definition (0.307833ms)
✔ every signed rule the answer APPLIED is cited in the receipt, with its real version (2.982791ms)
✔ decide mode carries a coverage block, because it is a money answer (2.780583ms)
✔ the window defaults to the trailing 14 days ending yesterday, from decision_cadence (0.820167ms)
✔ an unknown mode is refused, and an unknown parameter is never silently ignored (0.311833ms)
✔ the answer states what it excludes: keywordless ads, organic, and awaiting review (0.506458ms)
✔ nothing in any mode claims to have executed anything (1.471ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 378.520834
```

### health_check, with Meta mocked

```
✔ META DOWN: the answer falls back to stored, the receipt flags it stale, and it SAYS so (4.09075ms)
✔ AN UNCHECKED CREATOR IS NEVER REPORTED AS 'go' (1.552125ms)
✔ A CAMPAIGN STUCK IN REVIEW is a no_go, with the reason attached (15.958291ms)
✔ AN ACTIVE CAMPAIGN WITH NO DELIVERABLE AD is caught: it spends nothing while looking healthy (1.056167ms)
✔ A RATE LIMIT STOPS. It does not retry and it does not poll (1.715041ms)
✔ A DEAD TOKEN is itself a finding, and no part of the token appears anywhere (2.974958ms)
✔ a live read reconciles the dials to yesterday's real spend (0.994375ms)
✔ a shortfall past Meta's daily flex IS flagged (1.220333ms)
✔ health_check never claims to have fixed anything (1.022625ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 385.471792
```

### Golden, against the REAL database and the live signed registry

```
✔ GOLDEN: ruleset zakk_v1 assembles from the LIVE signed registry (925.796208ms)
✔ GOLDEN: the watch-mode speaking rules come from the live signed decision_cadence (329.908792ms)
✔ GOLDEN: an unknown ruleset is refused against the real registry too (755.970292ms)
✔ GOLDEN LIVE: decide mode for tyson is shape-complete, and every verdict cites a definition (9189.962958ms)
✔ GOLDEN LIVE: the receipt carries coverage, and the four buckets sum exactly (6517.538083ms)
✔ GOLDEN LIVE: the budget map reconciles, and anything that does not is REPORTED (6006.47275ms)
✔ GOLDEN LIVE: facts mode over real data leaks no verdict and no verdict vocabulary (5247.097125ms)
✔ GOLDEN LIVE: watch mode over real data uses not one forbidden verb (5504.859209ms)
✔ GOLDEN LIVE: health_check answers per creator, and never calls an unchecked creator a go (5793.0765ms)
✔ GOLDEN LIVE: both new questions are on the locked list and reachable only through the door (6.053791ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40945.671708
```

### Full repo suite

```
ℹ tests 268
ℹ suites 0
ℹ pass 267
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Baseline before this brick was 216 tests, 215 passing. Brick 3 adds 52 and all 52 pass.

The single failure is **pre-existing and unrelated**: `ads-tracker-export.html inline app compiles (browser-equivalent Babel parse)`. I verified it directly rather than assuming: `git show origin/main:public/ads-tracker-export.html | grep -c 'type="text/babel"'` returns **0**, so the block the test looks for is absent on `origin/main` itself, and `git diff HEAD -- public/ads-tracker-export.html` is empty, so I never touched the file. It is the shared-file hazard already on record for that export.

---

## One full decide answer

Real answer, real data, `kill_scale_read` for Tyson in `decide` mode over the trailing 14 days ending 2026-08-06, verified byte-for-byte against live output.

**One elision, stated precisely:** the `ads` and `ad_verdicts` arrays are filtered to the 5 ads with $100 or more of spend. The 50 omitted ads are every ad below the evidence floor, and every one of them has the verdict `too_early` with an identical basis apart from its own spend figure. Nothing else is removed; the receipt, economics, ad sets, budget map and named closes are complete and untouched.

```json
{
  "question_key": "kill_scale_read",
  "question": "The kill-or-scale read for one creator (or all of them): every live ad and ad set with its spend, run rate, funnel, cash and collected ROI. In facts mode it returns the decision inputs with no verdicts at all; in decide mode it adds a verdict per ad and ad set under a named decision ruleset; in watch mode it returns daily flags only, with no recommendation of any kind.",
  "params": {
    "client": "tyson",
    "mode": "decide",
    "date_from": "2026-07-24",
    "date_to": "2026-08-06",
    "ruleset": "zakk_v1"
  },
  "answers": {
    "account": "tyson",
    "window": {
      "from": "2026-07-24",
      "to": "2026-08-06"
    },
    "run_rate_window": {
      "from": "2026-07-31",
      "to": "2026-08-06"
    },
    "units": "Money is in USD CENTS throughout. Collected ROI is a multiple. Link CTR is a share between 0 and 1.",
    "economics": [
      {
        "client": "tyson",
        "standard_ticket_usd_cents": 240000,
        "cac_target_usd_cents": 48000,
        "close_rate": 0.5435,
        "close_rate_basis": "trailing 90 days of ad-attributed taken calls and wins, ending 2026-08-06. The target cost per booked call below is exactly this rate multiplied by the CAC target, so the arithmetic on this answer reproduces.",
        "close_rate_taken_calls": 138,
        "close_rate_wins": 75,
        "used_account_wide_close_rate": false,
        "cost_per_call_target_usd_cents": 26088
      }
    ],
    "ads": [
      {
        "ad_id": "52589686209064",
        "keyword": "fit",
        "client": "tyson",
        "adset_id": "52589686189864",
        "campaign_id": "52570597860064",
        "ad_name_verbatim": "FIT",
        "adset_name_verbatim": "FIT - Warm Audience Stack (relaunch 7/21)",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "delivery_state": "active",
        "spend_usd_cents": 161701,
        "daily_run_rate_usd_cents": 11354,
        "impressions": 120553,
        "clicks": 951,
        "link_ctr": 0.00789,
        "dms": 109,
        "booked": 7,
        "taken": 15,
        "shown": 3,
        "closes": 10,
        "collected_usd_cents": 1199900,
        "collected_roi": 7.42,
        "cost_per_dm_usd_cents": 1483,
        "cost_per_booked_call_usd_cents": 23100,
        "days_live": 18,
        "first_active_day": "2026-07-21",
        "last_active_day": "2026-08-07",
        "cost_per_call_target_usd_cents": 26088,
        "fatigue": {
          "cost_per_result_rising": false,
          "ctr_falling": true,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 2613,
          "cost_per_dm_now_usd_cents": 1426,
          "link_ctr_before": 0.00768,
          "link_ctr_now": 0.00749
        },
        "history": {
          "reached_kpi_line_before": true,
          "best_prior_roi": 5.68,
          "best_prior_window": "2026-06-26 to 2026-07-09",
          "basis": "the 3 trailing windows of the same length immediately before this one, counting only windows where the ad cleared the 100 dollar evidence floor"
        },
        "copy_pointer": {
          "ad_creative_copy_ad_id": "52589686209064",
          "has_primary_text": true,
          "has_on_image_text": true,
          "extracted_at": "2026-07-21T10:20:37.566938+00:00"
        }
      },
      {
        "ad_id": "52575887987664",
        "keyword": "now",
        "client": "tyson",
        "adset_id": "52575879187864",
        "campaign_id": "52564462555664",
        "ad_name_verbatim": "NOW",
        "adset_name_verbatim": "TEST \u00b7 Lead Magnet \u00b7 50 (6/24)",
        "campaign_name_verbatim": "Tyson - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 66567,
        "daily_run_rate_usd_cents": 7412,
        "impressions": 50087,
        "clicks": 453,
        "link_ctr": 0.00904,
        "dms": 112,
        "booked": 1,
        "taken": 2,
        "shown": 0,
        "closes": 1,
        "collected_usd_cents": 239900,
        "collected_roi": 3.6,
        "cost_per_dm_usd_cents": 594,
        "cost_per_booked_call_usd_cents": 66567,
        "days_live": 46,
        "first_active_day": "2026-06-23",
        "last_active_day": "2026-08-07",
        "cost_per_call_target_usd_cents": 26088,
        "fatigue": {
          "cost_per_result_rising": false,
          "ctr_falling": true,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 638,
          "cost_per_dm_now_usd_cents": 618,
          "link_ctr_before": 0.00925,
          "link_ctr_now": 0.00886
        },
        "history": {
          "reached_kpi_line_before": false,
          "best_prior_roi": null,
          "best_prior_window": null,
          "basis": "the 3 trailing windows of the same length immediately before this one, counting only windows where the ad cleared the 100 dollar evidence floor"
        },
        "copy_pointer": {
          "ad_creative_copy_ad_id": "52575887987664",
          "has_primary_text": true,
          "has_on_image_text": true,
          "extracted_at": "2026-07-01T05:23:49.249354+00:00"
        }
      },
      {
        "ad_id": "52581821053064",
        "keyword": "pro",
        "client": "tyson",
        "adset_id": "52581820968064",
        "campaign_id": "52570597860064",
        "ad_name_verbatim": "PRO",
        "adset_name_verbatim": "7/1 - SCALE - Revived Winners",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "delivery_state": "active",
        "spend_usd_cents": 134189,
        "daily_run_rate_usd_cents": 10204,
        "impressions": 94358,
        "clicks": 709,
        "link_ctr": 0.00751,
        "dms": 65,
        "booked": 2,
        "taken": 5,
        "shown": 0,
        "closes": 3,
        "collected_usd_cents": 559900,
        "collected_roi": 4.17,
        "cost_per_dm_usd_cents": 2064,
        "cost_per_booked_call_usd_cents": 67095,
        "days_live": 38,
        "first_active_day": "2026-07-01",
        "last_active_day": "2026-08-07",
        "cost_per_call_target_usd_cents": 26088,
        "fatigue": {
          "cost_per_result_rising": true,
          "ctr_falling": true,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 2366,
          "cost_per_dm_now_usd_cents": 2588,
          "link_ctr_before": 0.00708,
          "link_ctr_now": 0.00692
        },
        "history": {
          "reached_kpi_line_before": true,
          "best_prior_roi": 9.53,
          "best_prior_window": "2026-06-26 to 2026-07-09",
          "basis": "the 3 trailing windows of the same length immediately before this one, counting only windows where the ad cleared the 100 dollar evidence floor"
        },
        "copy_pointer": {
          "ad_creative_copy_ad_id": "52581821053064",
          "has_primary_text": true,
          "has_on_image_text": true,
          "extracted_at": "2026-07-01T16:01:20.560676+00:00"
        }
      },
      {
        "ad_id": "52589686048264",
        "keyword": "strength",
        "client": "tyson",
        "adset_id": "52589686019064",
        "campaign_id": "52570597860064",
        "ad_name_verbatim": "STRENGTH",
        "adset_name_verbatim": "STRENGTH - Warm Audience Stack",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "delivery_state": "active",
        "spend_usd_cents": 86120,
        "daily_run_rate_usd_cents": 6213,
        "impressions": 61722,
        "clicks": 521,
        "link_ctr": 0.00844,
        "dms": 66,
        "booked": 0,
        "taken": 0,
        "shown": 0,
        "closes": 0,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "cost_per_dm_usd_cents": 1305,
        "cost_per_booked_call_usd_cents": null,
        "days_live": 18,
        "first_active_day": "2026-07-21",
        "last_active_day": "2026-08-07",
        "cost_per_call_target_usd_cents": 26088,
        "fatigue": {
          "cost_per_result_rising": true,
          "ctr_falling": false,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 1067,
          "cost_per_dm_now_usd_cents": 1261,
          "link_ctr_before": 0.00803,
          "link_ctr_now": 0.00873
        },
        "history": {
          "reached_kpi_line_before": true,
          "best_prior_roi": 6.28,
          "best_prior_window": "2026-07-10 to 2026-07-23",
          "basis": "the 3 trailing windows of the same length immediately before this one, counting only windows where the ad cleared the 100 dollar evidence floor"
        },
        "copy_pointer": {
          "ad_creative_copy_ad_id": "52589686048264",
          "has_primary_text": true,
          "has_on_image_text": true,
          "extracted_at": "2026-07-21T10:20:37.805317+00:00"
        }
      },
      {
        "ad_id": "52593582638064",
        "keyword": "trim",
        "client": "tyson",
        "adset_id": "52593581838264",
        "campaign_id": "52564462555664",
        "ad_name_verbatim": "TRIM",
        "adset_name_verbatim": "TEST \u00b7 Direct CTA \u00b7 5 (vet ICP)",
        "campaign_name_verbatim": "Tyson - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 48934,
        "daily_run_rate_usd_cents": 6991,
        "impressions": 39000,
        "clicks": 250,
        "link_ctr": 0.00641,
        "dms": 16,
        "booked": 0,
        "taken": 0,
        "shown": 0,
        "closes": 0,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "cost_per_dm_usd_cents": 3058,
        "cost_per_booked_call_usd_cents": null,
        "days_live": 8,
        "first_active_day": "2026-07-31",
        "last_active_day": "2026-08-07",
        "cost_per_call_target_usd_cents": 26088,
        "fatigue": {
          "cost_per_result_rising": true,
          "ctr_falling": false,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 1840,
          "cost_per_dm_now_usd_cents": 6373,
          "link_ctr_before": 0.0064,
          "link_ctr_now": 0.00655
        },
        "history": {
          "reached_kpi_line_before": false,
          "best_prior_roi": null,
          "best_prior_window": null,
          "basis": "the 3 trailing windows of the same length immediately before this one, counting only windows where the ad cleared the 100 dollar evidence floor"
        },
        "copy_pointer": {
          "ad_creative_copy_ad_id": "52593582638064",
          "has_primary_text": false,
          "has_on_image_text": false,
          "extracted_at": "2026-07-31T16:20:15.50053+00:00"
        }
      }
    ],
    "ad_sets": [
      {
        "adset_id": "52589686189864",
        "campaign_id": "52570597860064",
        "adset_name_verbatim": "FIT - Warm Audience Stack (relaunch 7/21)",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "client": "tyson",
        "spend_usd_cents": 161701,
        "dms": 109,
        "booked": 7,
        "taken": 15,
        "shown": 3,
        "closes": 10,
        "collected_usd_cents": 1199900,
        "collected_roi": 7.42,
        "daily_budget_usd_cents": 11500,
        "budget_level": "adset",
        "ad_ids": [
          "52589686209064"
        ]
      },
      {
        "adset_id": "52581820968064",
        "campaign_id": "52570597860064",
        "adset_name_verbatim": "7/1 - SCALE - Revived Winners",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "client": "tyson",
        "spend_usd_cents": 138142,
        "dms": 66,
        "booked": 2,
        "taken": 5,
        "shown": 0,
        "closes": 3,
        "collected_usd_cents": 559900,
        "collected_roi": 4.05,
        "daily_budget_usd_cents": 10000,
        "budget_level": "adset",
        "ad_ids": [
          "52581821053064",
          "52581821039064"
        ]
      },
      {
        "adset_id": "52589686019064",
        "campaign_id": "52570597860064",
        "adset_name_verbatim": "STRENGTH - Warm Audience Stack",
        "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
        "client": "tyson",
        "spend_usd_cents": 86120,
        "dms": 66,
        "booked": 0,
        "taken": 0,
        "shown": 0,
        "closes": 0,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "daily_budget_usd_cents": 6000,
        "budget_level": "adset",
        "ad_ids": [
          "52589686048264"
        ]
      },
      {
        "adset_id": "52575879187864",
        "campaign_id": "52564462555664",
        "adset_name_verbatim": "TEST \u00b7 Lead Magnet \u00b7 50 (6/24)",
        "campaign_name_verbatim": "Tyson - TESTING",
        "client": "tyson",
        "spend_usd_cents": 79551,
        "dms": 117,
        "booked": 2,
        "taken": 3,
        "shown": 1,
        "closes": 2,
        "collected_usd_cents": 359900,
        "collected_roi": 4.52,
        "daily_budget_usd_cents": 10000,
        "budget_level": "adset",
        "ad_ids": [
          "52575889190464",
          "52575886729464",
          "52575886874464",
          "52575888633464",
          "52575888509864",
          "52575889153464",
          "52575884944264",
          "52575887834664",
          "52575886392464",
          "52575889562064",
          "52575888967664",
          "52575884439664",
          "52575886988264",
          "52575888306664",
          "52575888841864",
          "52575889959664",
          "52575895930664",
          "52575889736464",
          "52575889777064",
          "52575889988464",
          "52575888131264",
          "52575889111464",
          "52575889822464",
          "52575887611464",
          "52575887987664",
          "52575886633264",
          "52575885189664",
          "52575887501064",
          "52575889877464",
          "52575889424264",
          "52575885842264",
          "52575886204064",
          "52575889323864",
          "52575889690064",
          "52575886528264",
          "52575885697264",
          "52575885372864",
          "52575884791264",
          "52575887191064",
          "52575887303264",
          "52575885944264",
          "52575889932264",
          "52575889357464",
          "52575889642864",
          "52575885529264",
          "52575886089664"
        ]
      },
      {
        "adset_id": "52593581838264",
        "campaign_id": "52564462555664",
        "adset_name_verbatim": "TEST \u00b7 Direct CTA \u00b7 5 (vet ICP)",
        "campaign_name_verbatim": "Tyson - TESTING",
        "client": "tyson",
        "spend_usd_cents": 62794,
        "dms": 20,
        "booked": 0,
        "taken": 0,
        "shown": 0,
        "closes": 0,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "daily_budget_usd_cents": 10000,
        "budget_level": "adset",
        "ad_ids": [
          "52593582602064",
          "52593582679064",
          "52593582669264",
          "52593582623064",
          "52593582638064"
        ]
      }
    ],
    "budget_map": {
      "entities": [
        {
          "level": "adset",
          "entity_id": "52575879187864",
          "campaign_id": "52564462555664",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8917,
          "pace_pct_of_budget": 89.2
        },
        {
          "level": "adset",
          "entity_id": "52581820968064",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8347,
          "pace_pct_of_budget": 83.5
        },
        {
          "level": "adset",
          "entity_id": "52589686019064",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 6000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 5410,
          "pace_pct_of_budget": 90.2
        },
        {
          "level": "adset",
          "entity_id": "52589686189864",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 11500,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8651,
          "pace_pct_of_budget": 75.2
        },
        {
          "level": "adset",
          "entity_id": "52593581838264",
          "campaign_id": "52564462555664",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8710,
          "pace_pct_of_budget": 87.1
        }
      ],
      "mismatches": [],
      "total_daily_usd_cents": 47500,
      "yesterday": "2026-08-06"
    },
    "closes_named": [
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Isaac Gustafson",
        "sale_day": "2026-07-24",
        "collected_usd_cents": 90000,
        "closer": "AUSTIN"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Davy Bradley",
        "sale_day": "2026-07-24",
        "collected_usd_cents": 120000,
        "closer": "ERIN"
      },
      {
        "adset_id": null,
        "keyword": "good",
        "prospect": "Hunter Chapman",
        "sale_day": "2026-07-25",
        "collected_usd_cents": 159900,
        "closer": "ERIN"
      },
      {
        "adset_id": null,
        "keyword": "locked",
        "prospect": "Dany Jimenez",
        "sale_day": "2026-07-25",
        "collected_usd_cents": 220000,
        "closer": "AUSTIN"
      },
      {
        "adset_id": null,
        "keyword": "gym",
        "prospect": "Lexus G.",
        "sale_day": "2026-07-27",
        "collected_usd_cents": 80000,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52581820968064",
        "keyword": "pro",
        "prospect": "Alex Raines",
        "sale_day": "2026-07-28",
        "collected_usd_cents": 200000,
        "closer": "AUSTIN"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Kristin Anderson",
        "sale_day": "2026-07-28",
        "collected_usd_cents": 179900,
        "closer": "ERIN"
      },
      {
        "adset_id": null,
        "keyword": "good",
        "prospect": "Clare Welsh",
        "sale_day": "2026-07-29",
        "collected_usd_cents": 100000,
        "closer": "BROZ"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Corey Joseph",
        "sale_day": "2026-07-30",
        "collected_usd_cents": 120000,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52575879187864",
        "keyword": "now",
        "prospect": "Kayla Elliot",
        "sale_day": "2026-07-30",
        "collected_usd_cents": 239900,
        "closer": "WOBBE"
      },
      {
        "adset_id": null,
        "keyword": "loaded",
        "prospect": "Maximillian Mailloux",
        "sale_day": "2026-07-30",
        "collected_usd_cents": 199900,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52575879187864",
        "keyword": "tough",
        "prospect": "Domingo Mendez",
        "sale_day": "2026-07-30",
        "collected_usd_cents": 120000,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Piper Baldwin",
        "sale_day": "2026-08-01",
        "collected_usd_cents": 20000,
        "closer": "AUSTIN"
      },
      {
        "adset_id": "52581820968064",
        "keyword": "pro",
        "prospect": "Jacob Duran",
        "sale_day": "2026-08-01",
        "collected_usd_cents": 239900,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Vincent Pace",
        "sale_day": "2026-08-02",
        "collected_usd_cents": 120000,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Alexi Walker",
        "sale_day": "2026-08-04",
        "collected_usd_cents": 80000,
        "closer": "WILL"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Adrian Hildago",
        "sale_day": "2026-08-04",
        "collected_usd_cents": 190000,
        "closer": "WILL"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Carter Peterson",
        "sale_day": "2026-08-05",
        "collected_usd_cents": 180000,
        "closer": "BROZ"
      },
      {
        "adset_id": "52581820968064",
        "keyword": "pro",
        "prospect": "Hunter Krivokucha",
        "sale_day": "2026-08-05",
        "collected_usd_cents": 120000,
        "closer": "WOBBE"
      },
      {
        "adset_id": "52589686189864",
        "keyword": "fit",
        "prospect": "Marc Lannuzzi",
        "sale_day": "2026-08-06",
        "collected_usd_cents": 100000,
        "closer": "WOBBE"
      }
    ],
    "counting_note": "booked counts DISTINCT PEOPLE with a booking on a pinned sales calendar, carrying a keyword. taken counts distinct people with a taken-call row in the sales tracker. They are two different populations read from two different systems, so taken can legitimately exceed booked for the same ad: a call booked off-calendar, or through a duplicate contact, is taken without ever being booked here. Treat booked as a floor.",
    "mode": "decide",
    "under_ruleset": "zakk_v1",
    "ruleset_definition": {
      "name": "ruleset_zakk",
      "version": 1
    },
    "ruleset_components": [
      "verdict_floors_kill_tree",
      "scaling_ladder",
      "decision_cadence",
      "daily_run_rate",
      "touch_floor_72h",
      "learning_phase_awareness",
      "structure_rules",
      "roi_window",
      "sales_lag",
      "unit_economics",
      "pricing_currency"
    ],
    "ad_verdicts": [
      {
        "ad_id": "52589686209064",
        "keyword": "fit",
        "verdict": "protect",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $11,999.00 collected on $1,617.01 spend is 7.42x, at or above the 3x protect line, from 10 closes.",
        "definitions_applied": [
          "ruleset_zakk",
          "collected_vs_contracted",
          "roi_window"
        ],
        "computed": {
          "collected_roi": 7.42,
          "cost_per_booked_call_usd_cents": 23100,
          "expected_bookings_at_target": 6.2,
          "kill_eligible": true
        }
      },
      {
        "ad_id": "52575887987664",
        "keyword": "now",
        "verdict": "protect",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $2,399.00 collected on $665.67 spend is 3.6x, at or above the 3x protect line, from 1 close.",
        "definitions_applied": [
          "ruleset_zakk",
          "collected_vs_contracted",
          "roi_window"
        ],
        "computed": {
          "collected_roi": 3.6,
          "cost_per_booked_call_usd_cents": 66567,
          "expected_bookings_at_target": 2.55,
          "kill_eligible": true
        }
      },
      {
        "ad_id": "52581821053064",
        "keyword": "pro",
        "verdict": "protect",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $5,599.00 collected on $1,341.89 spend is 4.17x, at or above the 3x protect line, from 3 closes.",
        "definitions_applied": [
          "ruleset_zakk",
          "collected_vs_contracted",
          "roi_window"
        ],
        "computed": {
          "collected_roi": 4.17,
          "cost_per_booked_call_usd_cents": 67095,
          "expected_bookings_at_target": 5.14,
          "kill_eligible": true
        }
      },
      {
        "ad_id": "52589686048264",
        "keyword": "strength",
        "verdict": "tree_unresolved",
        "under_ruleset": "zakk_v1",
        "basis": "verdict_floors_kill_tree v1: this ad is below the 2x line at 0x on $861.20, but it DID reach 2x in an earlier window and it is not showing the sustained fatigue the FIXABLE branch requires (cost per result rising, link CTR not falling). No branch of the signed kill tree covers that case, and it is NOT being defaulted to a kill: the tree forbids naked judgment calls. What resolves it is one fact nothing here records: has fresh creative already been tested on this ad? If yes, the signed tree makes it a KILL. If no, refreshing the creative is the untried move.",
        "definitions_applied": [
          "verdict_floors_kill_tree",
          "touch_floor_72h",
          "ruleset_zakk"
        ],
        "computed": {
          "collected_roi": 0,
          "cost_per_booked_call_usd_cents": null,
          "expected_bookings_at_target": 3.3,
          "kill_eligible": true
        }
      },
      {
        "ad_id": "52593582638064",
        "keyword": "trim",
        "verdict": "starved_untested",
        "under_ruleset": "zakk_v1",
        "basis": "verdict_floors_kill_tree v1: a KILL requires spend sufficient that about 3 bookings were EXPECTED. $489.34 at the $260.88 target cost per call expects only 1.88 bookings, so this ad has been funded past the floor but never fairly tested. This is \"starved-untested\", never \"failed\".",
        "definitions_applied": [
          "verdict_floors_kill_tree",
          "ruleset_zakk"
        ],
        "computed": {
          "collected_roi": 0,
          "cost_per_booked_call_usd_cents": null,
          "expected_bookings_at_target": 1.88,
          "kill_eligible": false
        }
      }
    ],
    "ad_set_verdicts": [
      {
        "adset_id": "52589686189864",
        "adset_name_verbatim": "FIT - Warm Audience Stack (relaunch 7/21)",
        "verdict": "protect",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $11,999.00 collected on $1,617.01 spend (7.42x) across 1 ad, 10 closes, 7 bookings. Ad verdicts: protect.",
        "freed_usd_cents_per_day": null,
        "kill_kills_campaign_warning": null,
        "scaling_headroom": {
          "eligible": true,
          "current_daily_usd_cents": 11500,
          "next_step_usd_cents": 20000,
          "basis": "scaling_ladder v1: at 7.42x cash ROI, budget is a floor not a cap. $115.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week."
        },
        "computed": {
          "collected_roi": 7.42
        }
      },
      {
        "adset_id": "52581820968064",
        "adset_name_verbatim": "7/1 - SCALE - Revived Winners",
        "verdict": "mixed",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $5,599.00 collected on $1,381.42 spend (4.05x) across 2 ads, 3 closes, 2 bookings. Ad verdicts: protect, too_early.",
        "freed_usd_cents_per_day": null,
        "kill_kills_campaign_warning": null,
        "scaling_headroom": {
          "eligible": true,
          "current_daily_usd_cents": 10000,
          "next_step_usd_cents": 20000,
          "basis": "scaling_ladder v1: at 4.05x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week."
        },
        "computed": {
          "collected_roi": 4.05
        }
      },
      {
        "adset_id": "52589686019064",
        "adset_name_verbatim": "STRENGTH - Warm Audience Stack",
        "verdict": "tree_unresolved",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $0.00 collected on $861.20 spend (0x) across 1 ad, 0 closes, 0 bookings. Ad verdicts: tree_unresolved.",
        "freed_usd_cents_per_day": null,
        "kill_kills_campaign_warning": null,
        "scaling_headroom": {
          "eligible": false,
          "current_daily_usd_cents": 6000,
          "next_step_usd_cents": null,
          "basis": "scaling_ladder v1: 0x cash ROI is below the 2x at which budget becomes a floor rather than a cap, so no step is earned."
        },
        "computed": {
          "collected_roi": 0
        }
      },
      {
        "adset_id": "52575879187864",
        "adset_name_verbatim": "TEST \u00b7 Lead Magnet \u00b7 50 (6/24)",
        "verdict": "mixed",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $3,599.00 collected on $795.51 spend (4.52x) across 46 ads, 2 closes, 2 bookings. Ad verdicts: too_early, protect.",
        "freed_usd_cents_per_day": null,
        "kill_kills_campaign_warning": null,
        "scaling_headroom": {
          "eligible": true,
          "current_daily_usd_cents": 10000,
          "next_step_usd_cents": 20000,
          "basis": "scaling_ladder v1: at 4.52x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week."
        },
        "computed": {
          "collected_roi": 4.52
        }
      },
      {
        "adset_id": "52593581838264",
        "adset_name_verbatim": "TEST \u00b7 Direct CTA \u00b7 5 (vet ICP)",
        "verdict": "mixed",
        "under_ruleset": "zakk_v1",
        "basis": "ruleset_zakk v1: $0.00 collected on $627.94 spend (0x) across 5 ads, 0 closes, 0 bookings. Ad verdicts: too_early, starved_untested.",
        "freed_usd_cents_per_day": null,
        "kill_kills_campaign_warning": null,
        "scaling_headroom": {
          "eligible": false,
          "current_daily_usd_cents": 10000,
          "next_step_usd_cents": null,
          "basis": "scaling_ladder v1: 0x cash ROI is below the 2x at which budget becomes a floor rather than a cap, so no step is earned."
        },
        "computed": {
          "collected_roi": 0
        }
      }
    ],
    "what_this_is": "Verdicts computed under ruleset zakk_v1, from ruleset_zakk v1 and the signed definitions it composes. Every verdict carries under_ruleset and a basis naming the definitions and the numbers that earned it. A verdict is ADVICE UNDER A LENS, not the truth: the facts above are the truth, and the same question in facts mode returns them with no judgement at all.",
    "undecidable_inputs": {
      "fresh_creative_tested": "false for every ad, because nothing in this system records whether fresh creative has already been tested on an ad. It is a conservative default, NOT a finding. It only ever makes the tree gentler: with it false, an ad reaches a kill through the never-reached-2x branch or not at all, so the default cannot manufacture a kill. Where the tested-creative branch would matter, a human has to supply that fact.",
      "fatigue": "measured over the last 72 hours against the 72 before them, per touch_floor_72h v1, and shown per ad in the pack above. Null for an ad where either half of that comparison had no DMs or no impressions to measure: that is 'not measurable', which is a different fact from 'not fatiguing', and it is never reported as the latter."
    }
  },
  "as_of": [
    {
      "source": "adsv2_dm_facts",
      "last_written_at": "2026-08-07T06:25:15.697402+00:00",
      "note": "the newest stamped DM fact"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-07T06:25:15.822515+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-07T06:25:15.936995+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "warehouse.ads",
      "last_written_at": "2026-08-07T06:25:59.388799+00:00",
      "note": "the last hourly refresh of the merged ads table"
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "adsv2_budget_snapshots",
    "registry_definitions",
    "registry_entities",
    "ad_creative_copy"
  ],
  "note": "These verdicts are advice under ruleset zakk_v1 and are not the only defensible reading of these numbers. Nothing here executes: no budget was moved and no ad was touched.",
  "receipt": {
    "contract_version": 2,
    "question_key": "kill_scale_read",
    "question_version": 1,
    "asked_at": "2026-08-07T07:03:25.583Z",
    "caller": "test",
    "params_as_resolved": {
      "client": "tyson",
      "mode": "decide",
      "date_from": "2026-07-24",
      "date_to": "2026-08-06",
      "ruleset": "zakk_v1"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-24",
      "to": "2026-08-06",
      "kind": "trailing_decision_window"
    },
    "data_version": 380,
    "freshness": [
      {
        "source": "adsv2_dm_facts",
        "last_written_at": "2026-08-07T06:25:15.697402+00:00",
        "note": "the newest stamped DM fact"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-07T06:25:15.822515+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-07T06:25:15.936995+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "warehouse.ads",
        "last_written_at": "2026-08-07T06:25:59.388799+00:00",
        "note": "the last hourly refresh of the merged ads table"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 24,
      "window_cash_usd_cents_total": 3299400,
      "buckets": {
        "ad": {
          "wins": 19,
          "cash_usd_cents": 2659500
        },
        "organic": {
          "wins": 1,
          "cash_usd_cents": 220000
        },
        "misc_chat": {
          "wins": 0,
          "cash_usd_cents": 0
        },
        "awaiting_review": {
          "wins": 4,
          "cash_usd_cents": 419900
        }
      },
      "classified_pct_wins": 83.3,
      "classified_pct_cash": 87.3,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "ads carrying no keyword",
        "count": 0,
        "why": "the whole funnel in this system is joined by keyword, so an ad that never carried one has spend but no DMs, calls or cash that can be tied to it. Those ads are not in this read at all. Their spend is real and is visible in the Ads v2 tab's own totals."
      },
      {
        "what": "organic keyword traffic and rows still awaiting review",
        "count": 0,
        "why": "organic_keywords v1 forbids marked organic keywords from entering ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are excluded from every number here, which understates the funnel rather than flattering it. The receipt's coverage block states the awaiting-review gap in wins and dollars."
      },
      {
        "what": "ads not currently ACTIVE",
        "count": 54,
        "why": "structure_rules v1 keeps paused history out of a live decision unless history is explicitly asked for. These ads still spent inside the window; they are excluded because a decision is about what is running now."
      }
    ],
    "caveats": [
      "These verdicts are advice under ruleset zakk_v1 and are not the only defensible reading of these numbers. Nothing here executes: no budget was moved and no ad was touched.",
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-06, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 83.3% of wins and 87.3% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "directional",
    "definitions_cited": [
      {
        "registry": "warehouse.definitions",
        "name": "spend"
      },
      {
        "registry": "warehouse.definitions",
        "name": "messages"
      },
      {
        "registry": "warehouse.definitions",
        "name": "booked"
      },
      {
        "registry": "warehouse.definitions",
        "name": "taken"
      },
      {
        "registry": "warehouse.definitions",
        "name": "newClients"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collected"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collectedRoi"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "verdict_floors_kill_tree",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "scaling_ladder",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "decision_cadence",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "daily_run_rate",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "touch_floor_72h",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "learning_phase_awareness",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "unit_economics",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "pricing_currency",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "ruleset_zakk",
        "version": 1
      }
    ]
  }
}
```

---

## One full watch answer

Complete and unedited.

```json
{
  "question_key": "kill_scale_read",
  "question": "The kill-or-scale read for one creator (or all of them): every live ad and ad set with its spend, run rate, funnel, cash and collected ROI. In facts mode it returns the decision inputs with no verdicts at all; in decide mode it adds a verdict per ad and ad set under a named decision ruleset; in watch mode it returns daily flags only, with no recommendation of any kind.",
  "params": {
    "client": "tyson",
    "mode": "watch",
    "date_from": "2026-07-24",
    "date_to": "2026-08-06"
  },
  "answers": {
    "account": "tyson",
    "mode": "watch",
    "context_window": {
      "from": "2026-07-24",
      "to": "2026-08-06"
    },
    "recent_window": {
      "from": "2026-08-04",
      "to": "2026-08-06"
    },
    "baseline_window": {
      "from": "2026-07-10",
      "to": "2026-08-06"
    },
    "units": "Money is in USD CENTS throughout. Collected ROI is a multiple. Link CTR is a share between 0 and 1.",
    "flags": [
      {
        "signal": "cost_per_dm_above_account_baseline",
        "magnitude": "$25.88 per DM against a $11.60 trailing 28-day account baseline, 2.2x",
        "duration": "3 days",
        "since": "2026-08-04",
        "closer": "queued for weekly decide",
        "subject": {
          "level": "ad",
          "id": "52581821053064",
          "name_verbatim": "PRO"
        }
      },
      {
        "signal": "cost_per_dm_above_account_baseline",
        "magnitude": "$63.73 per DM against a $11.60 trailing 28-day account baseline, 5.5x",
        "duration": "3 days",
        "since": "2026-08-04",
        "closer": "queued for weekly decide",
        "subject": {
          "level": "ad",
          "id": "52593582638064",
          "name_verbatim": "TRIM"
        }
      },
      {
        "signal": "no_bookings_past_expected_first_booking",
        "magnitude": "$861.20 spent against a $260.88 target cost per booked call, with 0 bookings and 66 DMs",
        "duration": "2026-07-24 to 2026-08-06",
        "since": "2026-07-24",
        "closer": "queued for weekly decide",
        "subject": {
          "level": "ad",
          "id": "52589686048264",
          "name_verbatim": "STRENGTH"
        }
      },
      {
        "signal": "no_bookings_past_expected_first_booking",
        "magnitude": "$489.34 spent against a $260.88 target cost per booked call, with 0 bookings and 16 DMs",
        "duration": "2026-07-24 to 2026-08-06",
        "since": "2026-07-24",
        "closer": "queued for weekly decide",
        "subject": {
          "level": "ad",
          "id": "52593582638064",
          "name_verbatim": "TRIM"
        }
      },
      {
        "signal": "fatigue_signal (unvalidated rule, backtest pending)",
        "magnitude": "cost per DM $23.66 then $25.88, link CTR 0.71% then 0.69%",
        "duration": "72 hours, against the 72 hours before them",
        "since": "2026-08-04",
        "closer": "monitor",
        "subject": {
          "level": "ad",
          "id": "52581821053064",
          "name_verbatim": "PRO"
        }
      }
    ],
    "flag_count": 5,
    "what_this_is": "Daily watch output under decision_cadence v1: observations only. Each flag carries what was seen, how big it was, how long it has held, and one of the two allowed closers. It contains no instruction of any kind, by design, because the flag is data and the prescription belongs to the weekly decide read.",
    "allowed_closers": [
      "monitor",
      "queued for weekly decide"
    ],
    "fatigue_rule_status": "The fatigue flag is an UNVALIDATED rule. It has never been backtested against what actually happened to the ads it would have flagged, and it ships labelled that way rather than looking as certified as the rest of this answer.",
    "budget_map": {
      "entities": [
        {
          "level": "adset",
          "entity_id": "52575879187864",
          "campaign_id": "52564462555664",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8917,
          "pace_pct_of_budget": 89.2
        },
        {
          "level": "adset",
          "entity_id": "52581820968064",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8347,
          "pace_pct_of_budget": 83.5
        },
        {
          "level": "adset",
          "entity_id": "52589686019064",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 6000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 5410,
          "pace_pct_of_budget": 90.2
        },
        {
          "level": "adset",
          "entity_id": "52589686189864",
          "campaign_id": "52570597860064",
          "daily_usd_cents": 11500,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8651,
          "pace_pct_of_budget": 75.2
        },
        {
          "level": "adset",
          "entity_id": "52593581838264",
          "campaign_id": "52564462555664",
          "daily_usd_cents": 10000,
          "delivery_state": "active",
          "yesterday_spend_usd_cents": 8710,
          "pace_pct_of_budget": 87.1
        }
      ],
      "mismatches": [],
      "total_daily_usd_cents": 47500,
      "yesterday": "2026-08-06"
    }
  },
  "definitions_quoted": [
    {
      "key": "spend",
      "label": "Ad spend",
      "meaning": "How much Meta charged to run this ad across the selected days.",
      "source": "Meta, bucketed to Eastern-time days.",
      "format": "usd",
      "is_calculated": false
    },
    {
      "key": "messages",
      "label": "DMs",
      "meaning": "How many different people sent this ad's keyword in a DM.",
      "source": "ManyChat keyword events, counted as distinct people.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "booked",
      "label": "Calls booked",
      "meaning": "How many different people booked a strategy call from this ad's keyword.",
      "source": "GoHighLevel sales-calendar bookings that carry the keyword, counted as distinct people, with reschedules grouped under one person.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "taken",
      "label": "Calls taken",
      "meaning": "How many strategy calls took place in this window, counted on the day the call happened, including ones booked earlier.",
      "source": "The sales tracker, which only lists calls that took place. Counted by call day, so this can differ from the show-rate group, which counts people booked in this window.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "newClients",
      "label": "New clients",
      "meaning": "How many of those calls became a paying client.",
      "source": "The sales tracker wins.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "collected",
      "label": "Collected revenue",
      "meaning": "Cash actually collected from clients tied to this ad's keyword.",
      "source": "The sales tracker, tied to a keyword by hard key only.",
      "format": "usd",
      "is_calculated": false
    },
    {
      "key": "collectedRoi",
      "label": "Collected ROAS",
      "meaning": "The cash collected for every dollar of ad spend, shown as a multiple.",
      "source": "Collected revenue divided by ad spend.",
      "format": "ratio2",
      "is_calculated": true
    }
  ],
  "as_of": [
    {
      "source": "adsv2_dm_facts",
      "last_written_at": "2026-08-07T06:25:15.697402+00:00",
      "note": "the newest stamped DM fact"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-07T06:25:15.822515+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-07T06:25:15.936995+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "warehouse.ads",
      "last_written_at": "2026-08-07T06:25:59.388799+00:00",
      "note": "the last hourly refresh of the merged ads table"
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "adsv2_budget_snapshots",
    "registry_definitions",
    "registry_entities",
    "ad_creative_copy"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "kill_scale_read",
    "question_version": 1,
    "asked_at": "2026-08-07T07:03:33.950Z",
    "caller": "test",
    "params_as_resolved": {
      "client": "tyson",
      "mode": "watch",
      "date_from": "2026-07-24",
      "date_to": "2026-08-06"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-24",
      "to": "2026-08-06",
      "kind": "trailing_decision_window"
    },
    "data_version": 380,
    "freshness": [
      {
        "source": "adsv2_dm_facts",
        "last_written_at": "2026-08-07T06:25:15.697402+00:00",
        "note": "the newest stamped DM fact"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-07T06:25:15.822515+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-07T06:25:15.936995+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "warehouse.ads",
        "last_written_at": "2026-08-07T06:25:59.388799+00:00",
        "note": "the last hourly refresh of the merged ads table"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 24,
      "window_cash_usd_cents_total": 3299400,
      "buckets": {
        "ad": {
          "wins": 19,
          "cash_usd_cents": 2659500
        },
        "organic": {
          "wins": 1,
          "cash_usd_cents": 220000
        },
        "misc_chat": {
          "wins": 0,
          "cash_usd_cents": 0
        },
        "awaiting_review": {
          "wins": 4,
          "cash_usd_cents": 419900
        }
      },
      "classified_pct_wins": 83.3,
      "classified_pct_cash": 87.3,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "ads carrying no keyword",
        "count": 0,
        "why": "the whole funnel in this system is joined by keyword, so an ad that never carried one has spend but no DMs, calls or cash that can be tied to it. Those ads are not in this read at all. Their spend is real and is visible in the Ads v2 tab's own totals."
      },
      {
        "what": "organic keyword traffic and rows still awaiting review",
        "count": 0,
        "why": "organic_keywords v1 forbids marked organic keywords from entering ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are excluded from every number here, which understates the funnel rather than flattering it. The receipt's coverage block states the awaiting-review gap in wins and dollars."
      },
      {
        "what": "ads not currently ACTIVE",
        "count": 54,
        "why": "structure_rules v1 keeps paused history out of a live decision unless history is explicitly asked for. These ads still spent inside the window; they are excluded because a decision is about what is running now."
      }
    ],
    "caveats": [
      "This is the daily watch read. Under decision_cadence v1 it states observations and nothing else; the weekly decide read is where a judgement is made.",
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-06, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 83.3% of wins and 87.3% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "directional",
    "definitions_cited": [
      {
        "registry": "warehouse.definitions",
        "name": "spend"
      },
      {
        "registry": "warehouse.definitions",
        "name": "messages"
      },
      {
        "registry": "warehouse.definitions",
        "name": "booked"
      },
      {
        "registry": "warehouse.definitions",
        "name": "taken"
      },
      {
        "registry": "warehouse.definitions",
        "name": "newClients"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collected"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collectedRoi"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "verdict_floors_kill_tree",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "scaling_ladder",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "decision_cadence",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "daily_run_rate",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "touch_floor_72h",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "learning_phase_awareness",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "unit_economics",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "pricing_currency",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "ruleset_zakk",
        "version": 1
      }
    ]
  },
  "note": "This is the daily watch read. Under decision_cadence v1 it states observations and nothing else; the weekly decide read is where a judgement is made."
}
```

Five flags, not one imperative verb. The verb scan runs over the answer BODY, which is what "watch-mode output" means: the envelope carries the question's own name (`kill_scale_read`, which contains two of the forbidden words) and the receipt quotes signed definitions verbatim (`sales_lag v1` contains "kill"), and neither of those is watch mode choosing to prescribe. Fields ending `_verbatim` are also exempt, because Tyson genuinely has an ad set called "7/1 - SCALE - Revived Winners" and renaming a proper noun Meta assigned would break the reconciliation to Ads Manager that carrying it verbatim exists to provide.

---

## One full health_check answer

Complete and unedited, `client: all`, run live.

```json
{
  "question_key": "health_check",
  "question": "Whether each active creator's ads can actually deliver right now: a live read of Meta's own campaign, ad set and ad statuses, with a go or no-go per campaign and the reason, the live budget dials and their daily total, and yesterday's real spend against what those dials expected. This is the one question that reads Meta directly, because a campaign stuck in review burns nothing and therefore writes no rows for the warehouse to see.",
  "params": {
    "client": "all"
  },
  "answers": {
    "account": "all",
    "checked_at": "2026-08-07T07:03:48.594Z",
    "yesterday_et": "2026-08-06",
    "creators": [
      {
        "client": "jake",
        "source": "stored_fallback",
        "live_read_at": null,
        "stored_as_of_day": "2026-08-05",
        "token_state": "not_configured",
        "rate_limited": false,
        "live_error": "no Meta access token is configured for jake in this environment, so the live check could not run for them.",
        "overall": "unchecked",
        "counts": {
          "active": 30,
          "paused": 32,
          "in_review": 0,
          "rejected": 0,
          "restricted": 0,
          "other": 0
        },
        "campaigns": [
          {
            "campaign_id": "120249890662080185",
            "campaign_name_verbatim": "Jake - TESTING",
            "go_no_go": "go",
            "reasons": [
              "the last stored status for this campaign was ACTIVE, as of 2026-08-05. This is the STORED picture, not a live one."
            ],
            "counts": {}
          }
        ],
        "budget_dials": [
          {
            "level": "adset",
            "entity_id": "120249890728010185",
            "campaign_id": "120249890662080185",
            "daily_usd_cents": 12094,
            "yesterday_spend_usd_cents": 0,
            "pct_of_dial": 0,
            "shortfall_flagged": true
          },
          {
            "level": "adset",
            "entity_id": "120250003126390185",
            "campaign_id": "120249890662080185",
            "daily_usd_cents": 3516,
            "yesterday_spend_usd_cents": 0,
            "pct_of_dial": 0,
            "shortfall_flagged": true
          },
          {
            "level": "adset",
            "entity_id": "120250052887090185",
            "campaign_id": "120249890662080185",
            "daily_usd_cents": 5023,
            "yesterday_spend_usd_cents": 0,
            "pct_of_dial": 0,
            "shortfall_flagged": true
          }
        ],
        "budget_dials_total_daily_usd_cents": 20633,
        "shortfalls": 3
      },
      {
        "client": "tyson",
        "source": "live_meta",
        "live_read_at": "2026-08-07T07:03:48.594Z",
        "stored_as_of_day": null,
        "token_state": "ok",
        "rate_limited": false,
        "live_error": null,
        "overall": "go",
        "counts": {
          "active": 49,
          "paused": 794,
          "in_review": 0,
          "rejected": 0,
          "restricted": 0,
          "other": 0
        },
        "campaigns": [
          {
            "campaign_id": "52570597860064",
            "campaign_name_verbatim": "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
            "go_no_go": "go",
            "reasons": [
              "everything Meta reports for this campaign is deliverable."
            ],
            "counts": {
              "paused": 6,
              "active": 3
            }
          },
          {
            "campaign_id": "52564462555664",
            "campaign_name_verbatim": "Tyson - TESTING",
            "go_no_go": "go",
            "reasons": [
              "everything Meta reports for this campaign is deliverable."
            ],
            "counts": {
              "paused": 77,
              "active": 46
            }
          }
        ],
        "budget_dials": [
          {
            "level": "adset",
            "entity_id": "52575879187864",
            "campaign_id": "52564462555664",
            "daily_usd_cents": 10000,
            "yesterday_spend_usd_cents": 8917,
            "pct_of_dial": 89.2,
            "shortfall_flagged": false
          },
          {
            "level": "adset",
            "entity_id": "52581820968064",
            "campaign_id": "52570597860064",
            "daily_usd_cents": 10000,
            "yesterday_spend_usd_cents": 8347,
            "pct_of_dial": 83.5,
            "shortfall_flagged": false
          },
          {
            "level": "adset",
            "entity_id": "52589686019064",
            "campaign_id": "52570597860064",
            "daily_usd_cents": 6000,
            "yesterday_spend_usd_cents": 5410,
            "pct_of_dial": 90.2,
            "shortfall_flagged": false
          },
          {
            "level": "adset",
            "entity_id": "52589686189864",
            "campaign_id": "52570597860064",
            "daily_usd_cents": 11500,
            "yesterday_spend_usd_cents": 8651,
            "pct_of_dial": 75.2,
            "shortfall_flagged": false
          },
          {
            "level": "adset",
            "entity_id": "52593581838264",
            "campaign_id": "52564462555664",
            "daily_usd_cents": 10000,
            "yesterday_spend_usd_cents": 8710,
            "pct_of_dial": 87.1,
            "shortfall_flagged": false
          }
        ],
        "budget_dials_total_daily_usd_cents": 47500,
        "shortfalls": 0
      }
    ],
    "overall": "unchecked",
    "outcome_key": {
      "go": "read live from Meta, and nothing is blocking delivery.",
      "no_go": "something is blocking delivery, with the reason on the campaign.",
      "unchecked": "Meta could not be read for this creator, so nothing was verified. This is NOT a clean bill of health: the stored statuses shown are the last ones the sync wrote, and the failure this question exists to catch (a campaign that went into review since then) is invisible to them."
    },
    "standing_note": "Anything this answer finds is BREAKAGE, not a performance signal, so it is the one exception to touch_floor_72h v1: a campaign stuck in review, an ad rejected, a restricted account or a dead token is acted on immediately rather than waiting for a 72-hour sustained signal. That exception is written into the signed definition itself.",
    "what_this_is_not": "This says whether the ads CAN deliver, never whether they SHOULD. A campaign can be entirely healthy and losing money and this answer will call it a go.",
    "source_key": {
      "live_meta": "read from the Meta Graph API during this answer.",
      "stored_fallback": "Meta could not be reached, so this is the last stored status picture. It cannot show a campaign that went into review since the last sync."
    }
  },
  "definitions_quoted": [],
  "as_of": [
    {
      "source": "meta_graph_live",
      "last_written_at": null,
      "note": "at least one creator's live Meta read did not succeed, so their picture is the stored one and its freshness is unknown"
    },
    {
      "source": "adsv2_budget_snapshots",
      "last_written_at": null,
      "note": "the daily budget photos, read as of yesterday Eastern"
    }
  ],
  "sources": [
    "meta_graph_live",
    "ads_meta_insights_daily",
    "adsv2_budget_snapshots"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "health_check",
    "question_version": 1,
    "asked_at": "2026-08-07T07:03:48.594Z",
    "caller": "test",
    "params_as_resolved": {
      "client": "all"
    },
    "aliases_resolved": [],
    "window": null,
    "data_version": null,
    "freshness": [
      {
        "source": "meta_graph_live",
        "last_written_at": null,
        "note": "at least one creator's live Meta read did not succeed, so their picture is the stored one and its freshness is unknown"
      },
      {
        "source": "adsv2_budget_snapshots",
        "last_written_at": null,
        "note": "the daily budget photos, read as of yesterday Eastern"
      }
    ],
    "stale": [
      {
        "source": "meta_graph_live",
        "last_written_at": null,
        "threshold_hours": 1,
        "note": "meta_graph_live reported no write time at all, so its freshness is unknown and must not be assumed to be current."
      },
      {
        "source": "adsv2_budget_snapshots",
        "last_written_at": null,
        "threshold_hours": 26,
        "note": "adsv2_budget_snapshots reported no write time at all, so its freshness is unknown and must not be assumed to be current."
      }
    ],
    "coverage": null,
    "exclusions": [
      {
        "what": "any statement about performance",
        "count": 0,
        "why": "this question answers whether the ads can DELIVER, not whether they are working. A campaign can be perfectly healthy and losing money, and this answer would call it a go. Ask kill_scale_read for the money."
      },
      {
        "what": "the live delivery picture for any creator whose Meta read failed",
        "count": 1,
        "why": "Meta could not be reached for them inside this answer's budget, so their section is the STORED picture: the last statuses the sync wrote. A campaign that went into review since that write would not appear here, which is exactly the failure this question exists to catch. Treat those creators as unchecked, not as healthy."
      }
    ],
    "caveats": [
      "At least one creator's picture in this answer is the STORED one, not a live read, and is labelled as such per creator. A creator on the stored fallback has not been checked; do not read their 'go' as a live all-clear.",
      "meta_graph_live reported no write time at all, so its freshness is unknown and must not be assumed to be current.",
      "adsv2_budget_snapshots reported no write time at all, so its freshness is unknown and must not be assumed to be current.",
      "pricing_currency v1: One price book across creators: 3-month $1,200; 6-month standard $2,400 with frequent $2,200 closes (closer-level flexibility; the tracker is the record). Revenue reports in USD. Jake's ad account bills in AUD; spend converts at the synced fx rate. Non-USD sale rows convert at sale-date fx.",
      "Jake's ad account bills in AUD, so his spend in this answer has been converted to USD at the synced rate, while the sale money was already USD and was never converted."
    ],
    "certainty": "machine_certain",
    "definitions_cited": [
      {
        "registry": "registry_definitions",
        "name": "pricing_currency",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "touch_floor_72h",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      }
    ]
  },
  "note": "At least one creator's picture in this answer is the STORED one, not a live read, and is labelled as such per creator. A creator on the stored fallback has not been checked; do not read their 'go' as a live all-clear."
}
```

Tyson read live: 2 campaigns, both `go`, 49 active ads against 794 paused, 5 dials totalling $475.00/day, no shortfalls. Jake could not be read in this environment, so he is `unchecked` rather than `go`, and the roster headline is `unchecked` rather than rounding up. The receipt flags `meta_graph_live` as stale with no write time, which is exactly the mechanism that stops a stored answer from reading as a live one.

---

## Honest findings

### 1. The kill tree has a case it does not cover, and I nearly defaulted it to KILL

This is the most important thing in the brick.

`STRENGTH` is live right now: $861.20 spent in the window, 66 DMs, **0 bookings, 0 closes, 0x**. It also hit **6.28x** in the immediately preceding 14-day window. Its 72-hour fatigue read is cost-per-DM rising but link CTR **not** falling, so it is not fatiguing under the signed definition.

Walk `verdict_floors_kill_tree v1` for it:

- **FIXABLE** (sub-2x *with* fatigue signals): no, it is not fatiguing.
- **KILL** (fresh creative already tested, KPIs still broken): unknown; nothing in this system records creative-refresh history.
- **KILL** (never reached 2x at adequate spend): no, it reached 6.28x.
- **LEAD-QUALITY KILL** (KPIs fine, leads do not show or close): no, it has no bookings at all.

**No branch matches.** My first implementation let this fall through to KILL, and the basis string it generated even claimed "no prior window at 2x or better": which was false for this exact ad. That is precisely the "naked unfixable judgment call" the signed statement forbids, and it would have recommended killing a proven 6.28x ad in the voice of a rule the owner signed.

Fixed: the never-reached-2x branch is now gated on actually never having reached it, and the unmatched case returns `tree_unresolved`, which states the four branches it fails and names the single fact that would resolve it. Pinned by a fixture.

**This is a live decision waiting for the owner**, not a hypothetical: STRENGTH is spending $62/day at 0x with a 6.28x history. The system's honest position is that it cannot tell you whether to kill it without knowing whether fresh creative has been tried.

### 2. `health_check` found a real production gap on its first live run

Jake's `ads_meta_insights_daily` rows **stop at 2026-08-05**. His newest `synced_at` is 2026-08-06 01:06 UTC. Tyson's run through 2026-08-07 with a 06:05 UTC sync stamp. Jake has $206.33/day of ACTIVE dials and zero recorded spend against them for 2026-08-06.

What I can verify: the gap in the production database, and that it is one-sided (Tyson unaffected). What I **cannot** verify from here: the cause. Jake's Meta token env vars are absent from the local `.env.local` I ran against, so the `not_configured` this build reports for him locally says nothing about production. This has the shape of the 2026-08-04 Jake status-null incident and is worth someone looking at directly.

### 3. Jake's spend was being compared against USD budgets in AUD

The first live `health_check` reported three shortfalls for Jake. They were fabricated: `adsv2_budget_snapshots` stores dials in USD cents, `ads_meta_insights_daily` stores spend in the ad account's own currency, and Jake bills in AUD. Every day he would have read ~35% short.

Fixed with the same `loadUsdRateMap` / `convertCentsToUsd` path budget-sync and the leaf aggregation use. After the fix Tyson's five dials reconcile at 75.2% to 90.2% of dial, comfortably inside Meta's daily flex, and Jake's remaining zeros are the real gap in finding 2.

### 4. Both creators were being handed the same budget dials

`adsv2_budget_asof` does not return a client key. My first version asked for all creators at once and split afterwards, which silently gave **both** creators the same eight dials and the same $681.33/day total, and listed Tyson's campaigns inside Jake's fallback section. A health check that attributes one creator's campaigns to another is worse than no health check.

Fixed: every stored read is now scoped per creator. Pinned by a live test that asserts no dial id appears under two creators.

### 5. An unchecked creator was reporting "go"

When Meta could not be read, every stored campaign status still said ACTIVE, so the naive rollup said `go` while the prose caveat asked the reader not to believe it. The field a machine reads said all-clear; the machine wins.

`overall` now has three values, and `unchecked` never rounds up to `go`. `token_ok: boolean` also became `token_state: "ok" | "rejected" | "not_configured" | "unknown"`, because "no token in this environment" and "Meta rejected the token" are different problems with different fixes and a boolean cannot tell them apart.

### 6. `definitionsCited` had been dead since Brick 2

Eight questions declared the signed rules they lean on. Nothing ever read the declaration, so none of those names reached a receipt. Under Brick 3's threshold law that is not survivable: a verdict that applies a signed threshold without citing it cannot be audited.

`assembleReceipt` now resolves declared and run-time-applied rules to their **real registry versions** and merges them in, deduped. A live decide answer now cites 13 signed rules. This also fixes the receipts of the six pre-existing questions that had been declaring citations into the void: the only behaviour change outside the two new questions, and it adds information rather than altering a number.

### 7. The published arithmetic did not reproduce, by one cent

The answer reported a close rate rounded to 4 dp but computed the target cost per call from full precision: $260.87 published where the published inputs give $260.88. Trivial money, real problem: a certified answer whose own arithmetic does not reproduce teaches the reader to stop checking it. The rate is now rounded first and the target computed from the rounded value, and the golden test asserts the multiplication ties out.

### 8. "About 3 expected bookings" needed an interpretation, so the interpretation is registry data

$685 at a $270 target is 2.54 expected bookings. Read as round-down that is 2, and a fairly-tested ad gets called "starved" while it keeps burning. Read as nearest it is 3, and the ad is kill-eligible: which is what the 2026-07-31 session concluded by hand for the STAR-class case.

Rather than bury that in code, `expected_bookings_rounding: "nearest"` is a field on `ruleset_zakk` v1, and the STAR fixture pins it.

### 9. Things I could not verify

- **The fatigue rule is unbacktested and ships labelled so.** Its flag literally reads `fatigue_signal (unvalidated rule, backtest pending)` and the answer carries a `fatigue_rule_status` paragraph saying it has never been checked against what happened to the ads it would have flagged. Per the brief, backtesting it is its own later task.
- **`fresh_creative_tested` is always false** because nothing in this system records creative-refresh history. It is a conservative default, not a finding, and the answer says so. It can only ever make the tree gentler: with it false, an ad reaches a kill through the never-reached-2x branch or not at all, so the default cannot manufacture a kill.
- **`booked` and `taken` are different populations.** `booked` counts distinct people with a booking on a pinned sales calendar; `taken` counts distinct people with a taken-call row in the sales tracker. Taken legitimately exceeds booked (FIT: 7 booked, 15 taken). This is the known off-calendar-booking and duplicate-contact pattern, and every facts/decide answer carries a `counting_note` saying to treat booked as a floor. I did not try to fix it; that is the Ads v2 Taken-vs-Booked work.
- **The keyword IS the ad.** `adsv2_window_leaves` is grained on (client, keyword) with `ad_id` being the most recent ad that carried the keyword. So "per ad" here means "per keyword", and an ad that never carried a keyword is absent entirely: stated in the exclusions on every answer. This is inherited from the tab, not introduced here.
- **Latency was measured on one machine, not under load.** A decide answer costs 6 to 8 leaf reads plus the coverage block; live runs came back in roughly 5 to 8 seconds against production. I did not measure it under concurrent load or from Vercel.
- **`data_version` trust still depends on the sync double-fire**, unchanged from Brick 2 and deliberately not fixed here.
- **misc_chat still reads 0 and `is_organic` still rides the registry belt**, inherited from Brick 2 exactly as the brief instructed.

---

## What this changes about Mondays

Tyson's current trailing 14 days, in one call:

| | |
|---|---|
| protect | FIT (7.42x), PRO (4.17x), NOW (3.6x) |
| tree_unresolved | STRENGTH: $861 at 0x, 6.28x history, needs one human fact |
| starved_untested | TRIM: $489 spent, expects 1.88 bookings at target, never fairly tested |
| too_early | 50 ads, all under the $100 evidence floor |

Five ad sets, $475.00/day of live dials, all pacing inside Meta's flex. 20 named closes tying to the cash. 83.3% of wins and 87.3% of cash classified, with the 4 unclassified wins worth $4,199 stated in dollars without being asked.

---

## Deliberately not in this brick

No workers or crons calling these (Brick 9). No skill or enforcement changes (Brick 8). No labeler fixes (Brick 4). No auto-actions of any kind. No backtest of the fatigue rule. No new UI. `kill_scale_inputs` is untouched and still answers from saved windows, because callers depend on it.
