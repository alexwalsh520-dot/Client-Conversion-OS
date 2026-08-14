"use client";

import { PageHead, StatRow, Table, Pill, SectionTitle, SampleBanner } from "../kit";
import { salesHub, SAMPLE_NOTICE } from "../data";

const outcomePill = (o: string) =>
  o === "Closed" ? <Pill kind="good">Closed</Pill>
  : o === "Lost" ? <Pill kind="bad">Lost</Pill>
  : o === "No show" ? <Pill kind="warn">No show</Pill>
  : <Pill kind="flat">Follow-up</Pill>;

export default function ProtoSalesHub() {
  return (
    <>
      <PageHead title="Sales Hub" sub="How the floor is performing, and how today actually went." />
      <SampleBanner text={SAMPLE_NOTICE} />
      <StatRow items={salesHub.headline} />

      <SectionTitle>Closers</SectionTitle>
      <Table
        head={["Closer", "Taken", "Closed", "Close rate", "Collected", "Avg response"]}
        rows={salesHub.closers.map((c) => [
          <b key="n">{c.name}</b>,
          c.taken,
          c.closed,
          `${c.rate}%`,
          `$${c.collected.toLocaleString()}`,
          c.response,
        ])}
      />

      <SectionTitle>Today&rsquo;s calls</SectionTitle>
      <Table
        head={["Time", "Prospect", "Closer", "Outcome", "Value"]}
        rows={salesHub.calls.map((c) => [c.time, c.prospect, c.closer, outcomePill(c.outcome), c.value || "—"])}
      />
    </>
  );
}
