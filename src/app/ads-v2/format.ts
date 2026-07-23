// Client-side cell formatting. Every derived value comes from the SAME
// derive() the server and tests use, computed over the node's base metrics, so
// a campaign row, an ad row, and the TOTAL row are all one formula over sums.

import { derive } from "@/lib/ads-v2/metrics";
import { formatUsd } from "@/lib/ads-v2/money";
import { COLUMN_BY_KEY } from "@/lib/ads-v2/definitions";
import type { AdsV2Node, BaseMetrics } from "@/lib/ads-v2/types";

export type CellClass = "" | "pos" | "neg" | "dim";

export interface Cell {
  text: string;
  cls: CellClass;
  isCalc: boolean;
}

const DASH = "-";

function pct(v: number | null): string {
  return v == null ? DASH : `${(v * 100).toFixed(1)}%`;
}
function money(cents: number | null): string {
  return cents == null ? DASH : formatUsd(cents);
}
function money2(cents: number | null): string {
  return cents == null ? DASH : formatUsd(cents, { decimals: 2 });
}
function int(n: number): string {
  return n.toLocaleString("en-US");
}

// Green/red/dim thresholds in the spirit of v1: healthy vs costly.
function classFor(key: string, base: BaseMetrics): CellClass {
  const d = derive(base);
  switch (key) {
    case "cpm":
      return d.cpmCents == null ? "dim" : d.cpmCents <= 700 ? "pos" : d.cpmCents >= 1000 ? "neg" : "";
    case "cpc":
      return d.cpcCents == null ? "dim" : d.cpcCents <= 150 ? "pos" : d.cpcCents >= 400 ? "neg" : "";
    case "collectedRoi":
      return d.collectedRoi == null ? "dim" : d.collectedRoi >= 2 ? "pos" : d.collectedRoi < 1 ? "neg" : "";
    case "showRate":
      return d.showRate == null ? "dim" : d.showRate >= 0.6 ? "pos" : d.showRate < 0.4 ? "neg" : "";
    case "closeRate":
      return d.closeRate == null ? "dim" : d.closeRate >= 0.3 ? "pos" : "";
    default:
      return "";
  }
}

export function formatCell(key: string, node: AdsV2Node): Cell {
  const col = COLUMN_BY_KEY[key];
  const isCalc = !!col?.calc;
  const base: BaseMetrics = node;
  const d = derive(base);

  let text = DASH;
  switch (key) {
    case "budget": {
      const b = node.budget;
      if (!b || !b.holds || b.dailyUsdCents == null) {
        // Lifetime budget shows if there is no daily one.
        if (b?.holds && b.lifetimeUsdCents != null) text = `${formatUsd(b.lifetimeUsdCents)} total`;
        else text = DASH;
      } else {
        text = `${formatUsd(b.dailyUsdCents)}/day`;
      }
      break;
    }
    case "spend":
      text = money(node.spendCents);
      break;
    case "impressions":
      text = int(node.impressions);
      break;
    case "cpm":
      text = money2(d.cpmCents);
      break;
    case "clicks":
      text = int(node.clicks);
      break;
    case "ctr":
      text = pct(d.ctr);
      break;
    case "cpc":
      text = money2(d.cpcCents);
      break;
    case "messages":
      text = int(node.messages);
      break;
    case "costPerMessage":
      text = money2(d.costPerMessageCents);
      break;
    case "booked":
      text = int(node.booked);
      break;
    case "costPerBooked":
      text = money2(d.costPerBookedCents);
      break;
    case "taken":
      text = int(node.taken);
      break;
    case "costPerTaken":
      text = money2(d.costPerTakenCents);
      break;
    case "showRate":
      text = pct(d.showRate);
      break;
    case "newClients":
      text = int(node.newClients);
      break;
    case "closeRate":
      text = pct(d.closeRate);
      break;
    case "msgToCall":
      text = pct(d.msgToCall);
      break;
    case "collected":
      text = money(node.collectedCents);
      break;
    case "costPerClient":
      text = money(d.costPerClientCents);
      break;
    case "collectedRoi":
      text = d.collectedRoi == null ? DASH : `${d.collectedRoi.toFixed(2)}x`;
      break;
    default:
      text = DASH;
  }

  const cls = text === DASH ? "dim" : classFor(key, base);
  return { text, cls, isCalc };
}

// The numeric value used for sorting a column (nulls sort last).
export function sortValue(key: string, node: AdsV2Node): number {
  const d = derive(node);
  switch (key) {
    case "budget":
      return node.budget?.dailyUsdCents ?? node.budget?.lifetimeUsdCents ?? -1;
    case "spend":
      return node.spendCents;
    case "impressions":
      return node.impressions;
    case "cpm":
      return d.cpmCents ?? -1;
    case "clicks":
      return node.clicks;
    case "ctr":
      return d.ctr ?? -1;
    case "cpc":
      return d.cpcCents ?? -1;
    case "messages":
      return node.messages;
    case "costPerMessage":
      return d.costPerMessageCents ?? -1;
    case "booked":
      return node.booked;
    case "costPerBooked":
      return d.costPerBookedCents ?? -1;
    case "taken":
      return node.taken;
    case "costPerTaken":
      return d.costPerTakenCents ?? -1;
    case "showRate":
      return d.showRate ?? -1;
    case "newClients":
      return node.newClients;
    case "closeRate":
      return d.closeRate ?? -1;
    case "msgToCall":
      return d.msgToCall ?? -1;
    case "collected":
      return node.collectedCents;
    case "costPerClient":
      return d.costPerClientCents ?? -1;
    case "collectedRoi":
      return d.collectedRoi ?? -1;
    default:
      return 0;
  }
}
