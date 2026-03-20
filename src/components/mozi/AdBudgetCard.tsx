import type { Status } from '@/lib/mozi-engine';

interface AdBudgetCardProps {
  status: Status;
  headroom: number;
  currentAdSpend: number;
  safeBudget: number;
}

function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

export function AdBudgetCard({ status, headroom, currentAdSpend, safeBudget }: AdBudgetCardProps) {
  const isBuy = status === 'buy';
  const fillPct = safeBudget > 0 ? Math.min(Math.round((currentAdSpend / safeBudget) * 100), 100) : 0;
  const accentColor = isBuy ? 'var(--green)' : 'var(--red)';

  return (
    <div
      className="relative overflow-hidden mb-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '20px 22px',
      }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 2, background: accentColor }}
      />

      <div
        className="uppercase font-bold"
        style={{
          fontSize: 10,
          letterSpacing: 1.5,
          color: 'var(--text-3)',
          marginBottom: 8,
        }}
      >
        Ad Budget Headroom
      </div>

      <div
        className="font-black leading-none"
        style={{
          fontSize: 32,
          letterSpacing: -1,
          color: accentColor,
        }}
      >
        {isBuy ? fmt(headroom) : '$0'}
      </div>

      <div
        className="font-semibold"
        style={{
          fontSize: 12,
          color: 'var(--text-3)',
          marginTop: 3,
        }}
      >
        {isBuy ? 'more you can spend this month' : 'do not increase spend'}
      </div>

      {/* Progress bar */}
      <div
        className="mt-3 overflow-hidden"
        style={{
          height: 8,
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 100,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: accentColor,
            borderRadius: 100,
            transition: 'width 0.4s',
          }}
        />
      </div>

      {/* Labels */}
      <div
        className="flex justify-between mt-1"
        style={{ fontSize: 10, color: 'var(--text-3)' }}
      >
        <span>Now: {fmt(currentAdSpend)}</span>
        <span>Safe: {fmt(safeBudget)}</span>
      </div>
    </div>
  );
}
