/**
 * ICP corpus — everything the /icp tab renders.
 *
 *   GET /api/icp
 *     → { people: [...], themes: [...], totals: {...} }
 *
 * Authenticated users only. This is real people's private disclosure from our
 * own recorded sales calls, so it never goes out over an anon key: the tables
 * have RLS on with no permissive policy, and we read them with the service
 * role behind this auth check.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

type PersonRow = {
  fathom_id: string;
  name: string;
  closer: string | null;
  recorded_on: string | null;
  duration_sec: number | null;
  words_spoken: number;
  quote_count: number;
  vet_lines: string[];
  raw_lines: string[];
};

type HighlightRow = {
  section: string;
  section_pos: number;
  position: number;
  kind: string;
  quote: string;
  person_name: string | null;
  said_on: string | null;
};

type QuoteRow = {
  fathom_id: string;
  theme: string;
  quote: string;
  context: string | null;
  position: number;
};

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceSupabase();

  const { data: people, error: peopleError } = await sb
    .from("icp_people")
    .select("fathom_id,name,closer,recorded_on,duration_sec,words_spoken,quote_count,vet_lines,raw_lines")
    .order("quote_count", { ascending: false });

  if (peopleError) {
    return NextResponse.json({ error: peopleError.message }, { status: 500 });
  }

  // ~3k rows, so page through rather than trust the default 1000-row cap.
  const quotes: QuoteRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from("icp_quotes")
      .select("fathom_id,theme,quote,context,position")
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    quotes.push(...(data as QuoteRow[]));
    if (data.length < page) break;
  }

  // Sharpest lines: hand-picked, grouped under the frames Alex named. Editorial
  // selection, verbatim words — see data/icp-sharpest-lines.md.
  const { data: highlightRows, error: highlightError } = await sb
    .from("icp_highlights")
    .select("section,section_pos,position,kind,quote,person_name,said_on")
    .order("section_pos", { ascending: true })
    .order("position", { ascending: true });

  if (highlightError) {
    return NextResponse.json({ error: highlightError.message }, { status: 500 });
  }

  const highlightSections: { section: string; items: { kind: string; quote: string; who: string | null; date: string | null }[] }[] = [];
  for (const h of (highlightRows ?? []) as HighlightRow[]) {
    let group = highlightSections[highlightSections.length - 1];
    if (!group || group.section !== h.section) {
      group = { section: h.section, items: [] };
      highlightSections.push(group);
    }
    group.items.push({ kind: h.kind, quote: h.quote, who: h.person_name, date: h.said_on });
  }

  // Theme order follows how many people raised it, so the loudest is first.
  const themeTotals = new Map<string, number>();
  for (const q of quotes) themeTotals.set(q.theme, (themeTotals.get(q.theme) ?? 0) + 1);
  const themes = [...themeTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => ({ theme, count }));

  const byPerson = new Map<string, QuoteRow[]>();
  for (const q of quotes) {
    const list = byPerson.get(q.fathom_id);
    if (list) list.push(q);
    else byPerson.set(q.fathom_id, [q]);
  }

  const rows = (people ?? []) as PersonRow[];

  return NextResponse.json({
    highlights: highlightSections,
    people: rows.map((p) => ({
      id: p.fathom_id,
      name: p.name,
      closer: p.closer,
      date: p.recorded_on,
      minutes: p.duration_sec ? Math.round(p.duration_sec / 60) : null,
      words: p.words_spoken,
      quoteCount: p.quote_count,
      vetLines: p.vet_lines ?? [],
      rawLines: p.raw_lines ?? [],
      quotes: (byPerson.get(p.fathom_id) ?? []).map((q) => ({
        theme: q.theme,
        quote: q.quote,
        context: q.context,
      })),
    })),
    themes,
    totals: {
      people: rows.length,
      quotes: quotes.length,
      words: rows.reduce((a, p) => a + (p.words_spoken ?? 0), 0),
    },
  });
}
