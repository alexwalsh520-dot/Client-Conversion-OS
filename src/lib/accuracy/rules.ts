// ─────────────────────────────────────────────────────────────────────────
// ACCURACY RULES — the judgement, separated from the fetching, so every red
// and every amber path can be forced in a test with constructed numbers
// instead of by damaging real data.
//
// One law governs this file: NO SILENT TOLERANCES. Every threshold below is
// also written in plain English into the check's tolerance_note, which is
// stored on the row and shown on the page.
// ─────────────────────────────────────────────────────────────────────────

export type CheckStatus = "green" | "amber" | "red" | "error";

export interface Verdict {
  status: CheckStatus;
  /** One line explaining the verdict; becomes what_to_do when not green. */
  reason: string;
}

// ── formatting ────────────────────────────────────────────────────────────

export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

export function pct(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 100;
  return (Math.abs(a - b) / Math.abs(b)) * 100;
}

// ── 1. Books balance ──────────────────────────────────────────────────────

export interface BooksMismatch {
  client: string;
  window: string;
  metric: string;
  recount: number;
  saved: number;
  /** Spend, impressions and clicks come from the Meta feed, which is written
   *  hourly by a different job than the one that saves the answer. */
  fromSpendFeed: boolean;
  /** The feed wrote AFTER the saved answer was computed, proven by comparing
   *  the feed's write time with the answer's computed time. */
  fedAfterAnswerSaved: boolean;
}

export const BOOKS_TOLERANCE_NOTE =
  "Every number is recounted from the fact tables and must equal the saved answer exactly. " +
  "One exception, and it is evidence-based, not a fudge: if the ONLY differences are spend, " +
  "impressions or clicks AND the Meta feed wrote those rows after the answer was saved " +
  "(proven by comparing the two timestamps), the row is amber, because the next hourly " +
  "rebuild absorbs it. Any difference at all in DMs, bookings, calls taken, closes or cash " +
  "is red, always. A window with no saved answer yet is amber.";

export function classifyBooksBalance(
  mismatches: BooksMismatch[],
  missingAnswers: number,
): Verdict {
  if (mismatches.length === 0 && missingAnswers === 0) {
    return { status: "green", reason: "Every recounted number equals the saved answer." };
  }
  if (mismatches.length === 0) {
    return {
      status: "amber",
      reason: `${missingAnswers} standard window(s) have no saved answer yet. Open the Ads v2 tab on that window, or wait for the next hourly rebuild.`,
    };
  }
  const allExplainedTiming = mismatches.every((m) => m.fromSpendFeed && m.fedAfterAnswerSaved);
  if (allExplainedTiming) {
    return {
      status: "amber",
      reason:
        "Only spend numbers differ, and the spend arrived after the answer was saved. Nothing to do; the next hourly rebuild picks it up.",
    };
  }
  const worst = mismatches.filter((m) => !(m.fromSpendFeed && m.fedAfterAnswerSaved));
  const names = [...new Set(worst.map((m) => `${m.client} ${m.window} ${m.metric}`))].slice(0, 6);
  return {
    status: "red",
    reason: `The saved answer does not match a fresh count: ${names.join(", ")}. Re-run the Ads v2 sync, then look at the listed metric before trusting the tab.`,
  };
}

// ── 2. Our spend vs Meta ──────────────────────────────────────────────────

export interface SpendComparison {
  client: string;
  window: string;
  ourCents: number;
  metaCents: number;
  configured: boolean;
}

/** A gap this small cannot change any decision, and is explained below. */
export const SPEND_PENNY_ALLOWANCE_CENTS = 100;

