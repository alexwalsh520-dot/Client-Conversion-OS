"use client";

import { useState } from "react";
import ContextSelector from "@/components/xray/ContextSelector";
import FunnelXRay from "@/components/xray/FunnelXRay";
import SalesXRay from "@/components/xray/SalesXRay";
import CoachingXRay from "@/components/xray/CoachingXRay";
import AdsXRay from "@/components/xray/AdsXRay";

const VIEW_MAP: Record<string, React.ComponentType> = {
  funnel: FunnelXRay,
  sales: SalesXRay,
  coaching: CoachingXRay,
  ads: AdsXRay,
};

export default function XRayPage() {
  const [activeTab, setActiveTab] = useState("funnel");
  const ActiveView = VIEW_MAP[activeTab] || FunnelXRay;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            X-Ray
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              marginTop: 4,
            }}
          >
            Deep dive into any area of the business
          </p>
        </div>
        <ContextSelector activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
      <div className="fade-up">
        <ActiveView />
      </div>
    </div>
  );
}
