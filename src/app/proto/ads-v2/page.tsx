"use client";

import { PageHead, StatRow, Table, Pill, SampleBanner, SectionTitle } from "../kit";
import { adsV2, SAMPLE_NOTICE } from "../data";

const verdictPill = (v: string) =>
  v === "scale" ? <Pill kind="good">Scale</Pill>
  : v === "kill" ? <Pill kind="bad">Kill</Pill>
  : v === "watch" ? <Pill kind="warn">Watch</Pill>
  : <Pill kind="flat">Hold</Pill>;

export default function ProtoAdsV2() {
  const money = (n: number) => (n === 0 ? "—" : `$${n.toLocaleString()}`);
  return (
    <>
      <PageHead title="Ads v2" sub="Every live keyword, what it cost and what it brought back." />
      <SampleBanner text={SAMPLE_NOTICE} />
      <StatRow items={adsV2.headline} />
      <SectionTitle>Live keywords</SectionTitle>
      <Table
        head={["Keyword", "Creator", "Spend", "Leads", "Booked", "Sales", "Collected", "Verdict"]}
        rows={adsV2.ads.map((a) => [
          <b key="k" style={{ letterSpacing: ".02em" }}>{a.keyword}</b>,
          a.creator,
          money(a.spend),
          a.leads,
          a.booked,
          a.sales,
          money(a.collected),
          verdictPill(a.verdict),
        ])}
      />
    </>
  );
}
