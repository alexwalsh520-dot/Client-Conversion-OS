"use client";

import { Card, PageHead, Table, Pill, SectionTitle, SampleBanner } from "../kit";
import { content, SAMPLE_NOTICE } from "../data";

export default function ProtoContent() {
  return (
    <>
      <PageHead title="Content" sub="What is scheduled, and the customer language it came from." />
      <SampleBanner text={SAMPLE_NOTICE} />

      <SectionTitle>Schedule</SectionTitle>
      <Table
        head={["Post", "Platform", "State", "When"]}
        rows={content.posts.map((p) => [
          p.title,
          p.platform,
          <Pill key="s" kind={p.state === "Posted" ? "good" : p.state === "Scheduled" ? "warn" : "flat"}>{p.state}</Pill>,
          p.when,
        ])}
      />

      <SectionTitle>Voice of customer</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {content.voc.map((q) => (
          <Card key={q}>
            <div style={{ borderLeft: "2px solid var(--p-accent)", paddingLeft: 14, fontSize: 15, lineHeight: 1.6, color: "var(--p-text)" }}>
              &ldquo;{q}&rdquo;
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
