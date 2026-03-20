function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

interface WhyStopPanelProps {
  ltgp: number;
  cac: number;
  ratio: number;
  requiredRatio: number;
}

export function WhyStopPanel({ ltgp, cac, ratio, requiredRatio }: WhyStopPanelProps) {
  const need = requiredRatio * cac;
  const gap = need - ltgp;

  return (
    <div className="mt-4 text-left mx-auto" style={{ maxWidth: 520 }}>
      {/* Gap box */}
      <div
        className="mb-3"
        style={{
          background: 'var(--red-bg)',
          border: '1px solid var(--red-b)',
          borderRadius: 'var(--rs)',
          padding: '14px 18px',
        }}
      >
        <GapRow label="Your LTGP:" value={fmt(ltgp)} />
        <GapRow label="Your CAC:" value={fmt(cac)} />
        <GapRow label="Your ratio:" value={`${ratio.toFixed(1)}x`} />
        <GapRow label="Required:" value={`${requiredRatio}x`} />
        <div
          className="flex justify-between pt-2 mt-1"
          style={{
            borderTop: '1px solid var(--red-b)',
            fontSize: 13,
            color: 'var(--red)',
          }}
        >
          <span style={{ color: 'var(--text-3)' }}>Gap per client:</span>
          <span className="font-bold">{fmt(gap)}/client</span>
        </div>
      </div>

      {/* 3 Levers header */}
      <div
        className="uppercase font-bold tracking-wide mb-2"
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: 'var(--text-3)',
        }}
      >
        3 Levers to Fix
      </div>

      <div className="flex flex-col gap-1.5">
        <Lever
          stage="1. Price"
          text="Raise price or restructure payment terms."
          worth={`+${fmt(Math.round(gap * 0.5))}/client`}
        />
        <Lever
          stage="2. Fast Cash"
          text="High-ticket upsell in first 30 days."
          worth={`+${fmt(Math.round(gap * 0.3))}/client`}
        />
        <Lever
          stage="3. Retention"
          text="Reduce churn to increase lifetime value."
          worth={`+${fmt(Math.round(gap * 0.4))}/client`}
        />
      </div>
    </div>
  );
}

function GapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5" style={{ fontSize: 13 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}

function Lever({ stage, text, worth }: { stage: string; text: string; worth: string }) {
  return (
    <div
      className="flex justify-between items-center"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--rs)',
        padding: '12px 16px',
      }}
    >
      <div>
        <div
          className="uppercase font-bold"
          style={{ fontSize: 10, letterSpacing: 0.8, color: 'var(--gold)' }}
        >
          {stage}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{text}</div>
      </div>
      <div
        className="font-bold whitespace-nowrap"
        style={{ fontSize: 11, color: 'var(--green)' }}
      >
        {worth}
      </div>
    </div>
  );
}
