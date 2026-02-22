"use client";

import MoneyOnTable from "@/components/pulse/MoneyOnTable";
import IntelligenceFeed from "@/components/pulse/IntelligenceFeed";
import CollapsibleNumbers from "@/components/pulse/CollapsibleNumbers";
import {
  computeMoneyOnTable,
  generateInsightFeed,
} from "@/lib/intelligence-engine";

export default function PulsePage() {
  const moneyOnTable = computeMoneyOnTable();
  const insights = generateInsightFeed();

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 32 }}
    >
      <MoneyOnTable
        total={moneyOnTable.total}
        biggestLever={moneyOnTable.biggestLever}
      />
      <IntelligenceFeed cards={insights} />
      <CollapsibleNumbers />
    </div>
  );
}
