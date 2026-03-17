# Multi-Select + Proportional Text Scaling

**Date**: 2026-03-14
**Status**: Approved

## Changes

### 1. Bigger Default Font Sizes (1.5x)
- Title: 52 → 72
- Body: 30 → 44
- Callout: 38 → 52
- CTA: 40 → 56
- Padding and border radius scale proportionally

### 2. Multi-Select System
- Replace `selectedBlockId: string | null` with `selectedBlockIds: Set<string>`
- Click = select one (clears others)
- Shift+Click = toggle add/remove from selection
- Single-block ops (drag, resize, inline edit) work when exactly 1 selected

### 3. Select All Checkbox
- Toolbar checkbox that selects/deselects all text blocks
- Reflects current state (checked when all selected, unchecked when none)

### 4. Proportional Scale Slider
- Slider (range 0.5x to 2.0x, default 1.0x) scales all selected blocks proportionally
- Affects fontSize, paddingH, paddingV, borderRadius
- Preserves relative size ratios between blocks
- Keyboard shortcuts: `+` / `-` for ±10% steps
