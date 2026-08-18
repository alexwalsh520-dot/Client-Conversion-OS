"use client";

// Alex's ToDos workspace. Design language ported from the "While You Were Out"
// artifact: dark ground, one gold accent, editable-in-place text, per-section
// timers with a beep, instant autosave. Data lives in public.todo_days (one row
// per day, freeform jsonb) so any Claude session can read and extend it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./todos.css";

type TodoItem = {
  id: string;
  text: string;
  status: "open" | "done";
  note?: string;
  /** Ask Jezza AI (the Jeremy advisor MCP) about this task. A Claude session
   * picks up pending questions, consults Jezza with the workspace context doc,
   * and writes the answer back here. */
  jezza?: { q?: string; a?: string; status?: "pending" | "answered" };
};
type TodoSection = {
  id: string;
  title: string;
  timerMins?: number;
  items: TodoItem[];
};
type DayData = { sections: TodoSection[] };
type DayRow = { day: string; title: string | null; notes: string | null; data: DayData };
type DayStub = { day: string; title: string | null };

function uid() {
  return Math.random().toString(36).slice(2, 9);
}
function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function prettyDay(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function SectionTimer({ mins, onMins }: { mins: number; onMins: (m: number) => void }) {
  const [left, setLeft] = useState(mins * 60);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const iv = useRef<ReturnType<typeof setInterval> | null>(null);

  const beep = () => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        o.connect(g);
        g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.35;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.start(t);
        o.stop(t + 0.32);
      }
    } catch {
      /* sound is best-effort */
    }
  };

  useEffect(() => {
    if (!running) return;
    iv.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          setRunning(false);
          setDone(true);
          beep();
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => {
      if (iv.current) clearInterval(iv.current);
    };
  }, [running]);

  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className={"td-timer" + (done ? " done" : "")}>
      <input
        className="td-timer-mins"
        type="number"
        min={1}
        max={120}
        value={mins}
        onChange={(e) => onMins(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
        title="Goal minutes"
      />
      <span className="td-timer-disp">
        {m}:{s < 10 ? "0" : ""}
        {s}
      </span>
      <button
        type="button"
        onClick={() => {
          setDone(false);
          setRunning((r) => !r);
        }}
      >
        {running ? "Pause" : "Start"}
      </button>
      <button
        type="button"
        onClick={() => {
          setRunning(false);
          setDone(false);
          setLeft(mins * 60);
        }}
      >
        Reset
      </button>
    </span>
  );
}