export const SPEND_META_TOLERANCE_NOTE =
  "Our stored copy of Meta spend is compared against a fresh read from Meta. Green needs the two " +
  "within ONE DOLLAR and within 0.1 percent, both. That dollar is not a fudge, it is penny " +
  "rounding: we store each ad's spend hour by hour rounded to the nearest cent and add those up, " +
  "while Meta totals the whole account in full precision, so thousands of roundings leave a few " +
  "cents behind (measured: 1 to 10 cents on 3,000 dollars). A gap under a dollar cannot change any " +
  "decision, and anything that could would be far larger. Beyond that and within 1 percent is " +
  "amber, because Meta restates the most recent days for hours after they end. More than 1 percent " +
  "is red. A creator with no Meta key configured is amber, never red, because that is a missing " +
  "connection, not a wrong number.";

export function classifySpendVsMeta(rows: SpendComparison[]): Verdict {
  const unconfigured = rows.filter((r) => !r.configured);
  const live = rows.filter((r) => r.configured);
  const over = live.filter((r) => pct(r.ourCents, r.metaCents) > 1);
  if (over.length > 0) {
    const worst = over
      .map((r) => `${r.client} ${r.window} off by ${pct(r.ourCents, r.metaCents).toFixed(1)}%`)
      .slice(0, 4);
    return {
      status: "red",
      reason: `Our spend disagrees with Meta by more than 1 percent: ${worst.join(", ")}. Check the creator's Meta key, then re-run the ads sync for those days.`,
    };
  }
  // Beyond penny rounding, but still inside 1 percent: Meta settling.
  const settling = live.filter(
    (r) =>
      Math.abs(r.ourCents - r.metaCents) > SPEND_PENNY_ALLOWANCE_CENTS ||
      pct(r.ourCents, r.metaCents) > 0.1,
  );
  if (unconfigured.length > 0) {
    return {
      status: "amber",
      reason: `No Meta key configured for: ${[...new Set(unconfigured.map((r) => r.client))].join(", ")}. Connect it so spend can be double-checked.`,
    };
  }
  if (settling.length > 0) {
    return {
      status: "amber",
      reason: "Within 1 percent of Meta but more than penny rounding. That is Meta still settling the most recent days; nothing to do.",
    };
  }
  return { status: "green", reason: "Our spend matches Meta down to penny rounding." };
}

// ── 3. Our cash vs the sales sheet ────────────────────────────────────────

export const CASH_SHEET_TOLERANCE_NOTE =
  "The sale rows are built from the sales tracker sheet, so the totals must be identical to the " +
  "penny and the row counts must match. Any difference in the MONEY is red, always. One exception " +
  "on the row COUNT, and it is evidence-based, not a fudge: the sheet syncs every 10 minutes while " +
  "the sale rows rebuild hourly, so a call typed in between the two shows up as an extra sheet row " +
  "with no money attached. When the money matches exactly, the sheet has MORE rows than we do, and " +
  "the sheet synced after our last rebuild (proven by the two timestamps), the row is amber. " +
  "Anything else, including us holding more rows than the sheet, is red. Note this is cash on calls " +
  "by CALL date; payments landing this month is a different question.";

export function classifyCashVsSheet(input: {
  factsCents: number;
  trackerCents: number;
  factsRows: number;
  trackerRows: number;
  /** The sheet synced after our sale rows were last rebuilt. */
  sheetSyncedAfterRebuild?: boolean;
}): Verdict {
  const sameMoney = input.factsCents === input.trackerCents;
  const sameRows = input.factsRows === input.trackerRows;
  if (sameMoney && sameRows) {
    return { status: "green", reason: "Our cash equals the sales sheet to the penny." };
  }
  const behindByRowsOnly =
    sameMoney && input.trackerRows > input.factsRows && input.sheetSyncedAfterRebuild === true;
  if (behindByRowsOnly) {
    const behind = input.trackerRows - input.factsRows;
    return {
      status: "amber",
      reason: `The cash matches to the penny. ${behind} call(s) were typed into the sheet after our last rebuild and carry no money yet. Nothing to do; the next hourly rebuild picks them up.`,
    };
  }
  const bits: string[] = [];
  if (!sameMoney) bits.push(`cash differs by ${usd(input.factsCents - input.trackerCents)}`);
  if (!sameRows) bits.push(`row count differs by ${input.factsRows - input.trackerRows}`);
  return {
    status: "red",
    reason: `Our sale rows no longer match the sales sheet (${bits.join(", ")}). Re-run the sales sync, then compare the two by date.`,
  };
}

