"use client";

/**
 * ICP — the veteran voice-of-customer corpus, at /icp under Marketing.
 *
 * Verbatim quotes from our own recorded sales calls, from the men who told us
 * themselves that they served. Grouping is filing, not analysis: nothing here
 * is summarised or interpreted, so the words can be used as evidence.
 */

import { useEffect, useMemo, useState } from "react";
import { Target, Search, AlertTriangle, ChevronDown } from "lucide-react";

type Quote = { theme: string; quote: string; context: string | null };
type Person = {
  id: string;
  name: string;
  closer: string | null;
  date: string | null;
  minutes: number | null;
  words: number;
  quoteCount: number;
  vetLines: string[];
  rawLines: string[];
  quotes: Quote[];
};
type Highlight = { kind: string; quote: string; who: string | null; date: string | null };
type HighlightSection = { section: string; items: Highlight[] };
type Corpus = {
  highlights: HighlightSection[];
  people: Person[];
  themes: { theme: string; count: number }[];
  totals: { people: number; quotes: number; words: number };
};

type TabKey = "sharpest" | "people" | "themes" | "search" | "about";

const TABS: { key: TabKey; label: string }[] = [
  { key: "sharpest", label: "Sharpest lines" },
  { key: "people", label: "By person" },
  { key: "themes", label: "By theme" },
  { key: "search", label: "Search everything" },
  { key: "about", label: "How this was built" },
];

const prettyTheme = (t: string) =>
  t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function Quotation({ quote, context }: { quote: string; context?: string | null }) {
  return (
    <div style={{ borderLeft: "2px solid var(--border)", padding: "2px 0 2px 16px", marginBottom: 15 }}>
      {context && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 6 }}>
          {context}
        </div>
      )}
      <div style={{ fontSize: 15, lineHeight: 1.62, color: "var(--text-primary)" }}>&ldquo;{quote}&rdquo;</div>
    </div>
  );
}

