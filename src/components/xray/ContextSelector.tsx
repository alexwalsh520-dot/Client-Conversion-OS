"use client";

import { GitBranch, DollarSign, Heart, Megaphone } from "lucide-react";

const tabs = [
  { key: "funnel", label: "Funnel", icon: GitBranch },
  { key: "sales", label: "Sales", icon: DollarSign },
  { key: "coaching", label: "Coaching", icon: Heart },
  { key: "ads", label: "Ads", icon: Megaphone },
];

interface ContextSelectorProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function ContextSelector({
  activeTab,
  onTabChange,
}: ContextSelectorProps) {
  return (
    <div
      className="glass-subtle"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 10,
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`context-tab${isActive ? " context-tab-active" : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon size={16} strokeWidth={1.8} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
