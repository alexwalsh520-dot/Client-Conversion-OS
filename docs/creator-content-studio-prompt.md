# EXECUTION PROMPT: Creator Content Studio (full rebuild of the /content experience)

> To the executing agent (Opus): you are working in the CCOS dashboard repo
> (/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard/). This spec was
> written after a full audit of the existing implementation; every file path and data fact in
> here was verified on 2026-07-08. Where the spec says a thing exists, it exists. Build in the
> phase order given. When ambiguous, choose the simpler, faster-to-read option and leave a
> // SPEC-QUESTION comment.

## 0. What this app is for (hold this while making every decision)

The users are Tyson and Antwan: fitness creators, on their phones, low patience for dashboards.
The app's single job: a feedback loop that shows each creator, clearly and enjoyably, how to
make ORGANIC content that attracts the people who actually BUY (not the people who just view),
which compounds into cheaper leads and wildly more effective retargeting. The constraint being
solved: creators can't see which of their content pulls buyers. Every screen must either show
them that or help them act on it. If a screen wouldn't change what a creator posts next week,
it doesn't belong.

Non-negotiables inherited from the owner:
- Creators must actually READ it. Short, visual, glanceable, mobile-first. No walls of text.
- Everything is framed as ORGANIC content guidance. The word "ad" must not appear anywhere in
  creator-facing UI (details in Phase 4).
- NO financial figures in creator-facing UI, ever: no revenue, no deal amounts, no ROAS. Buyer
  stories yes; dollar values no. (buyer_dossiers.amount exists; never render it to creators.)