export default function IcpPage() {
  const [data, setData] = useState<Corpus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("sharpest");

  const [personFilter, setPersonFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rawOpen, setRawOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/icp");
        if (!res.ok) throw new Error(res.status === 401 ? "Not signed in." : `Request failed (${res.status})`);
        const json = (await res.json()) as Corpus;
        if (cancelled) return;
        setData(json);
        setSelectedId(json.people[0]?.id ?? null);
        setSelectedTheme(json.themes[0]?.theme ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the corpus.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const person = useMemo(
    () => data?.people.find((p) => p.id === selectedId) ?? null,
    [data, selectedId]
  );

  // His quotes grouped by theme, keeping the corpus theme order.
  const personThemes = useMemo(() => {
    if (!person || !data) return [];
    return data.themes
      .map(({ theme }) => ({ theme, quotes: person.quotes.filter((q) => q.theme === theme) }))
      .filter((g) => g.quotes.length > 0);
  }, [person, data]);

  const themeGroups = useMemo(() => {
    if (!data || !selectedTheme) return [];
    return data.people
      .map((p) => ({ person: p, quotes: p.quotes.filter((q) => q.theme === selectedTheme) }))
      .filter((g) => g.quotes.length > 0);
  }, [data, selectedTheme]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!data || q.length < 3) return null;
    const groups = data.people
      .map((p) => ({ person: p, lines: p.rawLines.filter((l) => l.toLowerCase().includes(q)) }))
      .filter((g) => g.lines.length > 0);
    return { groups, lines: groups.reduce((a, g) => a + g.lines.length, 0) };
  }, [data, query]);

  if (error) {
    return (
      <div className="fade-up">
        <div className="page-header">
          <h1 className="page-title">ICP</h1>
        </div>
        <div className="glass-static" style={{ padding: 20, color: "var(--danger)" }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fade-up">
        <div className="page-header">
          <h1 className="page-title">ICP</h1>
          <p className="page-subtitle">Loading the corpus...</p>
        </div>
      </div>
    );
  }

  const stat = (value: string, label: string) => (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".07em" }}>{label}</div>
    </div>
  );

  return (
    <div className="fade-up">
      <div className="page-header">
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Target size={22} style={{ color: "var(--accent)" }} />
          ICP
        </h1>
        <p className="page-subtitle">
          What our veteran buyers actually said, word for word, on their own sales calls. Nothing summarised.
        </p>
      </div>

      <div className="glass-static" style={{ padding: 20, marginBottom: 20, display: "flex", gap: 34, flexWrap: "wrap" }}>
        {stat(String(data.totals.people), "veterans")}
        {stat(data.totals.quotes.toLocaleString(), "quotes")}
        {stat(String(data.themes.length), "themes")}
        {stat(data.totals.words.toLocaleString(), "of their words")}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom: `2px solid ${tab === t.key ? "var(--accent)" : "transparent"}`,
              color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 14, fontWeight: tab === t.key ? 600 : 500,
              padding: "11px 15px", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------------- Sharpest lines ---------------- */}
      {tab === "sharpest" && (
        <div style={{ maxWidth: "80ch" }}>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 24 }}>
            Hand-picked from all {data.totals.quotes.toLocaleString()} quotes, grouped under the frames you named.
            The picking is editorial. The words are not: every line is exactly what he said.
          </p>
          {data.highlights.map((section) => (
            <div key={section.section}>
              <h3 className="section-title" style={{ fontSize: 16 }}>{section.section}</h3>
              {section.items.map((item, i) =>
                item.kind === "note" ? (
                  <p key={i} style={{ fontSize: 13.5, color: "var(--text-muted)", margin: "4px 0 16px" }}>
                    {item.quote}
                  </p>
                ) : (
                  <div key={i} style={{ borderLeft: "2px solid var(--border)", padding: "2px 0 2px 16px", marginBottom: 15 }}>
                    <div style={{ fontSize: 15, lineHeight: 1.62, color: "var(--text-primary)" }}>
                      &ldquo;{item.quote}&rdquo;
                    </div>
                    {item.who && (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
                        {item.who}{item.date ? `, ${item.date}` : ""}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------------- By person ---------------- */}
      {tab === "people" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,280px) 1fr", gap: 28, alignItems: "start" }}>
          <div>
            <input
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              placeholder="Filter people..."
              style={{
                width: "100%", background: "var(--bg-secondary)", border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text-primary)", fontSize: 14, padding: "9px 12px",
                marginBottom: 12, fontFamily: "inherit",
              }}
            />
            <div className="glass-static" style={{ padding: 0, maxHeight: "70vh", overflowY: "auto" }}>
              {data.people
                .filter((p) => p.name.toLowerCase().includes(personFilter.trim().toLowerCase()))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setSelectedId(p.id); setRawOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: p.id === selectedId ? "var(--bg-secondary)" : "transparent",
                      border: "none", borderBottom: "1px solid var(--border)",
                      boxShadow: p.id === selectedId ? "inset 2px 0 0 var(--accent)" : "none",
                      color: p.id === selectedId ? "var(--accent)" : "var(--text-secondary)",
                      fontSize: 13.5, padding: "10px 13px", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {p.name}
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                      {p.date} · {p.quoteCount} quotes
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <div>
            {person && (
              <>
                <h2 className="section-title" style={{ marginTop: 0 }}>{person.name}</h2>
                <div
                  className="glass-static"
                  style={{ padding: "13px 16px", marginBottom: 24, display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5, color: "var(--text-muted)" }}
                >
                  <span>Called <b style={{ color: "var(--text-primary)" }}>{person.date}</b></span>
                  <span>Closer <b style={{ color: "var(--text-primary)" }}>{person.closer}</b></span>
                  <span>Spoke <b style={{ color: "var(--text-primary)" }}>{person.words.toLocaleString()}</b> words</span>
                  {person.minutes && <span>Call was <b style={{ color: "var(--text-primary)" }}>{person.minutes} min</b></span>}
                  <span>Fathom ID <b style={{ color: "var(--text-primary)" }}>{person.id}</b></span>
                </div>

                <h3 className="section-title" style={{ fontSize: 16 }}>How he told us he served</h3>
                {person.vetLines.map((line, i) => <Quotation key={i} quote={line} />)}

                {personThemes.map((group) => (
                  <div key={group.theme}>
                    <h3 className="section-title" style={{ fontSize: 16 }}>{prettyTheme(group.theme)}</h3>
                    {group.quotes.map((q, i) => <Quotation key={i} quote={q.quote} context={q.context} />)}
                  </div>
                ))}

                <div style={{ borderTop: "1px solid var(--border)", marginTop: 30, paddingTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setRawOpen((o) => !o)}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7 }}
                  >
                    <ChevronDown size={14} style={{ transform: rawOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                    Everything he said, in order ({person.rawLines.length} lines, unfiltered)
                  </button>
                  {rawOpen && (
                    <ul style={{ margin: "16px 0 0 18px", color: "var(--text-secondary)", fontSize: 14 }}>
                      {person.rawLines.map((line, i) => <li key={i} style={{ marginBottom: 7 }}>{line}</li>)}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------------- By theme ---------------- */}
      {tab === "themes" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,280px) 1fr", gap: 28, alignItems: "start" }}>
          <div className="glass-static" style={{ padding: 0, maxHeight: "70vh", overflowY: "auto" }}>
            {data.themes.map((t) => (
              <button
                key={t.theme}
                type="button"
                onClick={() => setSelectedTheme(t.theme)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: t.theme === selectedTheme ? "var(--bg-secondary)" : "transparent",
                  border: "none", borderBottom: "1px solid var(--border)",
                  boxShadow: t.theme === selectedTheme ? "inset 2px 0 0 var(--accent)" : "none",
                  color: t.theme === selectedTheme ? "var(--accent)" : "var(--text-secondary)",
                  fontSize: 13.5, padding: "10px 13px", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {prettyTheme(t.theme)}
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                  {t.count} quotes
                </span>
              </button>
            ))}
          </div>

          <div>
            <h2 className="section-title" style={{ marginTop: 0 }}>{selectedTheme ? prettyTheme(selectedTheme) : ""}</h2>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 20 }}>
              Every veteran who said it, in his own words.
            </p>
            {themeGroups.map((g) => (
              <div key={g.person.id}>
                <h3 className="section-title" style={{ fontSize: 16 }}>
                  {g.person.name}{" "}
                  <span style={{ fontWeight: 400, fontSize: 13, color: "var(--text-muted)" }}>{g.person.date}</span>
                </h3>
                {g.quotes.map((q, i) => <Quotation key={i} quote={q.quote} />)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Search ---------------- */}
      {tab === "search" && (
        <div>
          <div style={{ position: "relative", marginBottom: 20 }}>
            <Search size={16} style={{ position: "absolute", left: 13, top: 12, color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every word they said. Try: drinking, mirror, my wife, excuse, got out"
              style={{
                width: "100%", background: "var(--bg-secondary)", border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text-primary)", fontSize: 14,
                padding: "10px 13px 10px 36px", fontFamily: "inherit",
              }}
            />
          </div>

          {!searchResults && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Type at least 3 characters.</p>}
          {searchResults && searchResults.lines === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Nothing.</p>
          )}
          {searchResults && searchResults.lines > 0 && (
            <>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 18 }}>
                {searchResults.lines} lines from {searchResults.groups.length} people
              </p>
              {searchResults.groups.map((g) => (
                <div key={g.person.id}>
                  <h3 className="section-title" style={{ fontSize: 16 }}>
                    {g.person.name}{" "}
                    <span style={{ fontWeight: 400, fontSize: 13, color: "var(--text-muted)" }}>{g.person.date}</span>
                  </h3>
                  {g.lines.map((line, i) => <Quotation key={i} quote={line} />)}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ---------------- About ---------------- */}
      {tab === "about" && (
        <div style={{ maxWidth: "76ch" }}>
          <h3 className="section-title" style={{ marginTop: 0, fontSize: 16 }}>What this is</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 15 }}>
            Every sales call we record goes into Fathom. This keeps only the calls where the man told us
            himself that he served, throws away everything our closers said, and files what is left by subject.
          </p>

          <h3 className="section-title" style={{ fontSize: 16 }}>How it was filtered</h3>
          <ol style={{ marginLeft: 20, color: "var(--text-secondary)" }}>
            <li style={{ marginBottom: 12 }}>Started from 463 recorded calls, 458 with usable transcripts, covering 2 Dec 2025 to 11 Aug 2026.</li>
            <li style={{ marginBottom: 12 }}>Kept only prospect calls (Strategy Sessions and Onboarding). Team huddles, C Suite, creator calls and interviews are gone.</li>
            <li style={{ marginBottom: 12 }}>Split every line by who was speaking, then deleted our side. Only his words are quoted.</li>
            <li style={{ marginBottom: 12 }}>
              A man is only in here if <b>he himself</b> said he served. Austin is ex-Army and raises the military on
              nearly every call, so filtering on keywords alone would have dragged in dozens of civilians. His words
              qualify nobody. Only theirs do.
            </li>
            <li style={{ marginBottom: 12 }}>Closer lines appear only as greyed context, so his answer makes sense.</li>
          </ol>

          <div
            className="glass-static"
            style={{ padding: "16px 18px", margin: "22px 0", borderLeft: "3px solid var(--warning)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontWeight: 600, color: "var(--warning)" }}>
              <AlertTriangle size={15} /> Before you use a line as a weapon
            </div>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
              <b>Check the recording first.</b> Speaker labels come from Fathom&rsquo;s automatic transcription and it does
              get them wrong. On at least one call in this database the labels visibly swap mid-conversation. Every
              person&rsquo;s Fathom ID is on their page. Confirm he said it before you say it back to him.
            </p>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
              <b>The blank gaps are swearing.</b> Fathom censors profanity, which is why lines read &ldquo;all the drinking
              and dumb that I was doing&rdquo;. Nothing is missing except the swear word.
            </p>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
              <b>Some quotes landed in a theme by coincidence.</b> Filing is done by word matching, so a protein bar can
              land near drinking. Skim, do not trust blindly.
            </p>
            <p style={{ color: "var(--text-secondary)", marginBottom: 12 }}>
              <b>Not everyone here is a man.</b> The filter was &ldquo;veteran&rdquo;, not &ldquo;male veteran&rdquo;. At least two identified
              themselves as women in their own words: MJ Kirker and Taylor Alonzo. A few others carry traditionally
              female names. Check before using them for a male-veteran angle.
            </p>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>
              <b>This is real people&rsquo;s private disclosure</b> from our own recorded calls. Keep it internal. Do not
              publish anyone&rsquo;s words with their name on them.
            </p>
          </div>

          <h3 className="section-title" style={{ fontSize: 16 }}>Picking up new calls</h3>
          <p style={{ color: "var(--text-secondary)" }}>
            Re-run the sync and this page updates. From the dashboard folder:
          </p>
          <p>
            <code style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 8px", fontSize: 13 }}>
              node scripts/sync-icp-corpus.mjs
            </code>
          </p>
        </div>
      )}
    </div>
  );
}
