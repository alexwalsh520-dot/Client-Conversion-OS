interface NumberTileProps {
  label: string;
  value: string;
  sub: string;
  color?: string;
  tooltip?: string;
}

export function NumberTile({ label, value, sub, color, tooltip }: NumberTileProps) {
  return (
    <div
      className="relative text-center transition-colors duration-200"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: 16,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      {tooltip && (
        <div
          className="absolute flex items-center justify-center cursor-help font-bold"
          style={{
            top: 7,
            right: 9,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--text-3)',
            fontSize: 9,
          }}
          title={tooltip}
        >
          f
        </div>
      )}
      <div
        className="uppercase font-bold mb-1.5"
        style={{
          fontSize: 9,
          letterSpacing: 1.2,
          color: 'var(--text-3)',
        }}
      >
        {label}
      </div>
      <div
        className="font-black leading-none"
        style={{
          fontSize: 28,
          letterSpacing: -1,
          color: color || 'var(--text)',
        }}
      >
        {value}
      </div>
      <div className="mt-1" style={{ fontSize: 10, color: 'var(--text-3)' }}>
        {sub}
      </div>
    </div>
  );
}
