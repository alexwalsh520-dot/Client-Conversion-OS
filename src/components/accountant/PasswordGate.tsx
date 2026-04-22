"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

const STORAGE_KEY = "accountant-unlocked";
const PASSWORD = "money";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") setUnlocked(true);
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!unlocked) {
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim().toLowerCase() === PASSWORD) {
        sessionStorage.setItem(STORAGE_KEY, "1");
        setUnlocked(true);
      } else {
        setError(true);
      }
    };

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "70vh",
          padding: 24,
        }}
      >
        <form
          onSubmit={submit}
          style={{
            width: "100%",
            maxWidth: 360,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            borderRadius: 12,
            padding: 28,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--accent-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <Lock size={18} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                Accountant Locked
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Enter the password to view financial data.
              </div>
            </div>
          </div>

          <input
            autoFocus
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
            placeholder="Password"
            className="form-input"
            style={{ width: "100%" }}
          />

          {error && (
            <div style={{ fontSize: 12, color: "var(--danger, #ef4444)" }}>
              Incorrect password.
            </div>
          )}

          <button type="submit" className="btn-primary" style={{ width: "100%" }}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