// ── 4. Freshness ──────────────────────────────────────────────────────────

export interface FeedFreshness {
  name: string;
  /** Hours since this feed last wrote. null means it has never written. */
  ageHours: number | null;
  maxHours: number;
}

export const FRESHNESS_TOLERANCE_NOTE =
  "Each feed has an expected gap between writes. Older than that is red, with the age shown. " +
  "A feed that has never written is red. There is no amber here on purpose: a feed is either " +
  "arriving on time or it is not.";

export function classifyFreshness(feeds: FeedFreshness[]): Verdict {
  const stale = feeds.filter((f) => f.ageHours === null || f.ageHours > f.maxHours);
  if (stale.length === 0) {
    return { status: "green", reason: "Every feed wrote within the time it should." };
  }
  const names = stale
    .map((f) => (f.ageHours === null ? `${f.name} (never)` : `${f.name} (${f.ageHours.toFixed(1)}h)`))
    .slice(0, 6);
  return {
    status: "red",
    reason: `These feeds have stopped arriving: ${names.join(", ")}. Check that feed's sync before trusting today's numbers.`,
  };
}

// ── 5. Stamp or reason ────────────────────────────────────────────────────

export const STAMP_TOLERANCE_NOTE =
  "Every DM, booking and sale row must carry either the hard key that proved its match or the " +
  "written reason there is none. The answer must be zero rows with neither. Anything above zero " +
  "is red and the row ids are listed. No amber: a silent blank is exactly what this system exists " +
  "to abolish.";

export function classifyStampOrReason(unexplainedRows: number): Verdict {
  if (unexplainedRows === 0) {
    return { status: "green", reason: "Every row explains itself." };
  }
  return {
    status: "red",
    reason: `${count(unexplainedRows)} row(s) carry neither a stamp nor a reason. Re-run the Ads v2 sync; if they survive, the listed ids need looking at by hand.`,
  };
}

// ── 6. Unknown-bucket purity ──────────────────────────────────────────────

export const PURITY_TOLERANCE_NOTE =
  "No sale may sit in 'unknown' when one of the two honest origin rules could explain it: either " +
  "every pre-sale keyword came from a creator no longer on the roster (label it 'former creator ad') " +
  "or exactly one keyword from one active creator came before the sale (stamp it). Zero missed. " +
  "Above zero is red. A sale that stays unknown because the person answered two different ads is " +
  "correctly unknown under the never-guess rule and is not counted here.";

export function classifyUnknownPurity(missed: number): Verdict {
  if (missed === 0) {
    return { status: "green", reason: "No sale is hiding in the unknown bucket." };
  }
  return {
    status: "red",
    reason: `${count(missed)} sale(s) sit in 'unknown' that we can honestly explain. Re-run the Ads v2 sync so the labeller runs, then re-check.`,
  };
}

// ── 7. Setter coverage ────────────────────────────────────────────────────

export const SETTER_TOLERANCE_NOTE =
  "If the keyword event names who set the appointment, the fact row must carry that name too. " +
  "Zero dropped. Above zero is red. Rows whose source genuinely has no setter are not counted: " +
  "that is a gap in ManyChat, not something we lost.";

export function classifySetterCoverage(missing: number): Verdict {
  if (missing === 0) {
    return { status: "green", reason: "No setter has been dropped." };
  }
  return {
    status: "red",
    reason: `${count(missing)} row(s) lost a setter we already had. Re-run the Ads v2 sync, which re-stamps them.`,
  };
}