export default function TodosClient() {
  const [days, setDays] = useState<DayStub[]>([]);
  const [day, setDay] = useState<string>(todayEt());
  const [title, setTitle] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [data, setData] = useState<DayData>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedDay = useRef<string | null>(null);

  const refreshDays = useCallback(async () => {
    try {
      const r = await fetch("/api/todos");
      const j = await r.json();
      if (Array.isArray(j.days)) setDays(j.days);
    } catch {
      /* list is cosmetic */
    }
  }, []);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/todos?day=${d}`);
      const j = await r.json();
      const row: DayRow | null = j.row ?? null;
      setTitle(row?.title ?? "");
      setNotes(row?.notes ?? "");
      const dd = row?.data;
      setData(dd && Array.isArray(dd.sections) ? dd : { sections: [] });
      loadedDay.current = d;
    } catch {
      setData({ sections: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDays();
  }, [refreshDays]);
  useEffect(() => {
    loadDay(day);
  }, [day, loadDay]);

  const queueSave = useCallback(
    (t: string, n: string, dd: DayData) => {
      if (loadedDay.current !== day) return;
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const r = await fetch("/api/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ day, title: t, notes: n, data: dd }),
          });
          setSaveState(r.ok ? "saved" : "error");
          if (r.ok) refreshDays();
        } catch {
          setSaveState("error");
        }
      }, 600);
    },
    [day, refreshDays]
  );

  const update = useCallback(
    (fn: (d: DayData) => DayData) => {
      setData((prev) => {
        const next = fn(structuredClone(prev));
        queueSave(title, notes, next);
        return next;
      });
    },
    [queueSave, title, notes]
  );

  const openCount = useMemo(
    () => data.sections.reduce((a, s) => a + s.items.filter((i) => i.status === "open").length, 0),
    [data]
  );
  const doneCount = useMemo(
    () => data.sections.reduce((a, s) => a + s.items.filter((i) => i.status === "done").length, 0),
    [data]
  );

  return (
    <div className="todos-page fade-up">
      <header className="td-head">
        <div>
          <div className="td-kicker">Private · autosaves · any Claude session can plug in</div>
          <h1>ToDos</h1>
        </div>
        <div className="td-daystrip">
          {days.slice(0, 7).map((d) => (
            <button
              key={d.day}
              type="button"
              className={"td-daychip" + (d.day === day ? " on" : "")}
              onClick={() => setDay(d.day)}
              title={d.title ?? ""}
            >
              {prettyDay(d.day)}
            </button>
          ))}
          {!days.some((d) => d.day === todayEt()) && (
            <button type="button" className="td-daychip new" onClick={() => setDay(todayEt())}>
              + Today
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="td-loading">Loading {prettyDay(day)}...</div>
      ) : (
        <>
          <input
            className="td-title"
            placeholder={`Name this day (${prettyDay(day)})`}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              queueSave(e.target.value, notes, data);
            }}
          />

          <div className="td-card">
            <div className="td-bl">Brain dump · meeting notes · anything for Claude</div>
            <textarea
              className="td-notes"
              rows={4}
              placeholder={
                "Type your notes here (morning meeting with Matt, ideas, whatever).\nThen tell any Claude session: \"read today's todos and build my list\" and it takes it from here."
              }
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                queueSave(title, e.target.value, data);
              }}
            />
          </div>

          {data.sections.map((sec, si) => (
            <div className="td-card" key={sec.id}>
              <div className="td-sechead">
                <input
                  className="td-sectitle"
                  value={sec.title}
                  placeholder="Section title"
                  onChange={(e) =>
                    update((d) => {
                      d.sections[si].title = e.target.value;
                      return d;
                    })
                  }
                />
                <SectionTimer
                  key={sec.id + ":" + (sec.timerMins ?? 10)}
                  mins={sec.timerMins ?? 10}
                  onMins={(m) =>
                    update((d) => {
                      d.sections[si].timerMins = m;
                      return d;
                    })
                  }
                />
                <button
                  type="button"
                  className="td-x"
                  title="Delete section"
                  onClick={() => {
                    if (!confirm(`Delete section "${sec.title || "untitled"}"?`)) return;
                    update((d) => {
                      d.sections.splice(si, 1);
                      return d;
                    });
                  }}
                >
                  ✕
                </button>
              </div>

              {sec.items.map((it, ii) => (
                <div className={"td-item" + (it.status === "done" ? " done" : "")} key={it.id}>
                  <button
                    type="button"
                    className="td-check"
                    aria-label={it.status === "done" ? "Mark open" : "Mark done"}
                    onClick={() =>
                      update((d) => {
                        d.sections[si].items[ii].status = it.status === "done" ? "open" : "done";
                        return d;
                      })
                    }
                  >
                    {it.status === "done" ? "✓" : ""}
                  </button>
                  <div className="td-itembody">
                    <input
                      className="td-itemtext"
                      value={it.text}
                      placeholder="What needs to happen?"
                      onChange={(e) =>
                        update((d) => {
                          d.sections[si].items[ii].text = e.target.value;
                          return d;
                        })
                      }
                    />
                    <input
                      className="td-itemnote"
                      value={it.note ?? ""}
                      placeholder="Note (optional)"
                      onChange={(e) =>
                        update((d) => {
                          d.sections[si].items[ii].note = e.target.value;
                          return d;
                        })
                      }
                    />
                    <div className="td-jezza-row">
                      <input
                        className="td-jezzaq"
                        value={it.jezza?.q ?? ""}
                        placeholder="Ask Jezza AI about this task..."
                        onChange={(e) =>
                          update((d) => {
                            const item = d.sections[si].items[ii];
                            const q = e.target.value;
                            item.jezza = q
                              ? { ...(item.jezza ?? {}), q, status: item.jezza?.a ? item.jezza.status : "pending" }
                              : undefined;
                            return d;
                          })
                        }
                      />
                      {it.jezza?.q && !it.jezza?.a && <span className="td-jezza-pending">queued for Jezza</span>}
                    </div>
                    {it.jezza?.a && (
                      <div className="td-jezza-answer">
                        <span className="td-jezza-tag">Jezza AI</span>
                        {it.jezza.a}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="td-x"
                    title="Delete item"
                    onClick={() =>
                      update((d) => {
                        d.sections[si].items.splice(ii, 1);
                        return d;
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="td-add"
                onClick={() =>
                  update((d) => {
                    d.sections[si].items.push({ id: uid(), text: "", status: "open" });
                    return d;
                  })
                }
              >
                + item
              </button>
            </div>
          ))}

          <button
            type="button"
            className="td-addsection"
            onClick={() =>
              update((d) => {
                d.sections.push({
                  id: uid(),
                  title: "",
                  timerMins: 10,
                  items: [{ id: uid(), text: "", status: "open" }],
                });
                return d;
              })
            }
          >
            + New section
          </button>

          <div className="td-statusbar">
            <span>
              {openCount} open · {doneCount} done
            </span>
            <span className={"td-save " + saveState}>
              {saveState === "saving"
                ? "Saving..."
                : saveState === "error"
                  ? "Save failed, retrying on next change"
                  : saveState === "saved"
                    ? "Saved"
                    : "Autosave on"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
