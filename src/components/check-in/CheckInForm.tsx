"use client";

/**
 * Public bi-weekly check-in form.
 *
 * Flow:
 *   1. Client types ≥ 2 chars → typeahead fetches /api/check-in/clients
 *   2. Client picks themselves from the dropdown
 *   3. Answers Q1 (0-10), Q2-Q4 (1-10) via linear-scale sliders, all
 *      required. Q5 paragraph is optional.
 *   4. Submits → POST /api/check-in/submit. On success, swap to a
 *      confirmation panel.
 *
 * Slider UX choice: a value badge under the label + the native range
 * input. Real users on phones tap-drag fine; desktop users get keyboard
 * arrows for free.
 *
 * Honeypot: hidden <input name="website">. Real users never touch it.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle, ChevronDown, Loader2, Search } from "lucide-react";
import type { CheckInClientOption } from "@/lib/check-in/types";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 200;

interface Answers {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  q5: string;
}

const INITIAL_ANSWERS: Answers = {
  q1: 5,
  q2: 5,
  q3: 5,
  q4: 5,
  q5: "",
};

export default function CheckInForm() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CheckInClientOption | null>(null);
  const [options, setOptions] = useState<CheckInClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Track whether each slider has been touched. We initialize values to
  // 5 for sane defaults, but require an explicit interaction to ensure
  // the client made a deliberate choice (not just submitted the defaults).
  const [touched, setTouched] = useState<{ q1: boolean; q2: boolean; q3: boolean; q4: boolean }>({
    q1: false,
    q2: false,
    q3: false,
    q4: false,
  });
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
  const [website, setWebsite] = useState(""); // honeypot

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Debounced typeahead fetch
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (selected && selected.name === search) return; // don't re-search after a pick
    if (search.trim().length < MIN_QUERY_LENGTH) {
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/check-in/clients?q=${encodeURIComponent(search.trim())}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) {
          setOptions([]);
          return;
        }
        const data = (await res.json()) as { clients: CheckInClientOption[] };
        setOptions(data.clients ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setOptions([]);
        }
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, selected]);

  const handlePick = (opt: CheckInClientOption) => {
    setSelected(opt);
    setSearch(opt.name);
    setOptions([]);
    setDropdownOpen(false);
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setSelected(null); // typing clears the prior selection
    setDropdownOpen(true);
  };

  const setQ = (key: "q1" | "q2" | "q3" | "q4", value: number) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setTouched((t) => ({ ...t, [key]: true }));
  };

  const allRequiredAnswered =
    !!selected && touched.q1 && touched.q2 && touched.q3 && touched.q4;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!selected) {
      setError("Please select your name from the dropdown.");
      return;
    }
    if (!touched.q1 || !touched.q2 || !touched.q3 || !touched.q4) {
      setError("Please answer all four sliders before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/check-in/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selected.id,
          q1: answers.q1,
          q2: answers.q2,
          q3: answers.q3,
          q4: answers.q4,
          q5: answers.q5.trim() || undefined,
          website, // honeypot, should be ""
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        setError(data.error || "Submission failed. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div
        className="glass-static"
        style={{
          padding: 32,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "rgba(126, 201, 160, 0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CheckCircle size={28} style={{ color: "var(--success)" }} />
        </div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          Got it — thanks!
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 360,
            lineHeight: 1.6,
          }}
        >
          Your check-in has been recorded. Your coach will see it shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-static"
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 22 }}
    >
      {/* Honeypot — visually hidden, off-screen, never autofocused */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />

      {/* Client picker */}
      <div style={{ position: "relative" }}>
        <label
          className="field-label"
          style={{ display: "block", marginBottom: 8 }}
        >
          Your name *
        </label>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="Start typing your name or email…"
            className="input-field"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setDropdownOpen(true)}
            style={{ paddingLeft: 32, paddingRight: 32 }}
            autoComplete="off"
          />
          {searching && (
            <Loader2
              size={14}
              className="spin"
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
          {!searching && search && (
            <ChevronDown
              size={14}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
          )}
        </div>
        {dropdownOpen &&
          search.trim().length >= MIN_QUERY_LENGTH &&
          !selected && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: 6,
                background: "var(--bg-card)",
                border: "1px solid var(--border-primary)",
                borderRadius: 8,
                maxHeight: 240,
                overflowY: "auto",
                zIndex: 30,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              {searching && (
                <div
                  style={{ padding: 12, fontSize: 13, color: "var(--text-muted)" }}
                >
                  Searching…
                </div>
              )}
              {!searching && options.length === 0 && (
                <div
                  style={{ padding: 12, fontSize: 13, color: "var(--text-muted)" }}
                >
                  No matches. Check spelling or ask your coach.
                </div>
              )}
              {!searching &&
                options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handlePick(opt)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-primary)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                    onMouseDown={(e) => e.preventDefault()} // keep focus on input
                  >
                    <div style={{ fontWeight: 600 }}>{opt.name}</div>
                    {opt.email && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {opt.email}
                      </div>
                    )}
                  </button>
                ))}
            </div>
          )}
      </div>

      {/* Q1 — Coaching overall, 0-10 */}
      <SliderQuestion
        label="How has your coaching been in the past 2 weeks? *"
        labelMin="0 — Pretty bad"
        labelMax="10 — Phenomenal"
        min={0}
        max={10}
        value={answers.q1}
        touched={touched.q1}
        onChange={(v) => setQ("q1", v)}
      />

      {/* Q2 — Strength */}
      <SliderQuestion
        label="How strong are you feeling right now? *"
        labelMin="1 — Weak / no progress"
        labelMax="10 — Strongest I've been"
        min={1}
        max={10}
        value={answers.q2}
        touched={touched.q2}
        onChange={(v) => setQ("q2", v)}
      />

      {/* Q3 — Adherence */}
      <SliderQuestion
        label="How well did you stick to your program over the last 2 weeks? *"
        labelMin="1 — Barely at all"
        labelMax="10 — Nailed it completely"
        min={1}
        max={10}
        value={answers.q3}
        touched={touched.q3}
        onChange={(v) => setQ("q3", v)}
      />

      {/* Q4 — Progress */}
      <SliderQuestion
        label="How much progress have you made toward your goal in the last 2 weeks? *"
        labelMin="1 — None / went backwards"
        labelMax="10 — Big step forward"
        min={1}
        max={10}
        value={answers.q4}
        touched={touched.q4}
        onChange={(v) => setQ("q4", v)}
      />

      {/* Q5 — Optional paragraph */}
      <div>
        <label
          className="field-label"
          style={{ display: "block", marginBottom: 8 }}
        >
          One thing that went well, and one thing you&apos;re finding hard right now?{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          className="input-field"
          rows={4}
          value={answers.q5}
          onChange={(e) => setAnswers((a) => ({ ...a, q5: e.target.value }))}
          placeholder="Anything you want your coach to know…"
          maxLength={4000}
          style={{ resize: "vertical", minHeight: 90 }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(239,68,68,0.1)",
            color: "var(--danger)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !allRequiredAnswered}
        className="btn-primary"
        style={{
          padding: "12px 20px",
          fontSize: 14,
          fontWeight: 600,
          opacity: submitting || !allRequiredAnswered ? 0.6 : 1,
          cursor: submitting || !allRequiredAnswered ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Submitting…" : "Submit check-in"}
      </button>
    </form>
  );
}

interface SliderProps {
  label: string;
  labelMin: string;
  labelMax: string;
  min: number;
  max: number;
  value: number;
  touched: boolean;
  onChange: (v: number) => void;
}

function SliderQuestion({
  label,
  labelMin,
  labelMax,
  min,
  max,
  value,
  touched,
  onChange,
}: SliderProps) {
  return (
    <div>
      <label
        className="field-label"
        style={{ display: "block", marginBottom: 10 }}
      >
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 8,
        }}
      >
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          style={{
            flex: 1,
            accentColor: "var(--accent)",
            cursor: "pointer",
          }}
        />
        <div
          style={{
            minWidth: 44,
            padding: "4px 10px",
            borderRadius: 6,
            background: touched ? "var(--accent)" : "var(--bg-glass)",
            color: touched ? "var(--bg-primary)" : "var(--text-muted)",
            fontSize: 14,
            fontWeight: 700,
            textAlign: "center",
            transition: "background 0.15s ease, color 0.15s ease",
          }}
        >
          {touched ? value : "—"}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        <span>{labelMin}</span>
        <span>{labelMax}</span>
      </div>
    </div>
  );
}
