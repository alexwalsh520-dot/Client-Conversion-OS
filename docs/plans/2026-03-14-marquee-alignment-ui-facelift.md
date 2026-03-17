# Marquee Select + Alignment + UI Facelift

**Date**: 2026-03-14
**Status**: Approved

## 1. Marquee Selection
- Click+drag on empty canvas draws blue selection rectangle
- Blocks intersecting marquee added to selectedBlockIds on mouse-up
- Blue box: rgba(59,130,246,0.15) fill, 2px solid rgba(59,130,246,0.6) border

## 2. Alignment Toolbar (top of sidebar)
- 7 icon buttons: Align Left, Center H, Right | Top, Middle V, Bottom
- Disabled when <2 blocks selected
- Aligns to group bounding box

## 3. UI Facelift
- Compact inline property rows (label left, input right)
- Dark recessed inputs (rgba(0,0,0,0.3), 28px height)
- Sentence case labels, 11px, light weight
- 16px inline color picker circles
- Thin slider tracks, gold accent
- Tighter spacing (6px rows, 12px sections)
- Subtle 1px separators
