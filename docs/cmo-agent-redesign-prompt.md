# CMO Agent page redesign: effortless to read, nothing hidden that trust needs

## Diagnosis (why the current card hurts)

Every element on the card competes in the same narrow size band (11px to 15.5px), so nothing
leads and the eye has no landing point: the verdict chip, the creator tag, the title, the
sentence, the always-open five-column monospace table, the funnel string, and an italic rule
line all shout at once. The one number that actually justifies the verdict (LTGP:CAC) is buried
at 12px inside a grid of 15 other numbers, so Alex has to parse a spreadsheet to find the point.
Dense monospace, italics, arrow-chain strings, and identical-weight buttons add friction on top.
The card makes him READ to decide, when it should let him SEE the decision and only read if he
chooses to.

## Redesign concept

**The rule: one card answers four questions in one glance, in fixed positions, without reading.**
What's the verdict (color + icon + stripe, top left). What justifies it (one big number, always
the same spot). Is it trending the right way (three bars). Is it alive (running dot + last-3-day
spend). Everything else exists one tap away. Trust is preserved by keeping proof-shaped elements
on the surface (the trend bars ARE the 7/14/30 windows, the closed-deals chip IS the cash
reality) and the complete numbers behind a single always-visible expander, never removed.

**Card anatomy, surface (top to bottom):**
1. A 3px colored stripe down the card's left edge, colored by kind. Position + color carry the
   verdict before any word is read.
2. Verdict chip with icon (▲ SCALE green, ■ KILL red, ● WATCH amber, ✚ MAKE blue) + creator chip
   (TYSON / ANTWAN, gold outline) + live chip on the right: green dot "$212 in 3d" when running,
   grey dot "stopped" when not.
3. The hero row: LTGP:CAC at 14d, huge (34px, weight 800), colored by threshold (green 3x and up,
   amber 2 to 3, red under 2), with a small label under it. Next to it, the trend visual: three
   vertical bars for 7d / 14d / 30d LTGP, height proportional to value (capped at 4x), each bar
   colored by its own threshold, day labels beneath. Up-and-to-the-right is visible without a
   single digit being read. Beside that, one quiet stat chip: "N closed · 14d".
4. The title, 18px bold, plain words, short line.
5. One sentence of detail, 15px, line-height 1.7, clamped to two lines.
6. "Show the numbers" expander (chevron, closed by default): inside are the full window table
   (7d / 14d / 30d with spend, ROAS, LTGP:CAC, closed; roomy 8px row padding, tabular numerals,
   never italic), the funnel as four labeled steps (DMs with cost per DM, booked, taken, closed),
   all-time closes, exact spend status, and the rule line in plain text prefixed "Rule:". Nothing
   that exists today is deleted; it is all here.
7. Action row: the comment box (short placeholder: the suggestion if present, else "Your call.");
   below it one PRIMARY button ("Do it as suggested", filled, green tint, biggest) and three
   quieter ones ("Do this instead", outlined; "Hold" and "Dismiss", ghost). The default path is
   visually obvious; nothing else competes with it.

**Quiet day state:** a single calm panel: "Nothing to decide today." in large friendly type,
with the Run button beneath. No spreadsheet energy on an empty day.

**Decided state:** each decided item collapses to one thin row: stripe (kind color, dimmed),
title, a directive chip ("approved" green / "adjusted" gold / "held" grey / "dismissed" dim),
Alex's comment in quotes if present, and a small "reopen" link. The day reads as a short list of
closed decisions, not a second wall.

**Type scale:** 34/800 hero number · 18/700 title · 15/400 body at 1.7 line-height · 13/600
buttons and table numbers · 11/700 uppercase micro-labels with 1px letter-spacing (chips only).
**Spacing scale:** 8 / 12 / 16 / 24 / 32. Card padding 24, gap between cards 16, shell max-width
720px so lines stay short. **No italics anywhere. No em dashes anywhere.** Dark theme stays:
#09090b page, #111114 cards, #c9a96e gold accents, Plus Jakarta Sans.

---

# EXECUTION PROMPT

You are working in the CCOS dashboard repo. Redesign the presentation of
`src/app/cmo-agent/page.tsx` (the CMO Agent daily brief) for a dyslexia-friendly, low-strain
reading experience. PRESENTATION ONLY: all data loading and directive behavior stays exactly as
it is. Do not touch any API route.

## Behavior to keep byte-for-byte (verify each survives)

