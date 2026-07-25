# Ads v2 UI parity: metrics section + column coloring

UI-only round. Source of truth: `public/ads-tracker-export.html` (v1) as deployed on live.
No attribution, sync, snapshot, or API code was touched. The v1 file was not edited.

## Step 0: sync to LIVE

The primary checkout at `dashboard/` was BOTH dirty and stale:

- `HEAD` = `b0545824df0b5c169657cc1e87bb0be31d4ee235`, `origin/main` = `ac9b6575d0873dfe3d955cd46b9221969e607df0`
- 10 modified files, and critically **`public/ads-tracker-export.html` itself was locally modified**. Reading v1 from that tree would have reproduced the exact failure this round exists to fix.

So all reading and editing was done in a clean worktree off live:

- Path: `/Users/alexwalsh/Documents/Codex - CCOS/ccos-adsv2-ui`
- Branch: `adsv2-ui-parity` (an existing clean worktree already sitting exactly at `origin/main`, so a duplicate was not created)
- **Commit built from: `ac9b6575d0873dfe3d955cd46b9221969e607df0`** (identical to `origin/main`), working tree clean at start.

### Anchor checks (both PASSED, run in the worktree)

`sed -n '395,400p' public/ads-tracker-export.html` printed exactly the six calc rules:

```
table.ads thead th.calc{background:var(--bg-1);color:var(--gold-dim)}
table.ads tbody td.calc{background:var(--bg-1)}
table.ads tbody tr.campaign-row td.calc{background:var(--bg-1)}
table.ads tbody tr.campaign-row:hover td.calc{background:var(--panel)}
table.ads tbody tr:hover td.calc{background:var(--panel)}
table.ads tbody tr.total-row td.calc{background:var(--bg)}
```

`sed -n '427,437p'` included the `.flat-row` block (`.ad-count-chip`, `.flat-row:hover`, `.flat-cell`, `.flat-camp`, `.flat-sep`, `.flat-name`).

### One correction to the prompt's premise

The prompt states the `lc-*` line chart is a v2 invention. It is not: `.lc-wrap`, `.lc-svg`, `.lc-tooltip`, `.lc-tt-date`, `.lc-tt-row`, `.lc-tt-sw`, `.lc-tt-name`, `.lc-tt-val` are all v1's own classes (v1 lines 598-606), used by v1's `LineChart`. What was a v2 invention was the *simplified* chart that reused two of those names with different values plus non-v1 names (`lc-tip`, `lc-tip-day`, `lc-tip-val`). The fix is therefore to port v1's real chart and restore v1's real `lc-*` values, which is what was done. The verify check that `MetricsBoard.tsx` contains no `lc-svg` is satisfied by putting the ported chart in its own file, `LineChart.tsx`.

---

## Fix 1 manifest: table row + derived-column ("calc") coloring

Every v1 rule from the prompt, its v1 value, what v2 had, and what was done. Zero rows approximated.

