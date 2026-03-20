interface SalesGaugesProps {
  bookRate?: number;
  showRate?: number;
  closeRate?: number;
  targets?: { book: number; show: number; close: number };
}

const CIRCUMFERENCE = 2 * Math.PI * 20; // radius = 20

function Gauge({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const pct = value / 100;
  const dashArray = `${pct * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
  const color = value >= target ? 'var(--green)' : 'var(--amber)';

  return (
    <div className="flex-1 text-center">
      <div
        className="relative flex items-center justify-center mx-auto"
        style={{ width: 52, height: 52, marginBottom: 4 }}
      >
        <svg
          width="52"
          height="52"
          viewBox="0 0 52 52"
          className="absolute top-0 left-0"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="26"
            cy="26"
            r="20"
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="4"
          />
          <circle
            cx="26"
            cy="26"
            r="20"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={dashArray}
            strokeLinecap="round"
          />
        </svg>
        <div
          className="relative font-extrabold"
          style={{ fontSize: 14, color, zIndex: 1 }}
        >
          {value}%
        </div>
      </div>
      <div
        className="uppercase font-semibold"
        style={{ fontSize: 8, letterSpacing: 0.5, color: 'var(--text-3)' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-3)' }}>{target}%</div>
    </div>
  );
}

export function SalesGauges({
  bookRate = 24,
  showRate = 77,
  closeRate = 28,
  targets = { book: 25, show: 75, close: 35 },
}: SalesGaugesProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: 16,
      }}
    >
      <h4
        className="uppercase font-bold"
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: 'var(--text-3)',
          marginBottom: 10,
        }}
      >
        Sales Performance
      </h4>

      <div className="flex gap-2.5 mb-2">
        <Gauge label="Book" value={bookRate} target={targets.book} />
        <Gauge label="Show" value={showRate} target={targets.show} />
        <Gauge label="Close" value={closeRate} target={targets.close} />
      </div>

      <div
        className="leading-snug"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 'var(--rs)',
          padding: '7px 10px',
          fontSize: 10,
          color: 'var(--text-2)',
        }}
      >
        Biggest lift:{' '}
        <b style={{ color: 'var(--amber)', fontWeight: 700 }}>Close Rate</b>{' '}
        28% &rarr; 35% ={' '}
        <b style={{ color: 'var(--amber)', fontWeight: 700 }}>+$8,400/mo</b>
      </div>
    </div>
  );
}
