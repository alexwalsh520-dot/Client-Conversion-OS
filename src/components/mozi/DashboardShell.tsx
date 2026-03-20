'use client';

import { useState } from 'react';
import type { Status, EngineResult } from '@/lib/mozi-engine';
import { BigAnswer } from './BigAnswer';
import { NumberTile } from './NumberTile';
import { Gate } from './Gate';
import { AdBudgetCard } from './AdBudgetCard';
import { TodoList } from './TodoList';
import { CashStrip } from './CashStrip';
import { InfluencerTable } from './InfluencerTable';
import { SalesGauges } from './SalesGauges';
import { CoachBars } from './CoachBars';
import { SparklineChart } from './SparklineChart';

type DashboardData = EngineResult & { byInfluencer: Record<string, any> };

function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

export function DashboardShell({ data }: { data: DashboardData }) {
  const [showDetails, setShowDetails] = useState(false);

  const {
    status, ratio, payback30, gp30, cac, ltgp,
    capacityPct, runwayMonths, requiredRatio,
    safeBudget, headroom, currentAdSpend,
    cashOnHand, monthlyBurn, byInfluencer,
  } = data;

  // Gate verdicts
  const g1Pass = ratio >= requiredRatio;
  const g2Pass = payback30 >= 0;
  const g3Pct = capacityPct;
  const g3Pass = g3Pct < 90;
  const g3Warn = g3Pct >= 80 && g3Pct < 90;

  // Capacity display — show percentage only (coach roster drives real numbers)
  const capacityLabel = `${capacityPct}%`;

  return (
    <div className="max-w-[720px] mx-auto px-6 pb-20" style={{ paddingTop: 24 }}>
      {/* Top bar */}
      <div
        className="flex justify-between items-center pb-4 mb-6"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="font-bold" style={{ fontSize: 17, letterSpacing: -0.3 }}>
          Mozi <span style={{ color: 'var(--gold)' }}>Metrics</span>
        </div>
        <div className="flex gap-1.5">
          <a
            href="/mozi-metrics/settings"
            className="cursor-pointer transition-all duration-150"
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-3)',
              border: '1px solid var(--border)',
              background: 'transparent',
              textDecoration: 'none',
            }}
          >
            Setup
          </a>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="cursor-pointer transition-all duration-150"
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              color: showDetails ? 'var(--gold)' : 'var(--text-3)',
              border: showDetails
                ? '1px solid rgba(201,169,110,0.3)'
                : '1px solid var(--border)',
              background: showDetails ? 'var(--gold-bg)' : 'transparent',
            }}
          >
            Details
          </button>
        </div>
      </div>

      {/* THE ANSWER */}
      <BigAnswer
        status={status}
        ratio={ratio}
        requiredRatio={requiredRatio}
        headroom={headroom}
        capacityPct={capacityPct}
        ltgp={ltgp}
        cac={cac}
      />

      {/* 4 Number tiles */}
      <div className="grid grid-cols-4 gap-2.5 mb-4 max-sm:grid-cols-2">
        <NumberTile
          label="30-Day GP"
          value={fmt(gp30)}
          sub="per client"
          color="var(--green)"
          tooltip={`Revenue per client minus direct costs (coaching, software, fees)`}
        />
        <NumberTile
          label="CAC"
          value={fmt(cac)}
          sub="cost to acquire"
          tooltip={`Ad spend (${fmt(currentAdSpend)}) / paying clients`}
        />
        <NumberTile
          label="LTGP"
          value={fmt(ltgp)}
          sub="lifetime profit"
          color="var(--gold)"
          tooltip={`GP per month × avg client lifespan`}
        />
        <NumberTile
          label="Capacity"
          value={capacityLabel}
          sub="coach slots filled"
        />
      </div>

      {/* Reconciliation check */}
      <div
        className="text-center font-semibold mb-4"
        style={{ fontSize: 10, color: 'var(--green)' }}
      >
        &#10003; {fmt(ltgp)} &divide; {fmt(cac)} = {ratio.toFixed(1)}x
      </div>

      {/* 3 Gates */}
      <div className="grid grid-cols-3 gap-2.5 mb-4 max-sm:grid-cols-1">
        <Gate
          gateNum={1}
          rule="Fix model before ads"
          value={`${ratio.toFixed(1)}x`}
          versus={`need ${requiredRatio}x`}
          verdict={g1Pass ? 'pass' : 'fail'}
          verdictLabel={g1Pass ? 'Pass' : 'Fail'}
        />
        <Gate
          gateNum={2}
          rule="30-day payback >= $0"
          value={`${payback30 >= 0 ? '+' : '-'}${fmt(payback30)}`}
          versus={`GP ${fmt(gp30)} - CAC ${fmt(cac)}`}
          verdict={g2Pass ? 'pass' : 'fail'}
          verdictLabel={g2Pass ? 'Pass' : 'Fail'}
        />
        <Gate
          gateNum={3}
          rule="Coaches have room"
          value={`${capacityPct}%`}
          versus={`${capacityPct}% of coach slots`}
          verdict={g3Pass ? (g3Warn ? 'warn' : 'pass') : 'fail'}
          verdictLabel={g3Pass ? (g3Warn ? 'Getting Full' : 'Pass') : 'Full'}
        />
      </div>

      {/* Ad Budget Card */}
      <AdBudgetCard
        status={status}
        headroom={headroom}
        currentAdSpend={currentAdSpend}
        safeBudget={safeBudget}
      />

      {/* Do This Today */}
      <TodoList
        status={status}
        capacityPct={capacityPct}
        ratio={ratio}
        requiredRatio={requiredRatio}
      />

      {/* DETAILS SECTION */}
      {showDetails && (
        <div>
          {/* Cash Safety divider */}
          <Divider label="Cash Safety" />
          <CashStrip
            cashOnHand={cashOnHand}
            monthlyBurn={monthlyBurn}
            runwayMonths={runwayMonths}
            currentAdSpend={currentAdSpend}
            gp30={gp30}
          />

          {/* Influencer P&L */}
          <Divider label="Influencer P&L (50/50 Split)" />
          <InfluencerTable byInfluencer={byInfluencer} />

          {/* Funnel */}
          <Divider label="Funnel" />
          <FunnelRow />

          {/* Team */}
          <Divider label="Team" />
          <div className="grid grid-cols-2 gap-2.5 mb-4 max-sm:grid-cols-1">
            <SalesGauges />
            <CoachBars />
          </div>

          {/* Trends */}
          <Divider label="Trends" />
          <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
            <SparklineChart
              title="CAC & LTGP"
              data={[680, 720, 690, 650, 640, 610, 590, 614, 600, 580, 560, 540]}
              color="var(--gold)"
            />
            <SparklineChart
              title="LTGP:CAC Ratio"
              data={[5.1, 5.3, 5.8, 6.2, 6.5, 6.8, 7.1, 7.4, 7.6, 7.8, 7.9, 8.0]}
              color="var(--green)"
            />
            <SparklineChart
              title="Churn %"
              data={[9.2, 8.8, 9.0, 8.5, 8.1, 8.4, 8.0, 7.8, 8.0, 8.5, 8.0, 8.2]}
              color="var(--amber)"
            />
            <SparklineChart
              title="Close Rate"
              data={[22, 24, 23, 26, 25, 27, 28, 29, 27, 28, 30, 28]}
              color="#6ea8c9"
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        className="text-center pt-5"
        style={{ fontSize: 9, color: 'var(--text-3)' }}
      >
        Mozi Metrics v6 — 4 Numbers, 3 Rules
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 uppercase font-semibold"
      style={{
        margin: '28px 0 16px',
        color: 'var(--text-3)',
        fontSize: 10,
        letterSpacing: 1.5,
      }}
    >
      <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
      {label}
      <div className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function FunnelRow() {
  const steps = [
    { value: '842K', label: 'Impressions', conv: '1.5%', bg: 'rgba(110,168,201,0.15)', color: '#6ea8c9' },
    { value: '12.5K', label: 'Clicks', conv: '10%', bg: 'rgba(110,168,201,0.18)', color: '#6ea8c9' },
    { value: '1,247', label: 'DMs', conv: '33%', bg: 'rgba(110,168,201,0.22)', color: '#6ea8c9' },
    { value: '412', label: 'Qualified', conv: '21%', bg: 'rgba(201,169,110,0.18)', color: 'var(--gold)' },
    { value: '87', label: 'Calls', conv: '26%', bg: 'rgba(95,219,142,0.15)', color: 'var(--green)' },
    { value: '23', label: 'Sales', conv: undefined, bg: 'rgba(95,219,142,0.25)', color: 'var(--green)' },
  ];

  return (
    <div className="flex gap-1.5 mb-4 max-sm:flex-col">
      {steps.map((step) => (
        <div key={step.label} className="flex-1 text-center">
          <div
            className="flex items-center justify-center font-extrabold"
            style={{
              height: 32,
              borderRadius: 5,
              fontSize: 11,
              background: step.bg,
              color: step.color,
            }}
          >
            {step.value}
          </div>
          <div
            className="uppercase font-semibold mt-0.5"
            style={{ fontSize: 8, letterSpacing: 0.5, color: 'var(--text-3)' }}
          >
            {step.label}
          </div>
          {step.conv && (
            <div className="font-bold" style={{ fontSize: 8, color: 'var(--gold)', marginTop: 1 }}>
              {step.conv}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default DashboardShell;