- Grading is a dopamine hit, not a report card (Phase 3).
- Plain language. No em dashes. No italics. Dark CCOS theme (#09090b page, #111114 panels,
  #c9a96e gold, Plus Jakarta Sans).
- Charts are smooth curvy lines on real XY axes (Phase 5). recharts@3.7 is already installed.

## 1. Current state (verified; the parts you'll touch)

- Shell: src/app/content/ContentClient.tsx — creator toggle (tyson/antwan), 3-mode switch
  (analytics | coach | buyers), share-link button. Views in src/components/content/:
  AnalyticsView.tsx (post feed + 2 hand-rolled bar charts + reel modal), CoachView.tsx (two
  columns: VOC quote buckets left, sticky AI chat right), BuyersView.tsx (sub-tabs: ICP,
  Content angles, Who bought, Post grades). ContentView.tsx is dead code superseded by
  AnalyticsView — confirm nothing imports it, then delete it.
- Read layer: src/lib/content-data.ts. Buyer DNA API: src/app/api/buyer-dna/route.ts, libs in
  src/lib/buyer-dna/{icp,dossier,grade,angles}.ts, weekly cron api/cron/buyer-dna-weekly.
- Grades: content_grades table, one 0-100 LLM fit-vs-ICP score per post (grade.ts), plus
  band ("on target"|"partial"|"off"), hits[], misses[], feedback, verdict, icp_version.
  Today only 43 of ~1,200 posts are graded, grades render only inside a Buyers sub-tab as a
  weakest-first text list, and the summary line renders raw bucket counts ("2 on target",
  "0 off") that read as gibberish. Clicking a graded post links OUT to Instagram.
- Data stored per post (creator_content): like_count, comment_count, caption, thumbnails,
  video urls, taken_at, transcript. view_count/play_count columns EXIST but are empty:
  the Meta Graph ingest (src/lib/instagram-content.ts) only has instagram_business_basic
  scope (views/reach need the insights scope, a creator re-approval), and the Apify fallback
  (src/lib/apify-instagram.ts) scrapes videoViewCount but DROPS it in the upsert mapping.
  600 posts per creator are already stored.
- No follower time-series exists anywhere. No reach/saves/shares stored.
- Share links: public_share_links table (token, kind, client_key, revoked). Mint route
  api/content/share-link (get-or-mint, hardcoded prod URL). Public page /p/content/[token]
  renders ONLY the analytics feed + audience summary + quotes: no coach, no buyers, no
  grades. Sidebar is hidden with a fragile CSS :has() hack, not a route guard. No UI to view,
  rotate, or revoke links.
- Ads-tab calendar: NOT a React component. The markup/CSS/JS live in the static file
  public/ads-tracker-export.html (classes .calendar-panel, .calendar-board 7-col grid,
  .calendar-cell, .calendar-dow, .calendar-day-num, .today, .muted; see lines ~514-543 for
  the CSS). The owner wants the content app's calendar to look IDENTICAL to this.

## 2. Target information architecture

One creator-facing app, three pages, one persistent top bar (creator name; operator view also
gets the tyson/antwan toggle and a settings gear):

1. **My Content** (home) — the graded feed. Every post thumbnail wears its grade. Filter and
   sort by grade, band, media type. Date filtering via the ported ads calendar. Tap a post =
   in-app detail overlay (never leaves the app, never bounces to a Buyers tab).
2. **Trends** — the curvy line charts: followers, likes, comments, views over time, account
   level and per-post scatter/rolling average. Same calendar component.
3. **Coach** — ONE unified page replacing CoachView + BuyersView: the chat is the center of
   the creative process, grounded in the buyer evidence, with the evidence (ICP, buyer
   stories, content angles, VOC quotes) browsable in drawers instead of dumped as a wall.

Phases below. Ship in order; each phase is independently deployable.

## 3. Phase 1 — The graded feed + dopamine grading

**Backfill first (data before UI):** grade every ungraded post for both creators using the
existing grade.ts pipeline against the current ICP version (batch endpoint + script; respect
rate limits; store as today). Auto-grade every newly ingested post going forward (hook into the
existing 2h content pipeline cron). Target: 100% of creator_content rows carry a grade. Log
count graded/failed. Use the model already configured in grade.ts; do not upgrade the model.

**Grade presentation system (used identically everywhere a grade appears):**
- Rename bands in ALL creator-facing copy: score >= 70 = "ON TARGET" (green #8ce0ab),
  45-69 = "CLOSE" (amber #e4c66a), < 45 = "DRIFT" (soft red #e0794d, never harsh). The words
  on/partial/off in the DB stay as-is; this is presentation mapping only.
- The grade badge: a small rounded pill on every post thumbnail, colored by band, showing the
  score number. High contrast, readable at thumbnail size.
- The grade hero (in the post detail overlay): a circular progress ring, 96px, that animates
  sweeping from 0 to the score on open (~700ms ease-out) with the number counting up, ring
  colored by band. At >= 85 add a brief one-time glow pulse on the ring. Respect
  prefers-reduced-motion (render final state instantly).
- Under the ring: "Why this lands" (hits, green check rows) and "What would make the buyer
  stop scrolling" (misses, gold arrow rows, NOT red x's — misses are coaching, not failure),
  then the feedback paragraph, max 3 lines with "more" expander.
- Kill the "2 on target / 0 off" counts line everywhere. Replace summary stats with the
  Scoreboard (below).

**The feed:** responsive thumbnail grid (3-4 cols desktop, 2 mobile), newest first by default.
Each card: thumbnail, grade pill, band-colored 3px bottom edge, likes + comments + views (when
available) as tiny icon stats. Controls above the grid, one row: sort (Newest, Highest grade,
Lowest grade, Most liked), band filter chips (All / ON TARGET / CLOSE / DRIFT with live
counts), media-type chips, and the calendar button (Phase 6). Everything filters client-side
from the already-loaded payload; instant, no spinners.

**Post detail overlay:** full-screen modal (mobile: sheet), containing: media player (use
stored_video_url fallback video_url/thumbnail), the grade hero, post date + caption, the post's
own metric row (likes, comments, views when present), and transcript behind an expander.
Closing returns to the exact scroll position. NO external navigation except a small "open on
Instagram" link at the bottom.

**The Scoreboard (top of My Content):** one compact strip, not a dashboard: current streak
("3 ON TARGET posts in a row" — computed by taken_at order), average score last 30 days with a
tiny up/down vs prior 30, personal best this month, and count of ON TARGET posts this month.
Four small stat tiles, generous type, zero tables.

## 4. Phase 2 — Organic-only language pass

- src/lib/buyer-dna/angles.ts: rewrite the generation prompt to produce ORGANIC content angles
  only (remove "content and ad angles", remove the organic|ad type from the schema, remove the
  "mix of organic and ad" instruction). Keep angle quality standards otherwise identical.
- Regenerate angles for both creators after the prompt change so no stored "ad" angles remain
  (angles/run endpoint exists). Existing angle rows with angle_type='ad': delete or regenerate;
  do not display them.
- BuyersView angle cards: remove the Ad/Organic label and its color split entirely.
- Sweep every creator-facing string in the content app for the words "ad" and "ads" (grep the
  components); the funnel rationale may live in model-facing prompts but never in UI copy.
- While in the copy: no em dashes, no italic styles anywhere in the content surfaces (there
  are italic VOC quote cards in CoachView today; restyle to regular weight with a left border).

## 5. Phase 3 — Trends (the curvy charts) + the missing data

**Unlock the data (in this order, cheapest first):**
1. Apify mapping fix: store the already-scraped videoViewCount into creator_content.view_count
   (one line in apify-instagram.ts upsert; then a re-ingest run backfills views wherever Apify
   is the source).
2. New table creator_account_snapshots: (id, client_key, snapshot_date date, followers_count
   int, following_count int, media_count int, unique(client_key, snapshot_date)). New daily
   cron step (add to the existing content pipeline cron) pulling followers_count via the Meta
   Graph connection where alive, Apify profile scrape as fallback. Start capturing NOW; the
   chart grows from here (IG gives no deep history).
3. Insights scope: the Graph connection uses instagram_business_basic; per-media views, reach,
   saves, shares and richer account metrics need the insights scope. Extend the existing
   reconnect flow (api/content/connect-link) to request the insights scope, and extend the
   Graph ingest to request per-media insights fields when the token has the scope (store reach,
   saved, shares into new nullable columns on creator_content). The settings panel (Phase 7)
   shows connection status per creator and a "reconnect for full insights" link. Note in UI
   where views are missing: keep the existing honest hint that views unlock after reconnect.

**The Trends page:** recharts line charts, type="monotone" (that is the curvy wavy line),
strokeWidth 2.5, gold or band-green strokes on the dark theme, soft gradient area fill below
(10-15% opacity), dots off except activeDot on hover, tooltip styled dark, axes in dim gray
with generous tick spacing, no gridline clutter (horizontal only, #26262b). Charts:
1. Followers over time (from creator_account_snapshots; render whatever exists, even 3 points).
2. Likes per post over time and comments per post over time: per-post points as a thin
   scatter + a 7-post rolling average as the curvy line (from creator_content by taken_at:
   this works TODAY with 600 posts per creator of history).
3. Views per post over time (renders when view data exists; otherwise show the reconnect hint).
4. Average grade over time (rolling average of content_grades by post date) — the loop-closer
   chart: "is my content getting more on-target."
All charts respect the selected calendar range. Loading skeletons; empty states with one
plain sentence.

## 6. Phase 4 — One Coach page (merge CoachView + BuyersView)

Replace the two-column dump + awkward right-rail chat and the 4-sub-tab BuyersView with ONE
page built around the creative process:

- **Top: "Your buyer" card.** The ICP one-liner + 4-6 chips (top pains, desires, triggers).
  One tap expands the full ICP. This is the north star of the page, always visible first.
- **Center: the Coach chat.** Full-width, chat-first. Starter prompts rewritten for creators:
  "What should I post this week?", "Grade my idea before I film it", "Why did my last DRIFT
  post miss?", "Turn a buyer story into a hook". Keep the existing /api/content/coach behavior
  and model; extend its server context to also include: the current ICP summary, the top 10
  content angles, the 5 most recent post grades with feedback, and 3 buyer dossier summaries
  (NO amounts). Cap added context sensibly; keep last-12-messages behavior and usage logging.
- **Evidence drawers (below or side-sheet on desktop): three collapsible sections replacing
  the old sub-tabs and the VOC wall:**
  1. "Content angles" — the organic angle cards, each with a "Use this" button that inserts
     the angle into the chat input as a prompt.
  2. "People who bought" — the dossier accordions as today, minus any dollar amounts, keyword
     internals, or operator jargon; frame each as a story: who they were, what they struggled
     with, their words, what made them decide.
  3. "In their words" — the VOC quotes, but curated: top 8 per bucket max, tabs per bucket,
     regular (non-italic) type, each quote with a "Use in chat" affordance.
- Delete CoachView.tsx and BuyersView.tsx after the merge (and dead ContentView.tsx).

Post grades do NOT live here anymore; they live on every post (Phase 1) and in Trends
(average-grade chart). The Coach page references them only through chat context.

## 7. Phase 5 — The calendar (identical to the ads tab)

Port the calendar UI out of public/ads-tracker-export.html into a reusable React component
src/components/CalendarRange.tsx that reproduces the SAME look: .calendar-panel visual style,
7-column board, dow header row, day cells with muted out-of-month days and a today marker,
same fonts/colors/borders as the ads tracker CSS (copy the relevant CSS values into the
component or a module stylesheet; keep class names semantically similar). Behavior: month
navigation, single-day tap and range selection (tap start, tap end), quick presets row (7d,
30d, 90d, 12mo, All). It drives the My Content feed filter and the Trends range. It must be
visually indistinguishable from the ads tab calendar at a glance.

## 8. Phase 6 — Creator access done right (share links + settings gear)

- **Full-app public access:** rework /p/content/[token] to render the ENTIRE new app (My
  Content, Trends, Coach) for the token's creator, not the analytics subset. Same components,
  a viewer context flag (operator vs creator) controlling: no creator toggle, no settings
  gear, no operator-only data (no dollar amounts anywhere, already enforced by Phase 2/4).
- **Coach chat for creators:** the chat API currently requires operator auth. Add token-scoped
  access: the public page passes its share token; the coach route validates it against
  public_share_links (kind content, not revoked) and scopes to that creator. Add a simple
  rate limit per token (e.g. 60 messages/day, in a small table or the existing usage log) and
  keep logging usage. Never trust a client-sent creator slug; derive it from the token.
- **Sidebar/chrome:** stop relying on the CSS :has() hack. Add /p/content/ to the Sidebar
  component's explicit return-null route list (Sidebar.tsx has one; /p/setters/ is already in
  it) so shared pages never mount CCOS chrome at all. The public page gets its own minimal
  header: creator name + the three page tabs.
- **URL base:** replace the hardcoded https://client-conversion-os.vercel.app with the request
  origin (or NEXT_PUBLIC_APP_URL fallback) so links work on any domain.
- **Settings gear (operator-only, in the app header):** a small modal listing both creators
  with: the current share link (copy button), link status, "Rotate link" (revokes the old row,
  mints a new token; requires a confirm), "Revoke", Instagram connection status (basic vs
  insights scope, last successful ingest time), and the reconnect-for-insights link. This
  replaces today's mint-on-click flow; the owner should never have to think about tokens
  again. Add an updated_at/rotated_at timestamp column to public_share_links via migration if
  useful for display.

## 9. Guardrails

- Money pipelines, ads attribution, sales data: do not touch. This build reads
  creator_content, content_grades, content_voc, content_audience_read, creator_icp,
  buyer_dossiers, buyer_content_angles, public_share_links, and adds only the tables/columns
  named above (migrations via supabase/migrations/ following the numbering).
- Compute-once principle: grades, angles, dossiers, VOC are stored artifacts; the UI renders
  stores. No LLM calls on page load. Chat is the only interactive AI surface.
- Keep AI costs where they are: same models as currently configured in grade.ts and
  coach/route.ts.
- Mobile-first: creators will use this on phones. Test every page at 390px width.
- Empty/partial data never renders NaN, undefined, or blank boxes; one plain sentence per
  empty state.
- No em dashes, no italics, no operator jargon (ICP, VOC, LTGP, keyword) in creator-facing
  copy: say "your buyer", "in their words", "grade".
- Do not add dependencies beyond what's installed (recharts is available).

## 10. Verify before finishing (walk each one)

1. Backfill: select count(*) from content_grades joined to creator_content shows ~100%
   coverage for both creators; new ingest grades automatically.
2. Feed: grades visible on every thumbnail; band filters + sort by score work; calendar range
   filters the grid; tapping a post opens the overlay with the animated ring; closing restores
   scroll. Test a DRIFT post: misses read as coaching, not punishment.
3. Trends: all four charts render with real data; curvy monotone lines; followers chart grows
   after two days of snapshots; per-post charts work from existing 600-post history today.
4. Coach page: chat answers grounded in ICP + angles + grades (ask "why did my last DRIFT post
   miss" and verify it cites the actual post); angle "Use this" inserts into input; dossiers
   show no dollar amounts.
5. Share link: open in an incognito window with no Google session: full app works (all three
   pages, chat included, rate-limited), no CCOS sidebar in the DOM, other creator's data
   unreachable by tampering with the URL or request bodies.
6. Settings gear: rotate a link, old token 404s, new token works; connection status accurate.
7. Language: grep creator-facing components for "\bad\b|\bads\b" (case-insensitive), "—", and
   fontStyle italic: zero hits. No dollar signs render anywhere in the public view (grep
   rendered payloads for buyer amounts).
8. Mobile pass at 390px: feed, overlay, charts, chat all usable; nothing horizontally scrolls
   except intentional chip rows.