// ── 8. Change-log continuity ──────────────────────────────────────────────

export const CHANGELOG_TOLERANCE_NOTE =
  "The ad change capture must have succeeded within the last 25 hours (it runs hourly, so 25 gives " +
  "one missed run of slack), and the change log must hold zero duplicate change ids. Either failing " +
  "is red. No amber: the log is either being kept or it is not.";

export function classifyChangeLog(input: {
  hoursSinceLastCapture: number | null;
  duplicateUids: number;
}): Verdict {
  const problems: string[] = [];
  if (input.hoursSinceLastCapture === null) problems.push("the capture has never succeeded");
  else if (input.hoursSinceLastCapture > 25)
    problems.push(`the last successful capture was ${input.hoursSinceLastCapture.toFixed(1)} hours ago`);
  if (input.duplicateUids > 0) problems.push(`${count(input.duplicateUids)} duplicate change id(s)`);
  if (problems.length === 0) {
    return { status: "green", reason: "The change log is being kept, with no duplicates." };
  }
  return {
    status: "red",
    reason: `The ad change log has a problem: ${problems.join(" and ")}. Check the hourly Ads v2 sync ran.`,
  };
}

// ── 9. Budget photos ──────────────────────────────────────────────────────

export const BUDGET_PHOTO_TOLERANCE_NOTE =
  "Every campaign and ad set that is currently live must have a budget photo taken today. " +
  "Any live dial missing today's photo is red. No amber: since Build 2 only live dials are " +
  "photographed daily, so a missing one means the photo job did not run.";

export function classifyBudgetPhotos(input: { active: number; photographed: number }): Verdict {
  if (input.active === input.photographed) {
    return { status: "green", reason: "Every live dial was photographed today." };
  }
  return {
    status: "red",
    reason: `${count(input.active - input.photographed)} live dial(s) have no photo today. Check the hourly Ads v2 sync ran; budget history for today is incomplete until it does.`,
  };
}

// ── 10. Two thermometers (v2 vs the frozen v1) ────────────────────────────

export interface ThermometerComparison {
  client: string;
  ourCents: number;
  v1Cents: number | null;
  /** Hours old the v1 photo is. null when there is no v1 photo at all. */
  v1AgeHours: number | null;
}

export const THERMOMETER_TOLERANCE_NOTE =
  "The frozen v1 tab is read (never written) as a second opinion on spend, over the 30 days ending " +
  "yesterday. Within 1 percent is green. More is red. Why 30 days and not one: v1 photographs a day " +
  "at about 23:10 Eastern, before the day has closed, so it is always short by the last hour. Over " +
  "one day that is about 4 percent; over 30 days the same missing hour is about 0.14 percent, " +
  "comfortably inside 1 percent. If the v1 photo is missing or older than 30 hours the row is amber " +
  "('v1 thermometer stale'), never red, because v1 is frozen and may simply have stopped.";

export function classifyThermometers(rows: ThermometerComparison[]): Verdict {
  const stale = rows.filter((r) => r.v1Cents === null || (r.v1AgeHours ?? Infinity) > 30);
  const live = rows.filter((r) => r.v1Cents !== null && (r.v1AgeHours ?? Infinity) <= 30);
  const off = live.filter((r) => pct(r.ourCents, r.v1Cents as number) > 1);
  if (off.length > 0) {
    const worst = off
      .map((r) => `${r.client} off by ${pct(r.ourCents, r.v1Cents as number).toFixed(2)}%`)
      .slice(0, 4);
    return {
      status: "red",
      reason: `The new numbers and the old tab disagree on spend: ${worst.join(", ")}. Two independent readings disagreeing means one of them is wrong; look before acting on either.`,
    };
  }
  if (stale.length > 0) {
    return {
      status: "amber",
      reason: `v1 thermometer stale for: ${stale.map((r) => r.client).join(", ")}. The old tab has not refreshed, so there is nothing to compare against today.`,
    };
  }
  return { status: "green", reason: "The new numbers and the old tab agree on spend." };
}