1. `GET /api/cmo-agent/items` on mount → `{ ok, items, date }`, stored in state.
2. "Run today's brief" button → `POST /api/cmo-agent/run`, disabled while running, then reload.
3. Per-item directive: textarea draft (per-item `drafts` map) + preset buttons that
   `POST /api/cmo-agent/items` with `{ id, directive, comment }` where directive is one of
   `approve | adjust | hold | dismiss | reopen`, then reload.
4. Items split: `status === "proposed"` = to decide; everything else = decided (with reopen).
5. The item type and evidence shape are unchanged. Evidence fields available:
   `running` (bool), `spendLast3d`, `lastSpend`, `windows.{d7,d14,d30}` each
   `{ spend, roas, ltgp, closed }` (any may be null), `funnel14d` `{ dms, costPerDm, booked,
   taken, closed }` (may be null), `allTimeCloses`. Never compute or relabel money values;
   render `ltgp` and `roas` exactly as the API returns them.

## Design tokens (use these exact values)

- Page bg `#09090b`, card bg `#111114`, inset bg `#0d0d10`, line `#26262b`, text `#e7e7ea`,
  dim `#9a9aa4` (raised from #8a8a94 for contrast), gold `#c9a96e`.
- Kind system (color, background tint, icon, label):
  - scale: `#8ce0ab` / `#14311f` / `▲` / SCALE
  - kill: `#e0794d` / `#331616` / `■` / KILL
  - watch: `#e4c66a` / `#332a12` / `●` / WATCH
  - make_variations: `#7aa2f7` / `#16233a` / `✚` / MAKE
  - fallback for other kinds (reopen, launch, write_copy): keep current colors, icon `◆`.
- LTGP threshold color: `>= 3` green `#8ce0ab`, `>= 2` amber `#e4c66a`, else red `#e0794d`.
- Type scale: hero 34px/800; title 18px/700; body 15px/400, line-height 1.7; buttons + table
  13px/600; micro-labels 11px/700 uppercase with 1px letter-spacing (chips and column heads
  only). `fontVariantNumeric: "tabular-nums"` on every numeric element. NO italics anywhere
  (remove the current italic rule line). No em dashes in any copy.
- Spacing: card padding 24px, gap between cards 16px, internal vertical rhythm 12px, shell
  max-width 720px.

## Card layout, "to decide" (build exactly this)

Card: `#111114`, radius 14, `borderLeft: 3px solid <kindColor>`, padding 24.

Row 1 (flex, gap 10, align center): kind chip (icon + label, 11px/700, padding 3px 10px,
radius 999, kind bg + kind color), creator chip (TYSON / ANTWAN, 11px/700, gold text, 1px gold
border at 35% opacity, radius 999), spacer, live chip right-aligned: when `evidence.running` is
true render a green dot (6px circle, `#8ce0ab`) + `$<spendLast3d> in 3d` at 12px dim; when
false render grey dot + `stopped` (+ ` · last $<lastSpend>` if present); when undefined render
nothing.

Row 2 (flex, gap 24, align flex-end, margin-top 16), three blocks:
- Hero number: `windows.d14.ltgp` (fall back d7, then d30, first non-null) rendered `2.4x`
  at 34px/800 in its threshold color, with `LTGP:CAC · 14d` under it at 11px dim uppercase
  (label reflects the window actually used).
- Trend bars: an inline flex of three vertical bars for d7/d14/d30 `ltgp`. Each bar: width
  14px, height `Math.max(6, Math.min(v,4)/4*44)` px, radius 3, background = that value's
  threshold color, 60% opacity except the 14d bar at 100%. Under each bar its label `7d 14d
  30d` at 10px dim. A missing window renders a 6px stub in `#26262b`. This is the only trend
  element; no sparkline libs, plain divs.
- Closed chip: `<N> closed · 14d` (from `windows.d14.closed`, fall back like the hero) at 12px,
  padding 4px 10px, radius 999, 1px line border, text color `#e7e7ea` when N > 0 else dim.
Skip any block whose data is entirely absent; never render `NaN` or `undefined`.

Row 3: title, 18px/700, margin-top 16, max-width 56ch.
Row 4: detail sentence, 15px/400, line-height 1.7, color `#c9c9d0`, clamped to 2 lines
(webkit line clamp), margin-top 8. Omit if null.

Row 5, the expander (margin-top 16): a ghost button `Show the numbers ▸` (13px/600, dim, no
border, padding 8px 0, cursor pointer; flips to `Hide the numbers ▾` when open). Track open
state in a `Record<string, boolean>`. When open render an inset panel (`#0d0d10`, 1px line
border, radius 10, padding 16, margin-top 8) containing, in order:
1. Exact spend status line, 13px: running/stopped + spendLast3d/lastSpend, plain words.
2. Window table: columns `window | spend | ROAS | LTGP:CAC | closed`, rows 7d/14d/30d (only
   non-null windows). 13px/600 numbers, tabular-nums, row padding 8px, header 11px dim
   uppercase, row dividers 1px `#26262b`. LTGP cell in its threshold color at weight 700; all
   other cells `#c9c9d0`. Right-align numeric columns. Sans-serif (page font), not monospace.
3. Funnel strip (from `funnel14d`, skip if null): four inline stat blocks each as a small
   column, value 16px/700 on top, label 11px dim under: `DMs` (append ` · $<costPerDm>/DM` in
   the label when present), `booked`, `taken`, `closed`. Separate blocks with a dim `→` at
   13px. Below it, if `allTimeCloses` != null: `All-time closes: N` at 12px dim.
4. Rule line, plain text (NOT italic): `Rule: <rule>` at 12px dim. Omit if null.

Row 6, action row (margin-top 16): the textarea exactly as functionally wired today but styled
15px, padding 12px 14px, radius 10, `#0d0d10` bg, 1px line border, min-height 52px, placeholder
= `i.suggestion` if present (verbatim, prefixed `Suggested: `) else `Your call. Say what you
want done.`. Under it (flex, gap 8, margin-top 12, wrap):
- PRIMARY: `✓ Do it as suggested` 14px/700, padding 10px 18px, radius 9, bg `#14311f`, border
  `1px solid #2e6b4a`, color `#8ce0ab`.
- `✎ Do this instead` 13px/600, padding 9px 14px, outlined (1px line border, `#17171b` bg).
- `⏸ Hold` and `✕ Dismiss` 13px/600, ghost (transparent bg, 1px transparent border, dim text;
  border becomes line-colored on hover).
All four call the existing `direct(id, directive)` unchanged.

## Header, empty state, decided list

- Header: keep `CCOS` micro-label and `CMO Agent` h1 (28px/800). Sub-line shortened to:
  `Decide each move. Your call gets logged, a Claude session executes it.` 14px dim, 1.6
  line-height. Run button unchanged in behavior, styled 13px/700 gold fill.
- Section label: replace `N TO DECIDE` with `N to decide` at 15px/700 normal case, margin-top 32.
- Empty day (no items at all): one panel, padding 40, centered: `Nothing to decide today.` at
  20px/700, then the run hint at 14px dim, then the Run button. Calm, no table.
- Decided rows: thin cards (padding 14px 18px, radius 10, `#0d0d10`, left stripe 3px in the
  kind color at 40% opacity), single flex row: title 14px/600, directive chip (11px/700
  uppercase, radius 999: approve green tint, adjust gold tint, hold grey, dismissed dim),
  `reopen` as a 12px underlined dim button (existing behavior). Alex's comment, if any, on a
  second line at 13px in normal quotes, color `#c9c9d0`. NO italics.
- Footer line: keep the canonical-attribution sentence, 12px dim, page font (drop monospace).

## Guardrails

- No new dependencies, no CSS frameworks, no chart libs. Inline styles or a small style object
  map, matching the file's existing pattern.
- No italics anywhere. No em dashes in any string. Plain short sentences in all copy.
- Do not remove any data that exists today; everything not on the card surface must be inside
  the expander. Trust requires the full proof to remain reachable.
- Keep the file client-side ("use client") and self-contained as it is now.

## Verify before you finish

1. `npm run dev` (or the repo's dev script), open `/cmo-agent`.
2. If today has no items, POST `/api/cmo-agent/run` (the button) to generate; otherwise use
   existing items. If the API returns none for any kind, temporarily stub one item of each kind
   in state to eyeball all four (then remove the stub).
3. Check each kind renders: correct stripe + chip color + icon; hero LTGP number in the right
   threshold color; three trend bars with 14d emphasized; closed chip; live chip on running
   items.
4. Missing-data safety: an item with no windows, or null funnel14d, renders without NaN,
   undefined, or empty artifacts.
5. Expander opens and shows: spend status, full window table, funnel strip, all-time closes,
   plain `Rule:` line.
6. Type a comment, hit each preset on test items: row moves to decided with the right chip,
   comment shows in quotes, reopen returns it to the deciding list. Confirm the POST payloads
   are unchanged (`{ id, directive, comment }`).
7. Squint test at arm's length: on each card you can name the verdict, the big number's color,
   and the trend direction without reading a single word. If not, increase contrast/size until
   you can.
8. Search the file for `—` and `italic`: both must return zero hits.
