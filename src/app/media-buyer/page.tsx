"use client";

import { DollarSign } from "lucide-react";

export default function MediaBuyerPage() {
  return (
    <div className="fade-up">
      <div className="page-header">
        <h1 className="page-title">Media Buyer</h1>
        <p className="page-subtitle">Ad spend management, ROI tracking, and campaign optimization</p>
      </div>

      <div className="glass-static" style={{ padding: 40, textAlign: "center" }}>
        <DollarSign size={40} style={{ color: "var(--accent)", marginBottom: 16 }} />
        <h2 style={{ color: "var(--text-primary)", fontSize: 18, marginBottom: 8 }}>Coming Soon</h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Media buyer tools and campaign analytics will be available here.
        </p>
      </div>
    </div>
  );
}
