"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface AddEntryFormProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd?: () => void;
}

const categories = [
  { value: "ad_creative", label: "Ad Creative" },
  { value: "dm_script", label: "DM Script" },
  { value: "pricing", label: "Pricing" },
  { value: "team", label: "Team" },
  { value: "process", label: "Process" },
  { value: "offer", label: "Offer" },
];

const measurementWindows = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 21, label: "21 days" },
  { value: 30, label: "30 days" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-glass)",
  border: "1px solid var(--border-primary)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "var(--text-muted)",
  fontWeight: 600,
  marginBottom: 6,
};

export default function AddEntryForm({ isOpen, onClose }: AddEntryFormProps) {
  const [category, setCategory] = useState("ad_creative");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricBefore, setMetricBefore] = useState("");
  const [measurementDays, setMeasurementDays] = useState(14);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Phase 2: actual saving logic
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass"
        style={{
          maxWidth: 500,
          width: "100%",
          padding: 32,
          borderRadius: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Log a Change
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* Category */}
          <div>
            <label style={labelStyle}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you change?"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {/* Metric Label */}
          <div>
            <label style={labelStyle}>Metric Label</label>
            <input
              type="text"
              value={metricLabel}
              onChange={(e) => setMetricLabel(e.target.value)}
              placeholder="e.g., Close Rate"
              style={inputStyle}
            />
          </div>

          {/* Metric Before Value */}
          <div>
            <label style={labelStyle}>Metric Before Value</label>
            <input
              type="text"
              value={metricBefore}
              onChange={(e) => setMetricBefore(e.target.value)}
              placeholder="e.g., 29.8%"
              style={inputStyle}
            />
          </div>

          {/* Measurement Window */}
          <div>
            <label style={labelStyle}>Measurement Window</label>
            <select
              value={measurementDays}
              onChange={(e) => setMeasurementDays(Number(e.target.value))}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {measurementWindows.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            style={{
              width: "100%",
              background: "var(--accent)",
              color: "white",
              padding: 12,
              borderRadius: 8,
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              marginTop: 4,
              fontFamily: "inherit",
            }}
          >
            Log Change
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%",
              background: "transparent",
              color: "var(--text-muted)",
              padding: 10,
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
