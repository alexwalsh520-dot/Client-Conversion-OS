interface SparklineChartProps {
  title: string;
  data: number[];
  color: string;
}

export function SparklineChart({ title, data, color }: SparklineChartProps) {
  const max = Math.max(...data);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        height: 150,
      }}
    >
      <div
        className="uppercase font-bold"
        style={{
          padding: '8px 12px 0',
          fontSize: 9,
          letterSpacing: 1,
          color: 'var(--text-3)',
        }}
      >
        {title}
      </div>
      <div className="flex-1 flex items-end gap-0.5" style={{ padding: '6px 12px 12px' }}>
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              height: `${(v / max) * 100}%`,
              background: color,
              borderRadius: '2px 2px 0 0',
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}
