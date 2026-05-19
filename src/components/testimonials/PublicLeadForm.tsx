"use client";

/**
 * The lead-capture form rendered below the Senja widget on /testimonials.
 *
 * Posts to /api/testimonials/lead. After submission, swaps to a thank-you
 * confirmation. Includes a hidden honeypot field that bots will fill but
 * real users won't even see.
 */

import { useState } from "react";
import { Send, Check, Loader2 } from "lucide-react";

export default function PublicLeadForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot — must stay empty. Bots fill all fields; humans never see it.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError("Name, email, and phone are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/testimonials/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          message: message.trim() || undefined,
          website, // honeypot
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not save. Please try again.");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="glass-static fade-up"
        style={{
          padding: "32px 24px",
          borderRadius: 12,
          textAlign: "center",
          borderLeft: "2px solid var(--success)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: 12,
            borderRadius: 12,
            background: "var(--success-soft)",
            marginBottom: 12,
          }}
        >
          <Check size={24} style={{ color: "var(--success)" }} />
        </div>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 6px",
          }}
        >
          Thanks, {name.split(" ")[0]}.
        </h3>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
          We will be in touch within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-static"
      style={{ padding: 24, borderRadius: 12, display: "grid", gap: 12 }}
    >
      {/* Honeypot: hidden from real users, bots fill it */}
      <div style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
        <label htmlFor="website-hp">Website</label>
        <input
          id="website-hp"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Field label="Name" required>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          required
          style={{ width: "100%", fontSize: 14 }}
          disabled={submitting}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Email" required>
          <input
            type="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            style={{ width: "100%", fontSize: 14 }}
            disabled={submitting}
          />
        </Field>
        <Field label="Phone" required>
          <input
            type="tel"
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 ..."
            autoComplete="tel"
            required
            style={{ width: "100%", fontSize: 14 }}
            disabled={submitting}
          />
        </Field>
      </div>

      <Field label="Tell us a bit about yourself (optional)">
        <textarea
          className="input-field"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What you're working on, what you're looking for..."
          rows={4}
          maxLength={4000}
          style={{ width: "100%", fontSize: 14, resize: "vertical", minHeight: 80 }}
          disabled={submitting}
        />
      </Field>

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "var(--danger)",
            background: "var(--danger-soft)",
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary"
        disabled={submitting || !name.trim() || !email.trim() || !phone.trim()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: 600,
          opacity: submitting ? 0.6 : 1,
          marginTop: 4,
        }}
      >
        {submitting ? (
          <>
            <Loader2 size={14} className="tm-spin" /> Sending...
          </>
        ) : (
          <>
            <Send size={14} /> Get in touch
          </>
        )}
      </button>

      <style jsx>{`
        :global(.tm-spin) {
          animation: tm-spin-rot 0.8s linear infinite;
        }
        @keyframes tm-spin-rot { to { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label} {required && <span style={{ color: "var(--accent)" }}>*</span>}
      </label>
      {children}
    </div>
  );
}
