'use client';

import { useState } from 'react';
import type { Status } from '@/lib/mozi-engine';
import { WhyStopPanel } from './WhyStopPanel';

interface BigAnswerProps {
  status: Status;
  ratio: number;
  requiredRatio: number;
  headroom: number;
  capacityPct: number;
  ltgp: number;
  cac: number;
}

function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

const STATUS_CONFIG: Record<string, { barColor: string; wordColor: string; word: string }> = {
  buy: { barColor: 'var(--green)', wordColor: 'var(--green)', word: 'BUY MORE' },
  'hold-payback': { barColor: 'var(--amber)', wordColor: 'var(--amber)', word: 'HOLD' },
  'hold-cash': { barColor: 'var(--amber)', wordColor: 'var(--amber)', word: 'HOLD' },
  'hold-capacity': { barColor: 'var(--amber)', wordColor: 'var(--amber)', word: 'HOLD' },
  stop: { barColor: 'var(--red)', wordColor: 'var(--red)', word: 'STOP' },
};

function getWhyText(status: Status, ratio: number, requiredRatio: number, headroom: number, capacityPct: number): React.ReactNode {
  switch (status) {
    case 'stop':
      return <>Profit ratio is <b style={{ color: 'var(--text)', fontWeight: 700 }}>{ratio.toFixed(1)}x</b> but you need <b style={{ color: 'var(--text)', fontWeight: 700 }}>{requiredRatio}x</b>. Fix the model before spending on ads.</>;
    case 'hold-payback':
      return <>New clients <b style={{ color: 'var(--text)', fontWeight: 700 }}>lose money in the first 30 days</b>. Add a fast-cash offer or raise prices first.</>;
    case 'hold-cash':
      return <>Model works but <b style={{ color: 'var(--text)', fontWeight: 700 }}>cash is too low</b>. Less than 2 months runway. Protect cash first.</>;
    case 'hold-capacity':
      return <>Numbers are strong but <b style={{ color: 'var(--text)', fontWeight: 700 }}>coaches are {capacityPct}% full</b>. Hire before adding clients.</>;
    case 'buy':
      return <>Clients pay for themselves in 30 days. You can safely spend <b style={{ color: 'var(--text)', fontWeight: 700 }}>{fmt(headroom)} more</b> on ads.</>;
    default:
      return <></>;
  }
}

export function BigAnswer({ status, ratio, requiredRatio, headroom, capacityPct, ltgp, cac }: BigAnswerProps) {
  const [showWhyPanel, setShowWhyPanel] = useState(false);
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.buy;

  return (
    <div
      className="text-center relative overflow-hidden mb-4"
      style={{
        padding: '40px 32px 36px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
      }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 3, background: config.barColor }}
      />

      <div
        className="uppercase font-semibold tracking-widest mb-3"
        style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: 2 }}
      >
        Can You Spend More on Ads?
      </div>

      <div
        className="font-black leading-none"
        style={{
          fontSize: 64,
          letterSpacing: -2,
          color: config.wordColor,
        }}
      >
        {config.word}
      </div>

      <div
        className="mx-auto mt-3"
        style={{
          fontSize: 16,
          color: 'var(--text-2)',
          maxWidth: 560,
          lineHeight: 1.6,
        }}
      >
        {getWhyText(status, ratio, requiredRatio, headroom, capacityPct)}
      </div>

      {status === 'stop' && (
        <button
          onClick={() => setShowWhyPanel(!showWhyPanel)}
          className="mt-3 cursor-pointer"
          style={{
            background: 'none',
            border: '1px solid var(--red-b)',
            color: 'var(--red)',
            padding: '5px 14px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Why? Show me the gap
        </button>
      )}

      {status === 'stop' && showWhyPanel && (
        <WhyStopPanel
          ltgp={ltgp}
          cac={cac}
          ratio={ratio}
          requiredRatio={requiredRatio}
        />
      )}
    </div>
  );
}
