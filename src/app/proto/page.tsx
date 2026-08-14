"use client";

import { Card, PageHead, SectionTitle, SampleBanner } from "./kit";
import { SAMPLE_NOTICE } from "./data";
import Link from "next/link";

const SCREENS = [
  { href: "/proto/ads-v2", name: "Ads v2", what: "Dense money table. The hardest test for spacing and for whether colour still reads as meaning." },
  { href: "/proto/manager-ads", name: "Manager Ads View", what: "Per-creator summary and alerts. Tests cards, sparklines and status colour." },
  { href: "/proto/sales-hub", name: "Sales Hub", what: "Leaderboard plus a day's calls. Tests two tables of different shapes on one page." },
  { href: "/proto/factory", name: "Factory", what: "Project cards and a render queue. Tests grid layout and progress states." },
  { href: "/proto/content", name: "Content", what: "Schedule plus voice-of-customer quotes. Tests long text, which every dense design gets wrong." },
];

export default function ProtoHome() {
  return (
    <>
      <PageHead title="Design prototype" sub="Five CCOS screens on one shared set of design tokens. Change the design at the top; every screen changes with it." />
      <SampleBanner text={SAMPLE_NOTICE} />

      <Card>
        <div style={{ fontSize: "var(--p-font)", color: "var(--p-text-2)", lineHeight: 1.65 }}>
          <p style={{ marginBottom: 10 }}>
            Pick a theme along the top, then open the options for typefaces, sidebar shapes, surface treatment, table
            rows and the small polish switches. Whatever you land on applies to all five screens at once, so you are
            judging a direction rather than a page.
          </p>
          <p style={{ marginBottom: 10 }}>
            The three that change the feel most, in order: the <b>typeface</b>, the <b>sidebar shape</b>, and
            <b> aligned digits</b> — which lines decimal points up down a column and is the cheapest thing here that
            makes money tables look properly built.
          </p>
          <p style={{ margin: 0 }}>
            These are faithful replicas, not the live pages. They exist so a design can be judged safely and quickly. Once
            you like something, it gets ported into the real app as a normal change.
          </p>
        </div>
      </Card>

      <SectionTitle>The screens</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: "var(--p-gap)" }}>
        {SCREENS.map((s) => (
          <Link key={s.href} href={s.href} style={{ textDecoration: "none" }}>
            <Card style={{ height: "100%" }}>
              <div style={{ fontSize: 14.5, fontWeight: 620, color: "var(--p-accent)", marginBottom: 6 }}>{s.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--p-muted)", lineHeight: 1.55 }}>{s.what}</div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