// ── 11. Ask twice ─────────────────────────────────────────────────────────

export const ASK_TWICE_TOLERANCE_NOTE =
  "The same question, asked twice through the saved path, must come back byte for byte identical, " +
  "and the warehouse shortcut must return the same row as the table it points at. Any difference " +
  "at all is red. This is the promise that computing once and saving actually holds.";

export function classifyAskTwice(input: {
  firstAnswer: string;
  secondAnswer: string;
  shortcutAnswer: string;
}): Verdict {
  const sameTwice = input.firstAnswer === input.secondAnswer;
  const sameShortcut = input.firstAnswer === input.shortcutAnswer;
  if (sameTwice && sameShortcut) {
    return { status: "green", reason: "Asked twice, answered the same, byte for byte." };
  }
  const bits: string[] = [];
  if (!sameTwice) bits.push("the same question gave two different answers");
  if (!sameShortcut) bits.push("the warehouse shortcut disagreed with the table it points at");
  return {
    status: "red",
    reason: `Ask-twice failed: ${bits.join(" and ")}. Stop trusting the tab until this is explained.`,
  };
}

// ── 12. Leak watch (informational, never red) ─────────────────────────────

export const LEAK_TOLERANCE_NOTE =
  "Informational only, never red. Counts bookings in the last 7 days that arrived through a link " +
  "carrying no keyword, with the trend against the 7 days before. This is the biggest fixable " +
  "attribution leak and it is fixed at the source (the booking link), not here.";

export function describeLeak(input: { last7: number; prior7: number }): Verdict {
  const delta = input.last7 - input.prior7;
  const direction = delta === 0 ? "flat" : delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
  return {
    status: "green",
    reason: `${count(input.last7)} keywordless booking(s) in the last 7 days, ${direction} on the 7 before. Fix at the booking link, not here.`,
  };
}

// ── 13. One front door (Build 4) ──────────────────────────────────────────

export interface DoorMismatch {
  client: string;
  window: string;
  metric: string;
  /** What the question door answered. */
  door: number | null;
  /** What the tab's saved payload holds. */
  saved: number | null;
}

export const ONE_DOOR_TOLERANCE_NOTE =
  "The question door and the Ads v2 tab must return the identical number, because they read the " +
  "identical saved row. There is NO tolerance here and there is no honest lag to allow: both sides " +
  "read the same snapshot at the same data version, so a difference cannot be timing and can only " +
  "be a fault in the door. Any difference at all is red. A window the door refuses to serve is also " +
  "red, because the tab would have served it.";

export function classifyOneDoor(input: {
  windowsChecked: number;
  comparisons: number;
  mismatches: DoorMismatch[];
  refusedWindows: string[];
}): Verdict {
  if (input.windowsChecked === 0) {
    return {
      status: "red",
      reason:
        "The door was asked nothing, because no saved window was found at the current data version. " +
        "That means either the sync has not warmed the windows yet or the door cannot see them. Check the Ads v2 tab opens.",
    };
  }
  if (input.refusedWindows.length) {
    return {
      status: "red",
      reason: `The door refused ${input.refusedWindows.length} window(s) the tab can serve, starting with ${input.refusedWindows[0]}. An AI would get no answer where the screen shows a number.`,
    };
  }
  if (input.mismatches.length) {
    const m = input.mismatches[0];
    return {
      status: "red",
      reason: `The door and the tab disagree on ${input.mismatches.length} number(s). First one: ${m.client} ${m.window} ${m.metric}, the door says ${m.door} and the saved answer says ${m.saved}. Stop trusting AI answers about the money until this is explained.`,
    };
  }
  return {
    status: "green",
    reason: `${count(input.comparisons)} numbers checked across ${count(input.windowsChecked)} saved windows; the door and the tab agree exactly.`,
  };
}
