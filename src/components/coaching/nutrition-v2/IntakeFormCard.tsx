/**
 * Coach UI v2 — intake-form summary card.
 *
 * Mirrors the v1 IntakeFormDetail layout exactly (2-column grid, copy-to-
 * clipboard per field) so coaches see the same intake context they had
 * before the v2 panel swap. Rendered at the top of every state — gives
 * the coach the client's parsed intake snapshot regardless of whether
 * a plan exists yet.
 *
 * Filters out empty fields. Read-only.
 */

"use client";

import React, { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { NutritionIntakeForm } from "@/lib/types";

interface IntakeFormCardProps {
  form: NutritionIntakeForm | undefined;
  /** Default-collapsed for compactness; coach expands when needed. */
  defaultExpanded?: boolean;
}

export function IntakeFormCard({ form, defaultExpanded = true }: IntakeFormCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!form) return null;

  const fields: Array<{ label: string; value: string | number | null | undefined }> = [
    { label: "Name", value: `${form.firstName} ${form.lastName}` },
    { label: "Email", value: form.email },
    { label: "Phone", value: form.phone },
    {
      label: "Address",
      value: [form.address, form.city, form.state, form.zipCode].filter(Boolean).join(", "),
    },
    { label: "Age", value: form.age ? String(form.age) : "" },
    { label: "Height", value: form.height },
    { label: "Current Weight", value: form.currentWeight },
    { label: "Goal Weight", value: form.goalWeight },
    { label: "Fitness Goal", value: form.fitnessGoal },
    { label: "Foods Enjoyed", value: form.foodsEnjoy },
    { label: "Foods to Avoid", value: form.foodsAvoid },
    { label: "Allergies / Medical", value: form.allergies },
    { label: "Protein Preferences", value: form.proteinPreferences },
    { label: "Can Cook/Meal Prep", value: form.canCook },
    { label: "Preferred Meal Count", value: form.mealCount },
    { label: "Medications", value: form.medications },
    { label: "Supplements", value: form.supplements },
    { label: "Sleep Hours", value: form.sleepHours },
    { label: "Water Intake", value: form.waterIntake },
    { label: "Daily Meals Description", value: form.dailyMealsDescription },
    { label: "Daily Meals (cont.)", value: form.dailyMealsDescription2 },
  ].filter((f) => f.value != null && String(f.value).trim().length > 0);

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "var(--text-primary)",
          cursor: "pointer",
          padding: 0,
          fontSize: 13,
          fontWeight: 600,
          width: "100%",
          textAlign: "left",
          marginBottom: expanded ? 10 : 0,
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>Intake form</span>
        <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 400 }}>
          ({fields.length} field{fields.length === 1 ? "" : "s"})
        </span>
      </button>

      {expanded && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            fontSize: 13,
          }}
        >
          {fields.map((f) => (
            <div
              key={f.label}
              style={{
                padding: "6px 10px",
                background: "rgba(255,255,255,0.04)",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 11,
                  marginBottom: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {f.label} <CopyButton text={String(f.value)} />
              </div>
              <div
                style={{
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Local copy-to-clipboard button (mirrors v1's CopyButton — kept inline so
// the v2 module doesn't import from sales-team code).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy"
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: copied ? "var(--success, #22c55e)" : "var(--text-muted)",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}
