"use client";

import { Card, PageHead, SectionTitle, Spark, Pill, SampleBanner } from "../kit";
import { managerAds, SAMPLE_NOTICE } from "../data";

export default function ProtoManagerAds() {
  return (
    <>
      <PageHead title="Manager Ads View" sub="Where each creator stands this week, and what needs a decision." />
      <SampleBanner text={SAMPLE_NOTICE} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "var(--p-gap)" }}>
        {managerAds.creators.map((c) => (
          <Card key={c.name}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 640 }}>{c.name}</span>
              <Spark points={c.trend} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "var(--p-font)" }}>
              {[["Spend", `$${c.spend.toLocaleString()}`], ["Booked", String(c.booked)], ["Sales", String(c.sales)], ["Collected", `$${c.collected.toLocaleString()}`]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ color: "var(--p-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</div>
                  <div style={{ color: "var(--p-text)", fontSize: 17, fontWeight: 620, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Needs a decision</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {managerAds.alerts.map((a, i) => (
          <Card key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Pill kind={a.level === "warn" ? "warn" : "good"}>{a.level === "warn" ? "Check" : "Good"}</Pill>
            <span style={{ fontSize: "var(--p-font)", color: "var(--p-text-2)", lineHeight: 1.55 }}>{a.text}</span>
          </Card>
        ))}
      </div>
    </>
  );
}