| v1 selector | v1 value | v2 rule before | Action taken |
|---|---|---|---|
| `table.ads tbody tr:hover td` | `background:var(--row-hover)` | same | Kept, unchanged |
| `table.ads tbody tr:last-child td` | `border-bottom:none` | absent | Left absent (v2 has a TOTAL row as last child, which sets its own `border-top`; adding this would strip the total's separator. Noted, not a value mismatch) |
| `table.ads tbody tr.campaign-row td` | `background:var(--panel);border-bottom:1px solid var(--border-2);font-weight:500` | identical | Kept, unchanged |
| `table.ads tbody tr.campaign-row td:first-child` | `background:var(--panel)` | **missing** | ADDED verbatim |
| `table.ads tbody tr.campaign-row:hover td` | `background:var(--panel)` | **missing** | ADDED verbatim |
| `table.ads tbody tr.campaign-row:hover td:first-child` | `background:var(--panel)` | **missing** | ADDED verbatim |
| `table.ads tbody tr.total-row td` | `background:var(--bg-1);font-weight:500;border-top:1px solid var(--border-2);color:var(--text-2)` | identical | Kept, unchanged |
| `table.ads tbody tr.total-row td:first-child` | `background:var(--bg-1);color:var(--text-2);text-transform:uppercase;font-size:10px;letter-spacing:0.08em` | had only the 3 text properties | ADDED the missing `background:var(--bg-1)` and `color:var(--text-2)` |
| `table.ads thead th.calc` | `background:var(--bg-1);color:var(--gold-dim)` | identical | Kept, unchanged |
| `table.ads tbody td.calc` | `background:var(--bg-1)` | identical | Kept, unchanged |
| `table.ads tbody tr.campaign-row td.calc` | `background:var(--bg-1)` | identical | Kept, unchanged |
| `table.ads tbody tr.campaign-row:hover td.calc` | `background:var(--panel)` | identical | Kept, unchanged |
| `table.ads tbody tr:hover td.calc` | `background:var(--panel)` | identical | Kept, unchanged |
| `table.ads tbody tr.total-row td.calc` | `background:var(--bg)` | v2 lumped this with `tr.adset-row td.calc, tr.ad-row td.calc` | Kept the total-row value; DELETED the adset/ad part |
| `.ad-count-chip` | `font-size:9.5px;color:var(--text-4);background:var(--panel-2);border:1px solid var(--border);border-radius:99px;padding:1px 7px;margin-left:4px;letter-spacing:0.02em` | `font-size:10px;color:var(--text-3);border:1px solid var(--border-2);border-radius:10px;padding:1px 7px;flex:none` | REPLACED with v1's values verbatim |
| `.flat-row:hover` | `background:var(--panel-2)` | **absent** | ADDED verbatim |
| `.flat-cell` | `display:inline-flex;align-items:center;gap:8px;max-width:100%;overflow:hidden` | **absent** | ADDED verbatim |
| `.flat-camp` | `color:var(--text-3);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px` | **absent** | ADDED verbatim |
| `.flat-sep` | `color:var(--text-4)` | **absent** | ADDED verbatim |
| `.flat-name` | `color:var(--text);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis` | **absent** | ADDED verbatim |

### Rules DELETED (the bug)

These described v1's nested drill-down rows and were being applied to v2's flat level views:

- `.adsv2 table.ads tbody tr.adset-row td { background:var(--bg); border-bottom:1px solid var(--border) }`
- `.adsv2 table.ads tbody tr.ad-row td { background:var(--bg); border-bottom:1px solid var(--panel); color:var(--text-2); font-size:11.5px }`
- `.adsv2 table.ads tbody tr.adset-row td.calc, .adsv2 table.ads tbody tr.ad-row td.calc { background:var(--bg) }` (this is what erased the tint)
- `.adsv2 table.ads tbody tr.adset-row:hover td.calc { background:var(--panel) }`
- `.adsv2 table.ads tbody tr.ad-row:hover td.calc { background:var(--bg-1) }`
- `.adsv2 .ad-row .camp-name { color:var(--text-2) }`

`CampaignTable.tsx` no longer emits `adset-row` or `ad-row` at all. Row class is now `campaign-row` for campaign rows and `flat-row` for everything else, so nested drill-down children inherit the same defaults and the calc tint is consistent at every level and depth.

### Component changes (`CampaignTable.tsx`)

- Added a `campaignNameById` map built from the campaign tree already in the payload (no data change) so flat rows can show the owning campaign inline.
- Flat top rows now render v1's cell structure: `flat-cell` > `camp-check`, `chevron`, `camp-dot`, `flat-camp`, `flat-sep` (`·`), `flat-name`, `ad-count-chip`, `status-pill`.
- Nested rows keep `campaign-cell` with `indent-1` / `indent-2`, since the campaign name is already visible on the parent row above them.
- `AdNamePreview` now takes a `className` so an ad name at flat level is a `flat-name` and at nested level a `camp-name`.
- Chevron and status pill are KEPT on flat rows. v1's flat rows do not have them because v1's flat views cannot expand; v2's can. This is v2 functionality, not a v1 value mismatch.

### v2-only CSS addition (not an approximation)

v2's name column is drag-resizable, which v1's flat view is not. Without shrink control the chrome inside `flat-cell` collapses before the text does. Added, using no new values:

```
.adsv2 .flat-cell > .camp-check, .chevron, .camp-dot, .flat-sep, .ad-count-chip, .status-pill { flex: 0 0 auto }
.adsv2 .flat-cell > .flat-camp, .flat-name { flex: 0 1 auto; min-width: 0 }
```

### `calc` class coverage check

Confirmed in `src/lib/ads-v2/definitions.ts` that every derived column carries `calc: true`, at every level (the class is applied from the one registry, so it cannot differ by level):

`cpm`, `ctr`, `cpc`, `costPerMessage`, `costPerBooked`, `costPerTaken`, `showRate`, `closeRate`, `msgToCall`, `costPerClient`, `collectedRoi` = 11 columns.

That is the prompt's list of 10 plus `cpc` (cost per click), which v2 also has and which is correctly marked derived. Nothing was missing, so no additions were needed.

**Daily budget**: already a plain, non-calc column (`budget` has no `calc` flag). Left as is, per the prompt.

### Contrast check (prompt item 5 / verify item 4)

Token values in `ads-v2.css`: `--bg-1: #0d0d0d`, `--panel: #111111`, `--row-hover: #141414`, `--bg: #0a0a0a`.

At ad set level and ad level, a row is `<tr class="flat-row">`. Enumerating every background-setting rule that can match a metric `<td>` in that row:

**Calc cell at rest** - winning selector:
`.adsv2 table.ads tbody td.calc { background: var(--bg-1) }` -> **#0d0d0d**
(No other rule matches: `tr.campaign-row td.calc` and `tr.total-row td.calc` do not apply to a flat row, and `tr:hover td.calc` needs hover.)

**Non-calc neighbour at rest** - winning selector:
none. No rule sets a background on a non-first-child `<td>` in a flat row, so the cell is transparent and the container `.adsv2 .panel { background: var(--panel) }` shows through -> **#111111**.

So at rest the only difference is #0d0d0d vs #111111, exactly as specified.

On hover: `.adsv2 table.ads tbody tr:hover td` -> `--row-hover` (#141414); `.adsv2 table.ads tbody tr:hover td.calc` -> `--panel` (#111111). The calc column stays the darker one in both states. **Check passes.**

---

## Fix 2 manifest: metrics section

Every class in the prompt's inventory, its v1 CSS copied verbatim, where it now lives in v2.
All CSS lives in `src/app/ads-v2/ads-v2.css` under the `.adsv2` scope. Zero rows approximated.

| v1 class | v1 CSS value (verbatim) | Where it appears in v2 now | Action |
|---|---|---|---|
| `metric-board-head` | `display:flex;justify-content:space-between;align-items:center;gap:12px;margin:28px 0 10px` | `MetricsBoard.tsx` board header | REPLACED (v2 had `margin:0 0 14px`) |
| `metric-board-title` | `font-size:22px;font-weight:600;letter-spacing:-0.02em;margin:0;color:var(--text)` | same header, `<h2>` | REPLACED (v2 had `font-size:20px`) |
| `metric-board-actions` | `display:flex;align-items:center;gap:8px` | same header | REPLACED (v2 was missing `align-items`) |
| `metric-board-btn` | `height:32px;display:inline-flex;align-items:center;gap:7px;padding:0 11px;border:1px solid var(--border-2);border-radius:6px;background:var(--panel);color:var(--text-2);font-size:12px;font-weight:500` | Add / Edit buttons | REPLACED (v2 had `padding:0 12px`, `border-radius:7px`) |
| `metric-board-btn:hover` | `background:var(--panel-2);color:var(--text)` | same | REPLACED (v2 set only `color`) |
| `metric-board-btn.active` | `background:var(--panel-2);color:var(--text);box-shadow:inset 0 0 0 1px var(--focus)` | Edit button when editing | REPLACED (v2 used `border-color` not `box-shadow`) |
| `metric-grid` | `margin-top:0` | the `grid-charts metric-grid` wrapper | REPLACED (v2 had its own 1fr/1fr grid here) |
| `metric-support-grid` | `margin-top:18px` | CSS present; no v2 support grid renders yet | ADDED verbatim |
| `chart-column` | `display:flex;flex-direction:column;gap:18px;min-width:0` | the two columns inside `metric-grid` | ADDED verbatim (replaces `metric-col`) |
| `chart-actions-cell` | `min-width:0` | CSS present; no v2 actions cell | ADDED verbatim |
| `grid-charts` (carrier of the grid) | `display:grid;grid-template-columns:1.25fr 1fr;gap:18px;margin-top:28px;align-items:start` + `@media(max-width:1100px){grid-template-columns:1fr}` | the grid wrapper | ADDED verbatim (required: v1's `metric-grid` only sets margin) |
| `metric-card-shell` | `position:relative;min-width:0` | wraps every card | ADDED verbatim (replaces `metric-card`) |
| `metric-card-shell.editing .panel` | `cursor:grab;transition:border-color .14s,box-shadow .14s,transform .32s cubic-bezier(.22,.72,.2,1),opacity .14s,background-color .14s` | edit mode | ADDED verbatim |
| `metric-card-shell.editing:hover .panel` | `border-color:var(--focus);box-shadow:0 0 0 1px rgba(255,255,255,.035),0 12px 30px rgba(0,0,0,.28)` | edit mode hover | ADDED verbatim |
| `metric-card-shell.dragging` | `pointer-events:auto` | during drag | ADDED verbatim |
| `metric-card-shell.drop-target .panel` | `border-color:var(--gold-dim);box-shadow:0 0 0 1px rgba(212,178,122,.18)` | drop target | ADDED verbatim |
| `metric-drag-placeholder` | `height:100%;min-height:240px;border:1px dashed var(--focus);border-radius:8px;background:var(--bg);box-shadow:inset 0 0 0 1px rgba(255,255,255,.018)` | the gap left by the dragged card | ADDED verbatim |
| `metric-floating-card` | `position:fixed;z-index:220;pointer-events:none;filter:drop-shadow(0 22px 40px rgba(0,0,0,.55));transform:scale(1.01);transform-origin:top left` | the card following the pointer | ADDED verbatim |
| `metric-floating-card .panel` | `border-color:var(--focus);box-shadow:0 0 0 1px rgba(255,255,255,.05),0 24px 60px rgba(0,0,0,.58)` | same | ADDED verbatim |
| `body.metric-dragging` | `cursor:grabbing;user-select:none` | set on `document.body` while dragging | ADDED verbatim (kept unscoped, as in v1) |
| `metric-delete` | `position:absolute;top:9px;right:10px;z-index:4;width:26px;height:26px;border:1px solid var(--border-2);border-radius:999px;background:var(--panel);color:var(--text-3);font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center` | the x on a card in edit mode | REPLACED (v2 had 24px, z-index 3, font-size 15px, no flex centering) |
| `metric-delete:hover` | `background:var(--panel-2);color:var(--text)` | same | REPLACED (v2 turned it red) |
| `metric-add-grid` | `display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:58vh;overflow:auto;padding-right:2px` | the picker | REPLACED (v2 had `gap:9px`, `max-height:56vh`) |
| `metric-pick-card` | `min-height:78px;padding:12px;border:1px solid var(--border-2);border-radius:7px;background:var(--bg);text-align:left;color:var(--text-2);display:flex;gap:12px;align-items:flex-start;justify-content:space-between` | picker tiles | ADDED verbatim (v2's class was `metric-pick`, min-height 74px, radius 9px) |
| `metric-pick-card:hover` | `background:var(--panel);border-color:var(--focus);color:var(--text)` | same | REPLACED (v2 kept `border-color:var(--border-2)`) |
| `metric-pick-card.selected` | `border-color:var(--border-2);background:var(--panel);color:var(--text)` | same | REPLACED (v2 used a gold border + inset gold ring) |
| `metric-pick-label` | `font-size:12px;font-weight:600;color:var(--text);line-height:1.2` | tile title | Kept (already identical) |
| `metric-pick-meta` | `font-size:10px;color:var(--text-4);margin-top:5px;line-height:1.35` | tile caption | REPLACED (v2 added `display:block`, no longer needed: it is a `<div>` now, as in v1) |
| `metric-pick-icon` | `width:22px;height:22px;border:1px solid var(--border-2);border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--text-3);flex:0 0 auto` | tile check/plus | REPLACED (v2 added `font-size:15px`) |
| `metric-pick-card.selected .metric-pick-icon` | `border-color:var(--border-2);color:var(--gold)` | same | REPLACED (v2 filled it gold) |
| `@media(max-width:700px)` | `.metric-add-grid{grid-template-columns:1fr}.metric-board-head{align-items:flex-start;flex-direction:column}` | responsive | ADDED verbatim |
| `chart-card` | `padding:18px 20px 14px;display:flex;flex-direction:column` | every metric card body | ADDED verbatim (replaces `metric-card`) |
| `chart-head` | `display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px` | card header | ADDED verbatim (replaces `metric-card-head`) |
| `chart-title` | `font-size:11px;color:var(--text-3);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px` | card title | ADDED verbatim (replaces `metric-card-title`, which had `letter-spacing:0.09em`) |
| `chart-subtitle` | `display:flex;align-items:baseline;gap:10px;flex-wrap:wrap` | big number row | ADDED verbatim |
| `chart-big` | `font-size:26px;font-weight:500;color:var(--text);letter-spacing:-0.02em;font-variant-numeric:tabular-nums` | the big number | ADDED verbatim (replaces `metric-card-big`, which was 25px) |
| `chart-delta` (+ `.pos` / `.neg`) | `font-size:11px;font-weight:500;letter-spacing:0.01em` / `color:var(--green)` / `color:var(--red)` | CSS present, no DOM use (see note below) | ADDED verbatim |
| `chart-sub-label` | `font-size:11px;color:var(--text-4)` | the caption beside the big number | ADDED verbatim (replaces `metric-card-meta`) |
| `chart-controls` | `display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end` | CSS present, no DOM use (see note) | ADDED verbatim |
| `chart-select` | `font-size:11px;padding:5px 8px;max-width:210px` | CSS present, no DOM use (see note) | ADDED verbatim |
| `chart-legend` | `display:flex;gap:14px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text-3)` | under each chart | ADDED verbatim |
| `chart-legend-item` | `display:flex;align-items:center;gap:6px` | legend entry | ADDED verbatim |
| `chart-sw` | `width:10px;height:2px;border-radius:2px;display:inline-block` | legend swatch | ADDED verbatim |
| `lc-wrap` | `position:relative;width:100%` | `LineChart.tsx` | REPLACED (v2 had `margin-top:8px`, no width) |
| `lc-svg` | `width:100%;height:auto;display:block;cursor:crosshair` | `LineChart.tsx` | REPLACED (v2 pinned `height:84px`, no crosshair) |
| `lc-tooltip` | `position:absolute;top:0;transform:translate(-50%,-6px);background:var(--panel);border:1px solid var(--border-2);border-radius:6px;padding:7px 10px;font-size:11px;min-width:150px;max-width:240px;pointer-events:none;z-index:3;box-shadow:0 6px 20px rgba(0,0,0,0.6)` | chart hover readout | ADDED verbatim (v2 had a flat `lc-tip` strip) |
| `lc-tt-date` | `font-size:10px;color:var(--text-4);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:5px;font-family:'JetBrains Mono',monospace` | tooltip date | ADDED verbatim |
| `lc-tt-row` | `display:flex;align-items:center;gap:7px;padding:2px 0` | tooltip row | ADDED verbatim |
| `lc-tt-sw` | `width:7px;height:7px;border-radius:99px;flex-shrink:0` | tooltip swatch | ADDED verbatim |
| `lc-tt-name` | `color:var(--text-3);font-size:10.5px;flex:1` | tooltip series name | ADDED verbatim |
| `lc-tt-val` | `color:var(--text);font-size:11px;font-variant-numeric:tabular-nums` | tooltip value | ADDED verbatim |

### Classes with CSS but no DOM use, and why

`chart-delta`, `chart-select`, `chart-controls`, `chart-actions-cell`, `metric-support-grid` are in the stylesheet with v1's exact values, as required. They are not rendered because v2's metric cards have no data to drive them: no period-over-period delta, no per-card series selector, no actions cell, no support grid. Rendering them would have meant inventing numbers, and the prompt is explicit that this fix never changes what numbers are shown. Flagging this rather than fabricating a delta.

### Components rewritten

- **`MetricsBoard.tsx`** rewritten to v1's DOM tree: a fragment of `metric-board-head` (title + Add/Edit buttons with v1's `IcPlus` / `IcEdit`), then `grid-charts metric-grid` holding two `chart-column`s of `metric-card-shell`s, then the `metric-floating-card`, then the picker. Drag is v1's mechanic, ported: pointer capture, measured slot rects, nearest-centre reorder, FLIP transform animation, `metric-drag-placeholder` in the vacated slot, `body.metric-dragging`. The invented `metric-board` wrapper, `metric-col`, `metric-card`, `metric-card-head`, `metric-card-big`, `metric-card-meta`, `metric-pick` and `lc-tip*` are gone.
- **`LineChart.tsx`** is new: v1's `LineChart` (v1 line 4228) and `smoothPath` (v1 line 4210) ported to TSX with the same rendering output, including the `t = 0.18` Bezier tension (v2's copy had used `1/6`), the 4 gridline ticks, the optional right axis, the primary-series gradient fill, and the crosshair with per-series dots. Gradient ids are namespaced per card (`lc-fade-<cardId>-<i>`) so several cards on one page cannot collide.
- **`icons.tsx`**: added `IcPlus` and `IcEdit`, paths copied verbatim from v1 (lines 2054 and 2122), on v1's existing 14px / stroke-1.4 `Icon` wrapper.

### Data wiring: unchanged

Confirmed identical before and after:

- Storage key `ccos.adsv2.metricCards.v1`, format unchanged (a JSON array of card id strings). **A saved layout loads unchanged.**
- Same fetch URLs, same `publicToken` branch, same 250ms defer, same 2500ms re-poll while preparing, same `dataVersion === tableVersion` gate.
- Same `CARD_DEFS` / `CARD_BY_ID` / `DEFAULT_CARD_IDS`, same `def.value(total)` for the big number and `def.point(day)` for chart points, same `formatValue` function, byte for byte.
- Same tooltip content (`def.sentence` + `Source: def.source`).

One formatting addition: `axisFormat` shortens the four y-axis tick labels (for example `$12.4k`), because v1's chart has y-axis ticks and v2's earlier chart had none. It affects axis labels only. The big number, the tooltip values, and every card figure still go through the untouched `formatValue`.

### v2-only CSS kept, styled with v1 tokens

`metric-loading`, `chart-title-info` (the info-dot anchor), `metric-tip`, `metric-tip-src`, `modal-sub` (v1's value: `font-size:11px;color:var(--text-3);margin-top:3px`), `metric-add-foot`, `apply-btn`. No new visual language introduced.

---

## Verify

1. **Step 0** - PASSED. Built from `ac9b6575d0873dfe3d955cd46b9221969e607df0` in a clean worktree off `origin/main`. Both anchor checks printed the expected v1 rules verbatim (quoted above).
2. **Manifest complete** - PASSED. Every v1 rule in Fix 1 and all 30 inventory classes in Fix 2 are accounted for above with identical values. **Zero rows marked "approximated."** Five classes have CSS but no DOM use, disclosed above with the reason.
3. **Greps** - PASSED.
   - `grep -rn "adset-row\|ad-row" src/app/ads-v2/` -> no matches anywhere (CSS or TSX).
   - `flat-row`, `flat-camp`, `flat-name`, `flat-cell`, `flat-sep`, `ad-count-chip` all present with v1's exact values.
4. **Contrast** - PASSED. Winning selectors given above: calc at rest `.adsv2 table.ads tbody td.calc` -> `--bg-1` #0d0d0d; non-calc neighbour at rest has no matching background rule, so it is transparent over `.adsv2 .panel` -> `--panel` #111111.
5. **MetricsBoard greps** - PASSED. Zero hits for `lc-svg`, `metric-card-big`, `metric-col`, `metric-board"`. Present: `metric-card-shell`, `chart-card`, `metric-grid`, `LineChart`.
6. **Em dashes** - PASSED. Zero in all changed files.
7. **Build** - PASSED. `npm run build`: `✓ Compiled successfully in 16.0s`, no errors or warnings, `/ads-v2` and its API routes build. Numbers are identical to before: same payload fields, same `CARD_DEFS`, same `formatValue`. A persisted layout loads unchanged (same key, same format).

Not run, per the prompt: screenshot side-by-side comparisons. Visual review is the owner's, in the browser.
