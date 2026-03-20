'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

/* ─── Types ──────────────────────────────────────────────────────────── */

interface Coach {
  name: string;
  current_clients: number;
  max_clients: number;
}

interface SyncEntry {
  source: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  completed_at: string | null;
  started_at: string;
}

interface BusinessType {
  level: number;
  required_ratio: number;
}

interface Costs {
  coaching_per_client: number;
  software_per_client: number;
  payment_fee_pct: number;
  refund_rate_pct: number;
  chargeback_rate_pct: number;
  nutrition_per_client: number;
  onboarding_per_client: number;
}

interface Targets {
  new_clients_monthly: number;
  close_rate: number;
  show_rate: number;
  book_rate: number;
  churn_rate: number;
}

interface Overhead {
  ghl: number;
  whop: number;
  other_software: number;
  owner_draw: number;
  admin_payroll: number;
  other_fixed: number;
}

interface SheetIds {
  coaching_feedback?: string;
  onboarding?: string;
  sales_tracker?: string;
  setter_stats?: string;
  ads_daily?: string;
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const BUSINESS_TYPES = [
  { label: 'Mostly automated', ratio: 3, level: 1 },
  { label: 'Half automated', ratio: 6, level: 2 },
  { label: 'Mostly people', ratio: 9, level: 3 },
  { label: 'All people', ratio: 12, level: 4 },
] as const;

const SYNC_SOURCES = ['Stripe', 'Whop', 'Mercury', 'Meta', 'GHL', 'Sheets'] as const;

const GOLD = '#c9a96e';
const SURFACE = 'rgba(14,14,18,0.92)';
const BORDER = 'rgba(255,255,255,0.06)';
const INPUT_BG = '#0e0e12';

/* ─── Helpers ────────────────────────────────────────────────────────── */

/** Cents to dollars for display */
function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Dollars string to cents for storage */
function displayToCents(val: string): number {
  return Math.round(parseFloat(val || '0') * 100);
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/* ─── Section wrapper ────────────────────────────────────────────────── */

function Section({
  title,
  children,
  onSave,
  saving,
  saved,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <section
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      className="rounded-xl p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-5">
        <h2
          className="text-xs font-semibold tracking-[0.15em] uppercase"
          style={{ color: 'rgba(242,242,244,0.5)' }}
        >
          {title}
        </h2>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
          style={{
            background: saving ? 'rgba(201,169,110,0.3)' : GOLD,
            color: '#07070a',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
      {children}
    </section>
  );
}

/* ─── Reusable input ─────────────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  type = 'text',
  suffix,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-white/50">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg px-3 py-2 text-sm text-white/90 outline-none focus:ring-1 transition-all"
          style={{
            background: INPUT_BG,
            border: `1px solid ${BORDER}`,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'rgba(201,169,110,0.4)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = BORDER;
          }}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Page Component ─────────────────────────────────────────────────── */

export default function MoziSettingsPage() {
  const [loading, setLoading] = useState(true);

  // --- Data state ---
  const [businessType, setBusinessType] = useState<BusinessType>({ level: 3, required_ratio: 9 });
  const [costs, setCosts] = useState<Costs>({
    coaching_per_client: 21800,
    software_per_client: 2400,
    payment_fee_pct: 2.9,
    refund_rate_pct: 5,
    chargeback_rate_pct: 1,
    nutrition_per_client: 0,
    onboarding_per_client: 0,
  });
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [targets, setTargets] = useState<Targets>({
    new_clients_monthly: 25,
    close_rate: 35,
    show_rate: 75,
    book_rate: 25,
    churn_rate: 6,
  });
  const [overhead, setOverhead] = useState<Overhead>({
    ghl: 29700,
    whop: 0,
    other_software: 5000,
    owner_draw: 0,
    admin_payroll: 0,
    other_fixed: 0,
  });
  const [sheetIds, setSheetIds] = useState<SheetIds>({});
  const [syncLog, setSyncLog] = useState<SyncEntry[]>([]);

  // --- UI state ---
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // --- Load settings ---
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/mozi-settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();

      if (data.business_type) setBusinessType(data.business_type);
      if (data.costs) setCosts((prev) => ({ ...prev, ...data.costs }));
      if (data.coaches) setCoaches(data.coaches);
      if (data.targets) setTargets((prev) => ({ ...prev, ...data.targets }));
      if (data.overhead) setOverhead((prev) => ({ ...prev, ...data.overhead }));
      if (data.sheet_ids) setSheetIds(data.sheet_ids);
    } catch (err) {
      console.error('Failed to load settings:', err);
      showToast('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Load sync log ---
  const loadSyncLog = useCallback(async () => {
    try {
      const res = await fetch('/api/mozi-settings/sync-log');
      if (res.ok) {
        const data = await res.json();
        setSyncLog(data);
      }
    } catch {
      // Sync log endpoint may not exist yet
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadSyncLog();
  }, [loadSettings, loadSyncLog]);

  // --- Save helper ---
  async function saveKey(key: string, value: unknown) {
    setSavingKey(key);
    setSavedKey(null);
    try {
      const res = await fetch('/api/mozi-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSavedKey(key);
      showToast(`${key} saved`);
      setTimeout(() => setSavedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      showToast(`Failed to save ${key}`);
    } finally {
      setSavingKey(null);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // --- Sync Now ---
  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/cron/mozi-sync', {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ''}` },
      });
      const data = await res.json();
      setSyncResult(data.ok ? 'Sync completed successfully' : 'Sync completed with errors');
      loadSyncLog();
    } catch {
      setSyncResult('Sync failed — check console');
    } finally {
      setSyncing(false);
    }
  }

  // --- Coach helpers ---
  function updateCoach(idx: number, field: keyof Coach, value: string) {
    setCoaches((prev) => {
      const next = [...prev];
      if (field === 'name') {
        next[idx] = { ...next[idx], name: value };
      } else {
        next[idx] = { ...next[idx], [field]: parseInt(value || '0', 10) };
      }
      return next;
    });
  }

  function addCoach() {
    setCoaches((prev) => [...prev, { name: '', current_clients: 0, max_clients: 40 }]);
  }

  function removeCoach(idx: number) {
    setCoaches((prev) => prev.filter((_, i) => i !== idx));
  }

  /* ─── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#07070a' }}
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: `${GOLD} transparent ${GOLD} ${GOLD}` }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ color: '#f2f2f4' }}>
      {/* ── Toast ───────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium animate-fade-in"
          style={{ background: GOLD, color: '#07070a' }}
        >
          {toast}
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 py-4 mb-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight text-white/90">
            Mozi <span style={{ color: GOLD }}>Metrics</span>
          </h1>
        </div>
        <Link
          href="/mozi-metrics"
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <span className="text-base">&#8592;</span> Dashboard
        </Link>
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-1 text-white/90">Settings</h1>
        <p className="text-sm text-white/40 mb-8">
          Configure unit economics inputs, coach roster, and data sources.
        </p>

        {/* ── A. Business Type ────────────────────────────────────── */}
        <Section
          title="Business Type"
          onSave={() => saveKey('business_type', businessType)}
          saving={savingKey === 'business_type'}
          saved={savedKey === 'business_type'}
        >
          <p className="text-sm text-white/40 mb-4">
            How labor-intensive is your fulfillment? This determines the required revenue-to-cost ratio.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUSINESS_TYPES.map((bt) => {
              const active = businessType.level === bt.level;
              return (
                <button
                  key={bt.level}
                  onClick={() =>
                    setBusinessType({ level: bt.level, required_ratio: bt.ratio })
                  }
                  className="rounded-lg px-3 py-3 text-center transition-all duration-150"
                  style={{
                    background: active ? 'rgba(201,169,110,0.12)' : INPUT_BG,
                    border: `1px solid ${active ? 'rgba(201,169,110,0.5)' : BORDER}`,
                  }}
                >
                  <div
                    className="text-sm font-medium mb-0.5"
                    style={{ color: active ? GOLD : 'rgba(242,242,244,0.7)' }}
                  >
                    {bt.label}
                  </div>
                  <div className="text-xs text-white/30">{bt.ratio}:1 ratio</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── B. Costs ────────────────────────────────────────────── */}
        <Section
          title="Variable Costs"
          onSave={() => saveKey('costs', costs)}
          saving={savingKey === 'costs'}
          saved={savedKey === 'costs'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Coach pay / client / month"
              value={centsToDisplay(costs.coaching_per_client)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, coaching_per_client: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
            <Field
              label="Software cost / client / month"
              value={centsToDisplay(costs.software_per_client)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, software_per_client: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
            <Field
              label="Payment processor fee"
              value={String(costs.payment_fee_pct)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, payment_fee_pct: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Average refund rate"
              value={String(costs.refund_rate_pct)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, refund_rate_pct: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Average chargeback rate"
              value={String(costs.chargeback_rate_pct)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, chargeback_rate_pct: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Nutrition / client / month"
              value={centsToDisplay(costs.nutrition_per_client)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, nutrition_per_client: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
            <Field
              label="Onboarding / client (one-time)"
              value={centsToDisplay(costs.onboarding_per_client)}
              onChange={(v) =>
                setCosts((p) => ({ ...p, onboarding_per_client: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
          </div>
        </Section>

        {/* ── C. Coach Roster ─────────────────────────────────────── */}
        <Section
          title="Coach Roster"
          onSave={() => saveKey('coaches', coaches)}
          saving={savingKey === 'coaches'}
          saved={savedKey === 'coaches'}
        >
          {coaches.length === 0 ? (
            <p className="text-sm text-white/30 mb-4">No coaches added yet.</p>
          ) : (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-white/40 border-b" style={{ borderColor: BORDER }}>
                    <th className="pb-2 pr-3 font-medium">Name</th>
                    <th className="pb-2 pr-3 font-medium">Current Clients</th>
                    <th className="pb-2 pr-3 font-medium">Max Clients</th>
                    <th className="pb-2 font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {coaches.map((coach, idx) => (
                    <tr key={idx} className="border-b" style={{ borderColor: BORDER }}>
                      <td className="py-2 pr-3">
                        <input
                          value={coach.name}
                          onChange={(e) => updateCoach(idx, 'name', e.target.value)}
                          className="w-full rounded px-2 py-1.5 text-sm text-white/90 outline-none focus:ring-1"
                          style={{
                            background: INPUT_BG,
                            border: `1px solid ${BORDER}`,
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(201,169,110,0.4)';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = BORDER;
                          }}
                          placeholder="Coach name"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={coach.current_clients}
                          onChange={(e) => updateCoach(idx, 'current_clients', e.target.value)}
                          className="w-24 rounded px-2 py-1.5 text-sm text-white/90 outline-none focus:ring-1"
                          style={{
                            background: INPUT_BG,
                            border: `1px solid ${BORDER}`,
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(201,169,110,0.4)';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = BORDER;
                          }}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          value={coach.max_clients}
                          onChange={(e) => updateCoach(idx, 'max_clients', e.target.value)}
                          className="w-24 rounded px-2 py-1.5 text-sm text-white/90 outline-none focus:ring-1"
                          style={{
                            background: INPUT_BG,
                            border: `1px solid ${BORDER}`,
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(201,169,110,0.4)';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = BORDER;
                          }}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => removeCoach(idx)}
                          className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            onClick={addCoach}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:brightness-110"
            style={{
              background: 'rgba(201,169,110,0.1)',
              color: GOLD,
              border: `1px solid rgba(201,169,110,0.2)`,
            }}
          >
            + Add Coach
          </button>
        </Section>

        {/* ── D. Growth Targets ───────────────────────────────────── */}
        <Section
          title="Growth Targets"
          onSave={() => saveKey('targets', targets)}
          saving={savingKey === 'targets'}
          saved={savedKey === 'targets'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="New clients / month target"
              value={String(targets.new_clients_monthly)}
              onChange={(v) =>
                setTargets((p) => ({ ...p, new_clients_monthly: parseInt(v || '0', 10) }))
              }
              type="number"
            />
            <Field
              label="Close rate target"
              value={String(targets.close_rate)}
              onChange={(v) =>
                setTargets((p) => ({ ...p, close_rate: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Show rate target"
              value={String(targets.show_rate)}
              onChange={(v) =>
                setTargets((p) => ({ ...p, show_rate: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Book rate target"
              value={String(targets.book_rate)}
              onChange={(v) =>
                setTargets((p) => ({ ...p, book_rate: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
            <Field
              label="Monthly churn rate"
              value={String(targets.churn_rate)}
              onChange={(v) =>
                setTargets((p) => ({ ...p, churn_rate: parseFloat(v || '0') }))
              }
              type="number"
              suffix="%"
            />
          </div>
        </Section>

        {/* ── E. Overhead Costs ───────────────────────────────────── */}
        <Section
          title="Overhead / Fixed Costs"
          onSave={() => saveKey('overhead', overhead)}
          saving={savingKey === 'overhead'}
          saved={savedKey === 'overhead'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="GHL / CRM monthly"
              value={centsToDisplay(overhead.ghl)}
              onChange={(v) => setOverhead((p) => ({ ...p, ghl: displayToCents(v) }))}
              type="number"
              suffix="$"
            />
            <Field
              label="Whop monthly"
              value={centsToDisplay(overhead.whop)}
              onChange={(v) => setOverhead((p) => ({ ...p, whop: displayToCents(v) }))}
              type="number"
              suffix="$"
            />
            <Field
              label="Other software"
              value={centsToDisplay(overhead.other_software)}
              onChange={(v) =>
                setOverhead((p) => ({ ...p, other_software: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
            <Field
              label="Owner draw"
              value={centsToDisplay(overhead.owner_draw)}
              onChange={(v) => setOverhead((p) => ({ ...p, owner_draw: displayToCents(v) }))}
              type="number"
              suffix="$"
            />
            <Field
              label="Admin / VA payroll"
              value={centsToDisplay(overhead.admin_payroll)}
              onChange={(v) =>
                setOverhead((p) => ({ ...p, admin_payroll: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
            <Field
              label="Other fixed costs"
              value={centsToDisplay(overhead.other_fixed)}
              onChange={(v) =>
                setOverhead((p) => ({ ...p, other_fixed: displayToCents(v) }))
              }
              type="number"
              suffix="$"
            />
          </div>
        </Section>

        {/* ── F. Google Sheet IDs ─────────────────────────────────── */}
        <Section
          title="Google Sheet IDs"
          onSave={() => saveKey('sheet_ids', sheetIds)}
          saving={savingKey === 'sheet_ids'}
          saved={savedKey === 'sheet_ids'}
        >
          <p className="text-sm text-white/30 mb-4">
            Paste the Google Sheet ID (from the URL) for each data source.
          </p>
          <div className="grid grid-cols-1 gap-4">
            <Field
              label="Coaching Feedback"
              value={sheetIds.coaching_feedback || ''}
              onChange={(v) => setSheetIds((p) => ({ ...p, coaching_feedback: v }))}
              placeholder="1abc...xyz"
            />
            <Field
              label="Onboarding"
              value={sheetIds.onboarding || ''}
              onChange={(v) => setSheetIds((p) => ({ ...p, onboarding: v }))}
              placeholder="1abc...xyz"
            />
            <Field
              label="Sales Tracker"
              value={sheetIds.sales_tracker || ''}
              onChange={(v) => setSheetIds((p) => ({ ...p, sales_tracker: v }))}
              placeholder="1abc...xyz"
            />
            <Field
              label="Setter Stats"
              value={sheetIds.setter_stats || ''}
              onChange={(v) => setSheetIds((p) => ({ ...p, setter_stats: v }))}
              placeholder="1abc...xyz"
            />
            <Field
              label="Ads Daily"
              value={sheetIds.ads_daily || ''}
              onChange={(v) => setSheetIds((p) => ({ ...p, ads_daily: v }))}
              placeholder="1abc...xyz"
            />
          </div>
        </Section>

        {/* ── G. Sync Status ──────────────────────────────────────── */}
        <section
          style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
          className="rounded-xl p-6 mb-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h2
              className="text-xs font-semibold tracking-[0.15em] uppercase"
              style={{ color: 'rgba(242,242,244,0.5)' }}
            >
              Sync Status
            </h2>
            <button
              onClick={triggerSync}
              disabled={syncing}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 flex items-center gap-2"
              style={{
                background: syncing ? 'rgba(201,169,110,0.3)' : GOLD,
                color: '#07070a',
                opacity: syncing ? 0.7 : 1,
              }}
            >
              {syncing && (
                <div
                  className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: '#07070a transparent #07070a #07070a' }}
                />
              )}
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {syncResult && (
            <div
              className="mb-4 px-3 py-2 rounded-lg text-xs"
              style={{
                background: syncResult.includes('success')
                  ? 'rgba(34,197,94,0.1)'
                  : 'rgba(239,68,68,0.1)',
                color: syncResult.includes('success')
                  ? 'rgb(34,197,94)'
                  : 'rgb(239,68,68)',
                border: `1px solid ${
                  syncResult.includes('success')
                    ? 'rgba(34,197,94,0.2)'
                    : 'rgba(239,68,68,0.2)'
                }`,
              }}
            >
              {syncResult}
            </div>
          )}

          <div className="space-y-2">
            {SYNC_SOURCES.map((source) => {
              const entry = syncLog.find(
                (e) => e.source.toLowerCase() === source.toLowerCase()
              );
              return (
                <div
                  key={source}
                  className="flex items-center justify-between py-2 px-3 rounded-lg"
                  style={{ background: INPUT_BG }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{
                        background: entry
                          ? entry.status === 'success'
                            ? '#22c55e'
                            : '#ef4444'
                          : 'rgba(255,255,255,0.15)',
                      }}
                    />
                    <span className="text-sm text-white/70">{source}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {entry && (
                      <span className="text-xs text-white/30">
                        {entry.records_synced} records
                      </span>
                    )}
                    <span className="text-xs text-white/40">
                      {entry ? formatTimestamp(entry.completed_at || entry.started_at) : 'Never synced'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Bottom spacer ───────────────────────────────────────── */}
        <div className="h-16" />
      </main>
    </div>
  );
}
