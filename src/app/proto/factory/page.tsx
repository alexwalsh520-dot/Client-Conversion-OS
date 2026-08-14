"use client";

import { Card, PageHead, SectionTitle, Pill, SampleBanner } from "../kit";
import { factory, SAMPLE_NOTICE } from "../data";

const statePill = (s: string) =>
  s === "done" ? <Pill kind="good">Done</Pill>
  : s === "rendering" ? <Pill kind="warn">Rendering</Pill>
  : <Pill kind="flat">Queued</Pill>;

export default function ProtoFactory() {
  return (
    <>
      <PageHead title="Factory" sub="Creative projects and what is rendering right now." />
      <SampleBanner text={SAMPLE_NOTICE} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "var(--p-gap)" }}>
        {factory.projects.map((p) => (
          <Card key={p.name}>
            <div style={{ fontSize: 14.5, fontWeight: 620, marginBottom: 10, lineHeight: 1.35 }}>{p.name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "var(--p-muted)" }}>
              <span>{p.assets} assets</span>
              <Pill kind={p.status === "Live" ? "good" : p.status === "In review" ? "warn" : "flat"}>{p.status}</Pill>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--p-muted)", marginTop: 10 }}>Updated {p.updated}</div>
          </Card>
        ))}
      </div>

      <SectionTitle>Render queue</SectionTitle>
      <Card pad={false}>
        {factory.queue.map((q, i) => (
          <div
            key={q.name}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "calc(var(--p-pad) * 0.65) var(--p-pad)",
              borderBottom: i === factory.queue.length - 1 ? "none" : "1px solid var(--p-border)",
              fontSize: "var(--p-font)",
            }}
          >
            <span style={{ color: "var(--p-text-2)" }}>{q.name}</span>
            {statePill(q.state)}
          </div>
        ))}
      </Card>
    </>
  );
}
