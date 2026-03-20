interface GateProps {
  gateNum: number;
  rule: string;
  value: string;
  versus: string;
  verdict: 'pass' | 'fail' | 'warn';
  verdictLabel: string;
}

const VERDICT_COLORS = {
  pass: { bar: 'var(--green)', text: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-b)' },
  fail: { bar: 'var(--red)', text: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red-b)' },
  warn: { bar: 'var(--amber)', text: 'var(--amber)', bg: 'var(--amber-bg)', border: 'var(--amber-b)' },
};

export function Gate({ gateNum, rule, value, versus, verdict, verdictLabel }: GateProps) {
  const colors = VERDICT_COLORS[verdict];

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '14px 16px',
      }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 2, background: colors.bar }}
      />

      <div
        className="uppercase font-extrabold"
        style={{
          fontSize: 9,
          letterSpacing: 1,
          color: 'var(--text-3)',
          marginBottom: 4,
        }}
      >
        Gate {gateNum}
      </div>

      <div
        className="font-semibold mb-2"
        style={{
          fontSize: 12,
          color: 'var(--text-2)',
          lineHeight: 1.4,
        }}
      >
        {rule}
      </div>

      <div className="flex items-baseline gap-1.5">
        <div
          className="font-extrabold leading-none"
          style={{
            fontSize: 22,
            letterSpacing: -0.5,
            color: colors.text,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{versus}</div>
      </div>

      <div
        className="inline-block mt-1.5 uppercase font-bold"
        style={{
          padding: '2px 8px',
          borderRadius: 100,
          fontSize: 10,
          letterSpacing: 0.5,
          background: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {verdictLabel}
      </div>
    </div>
  );
}
