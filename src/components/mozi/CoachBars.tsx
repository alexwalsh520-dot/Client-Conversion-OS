interface Coach {
  name: string;
  current_clients: number;
  max_clients: number;
}

interface CoachBarsProps {
  coaches?: Coach[];
}

const MOCK_COACHES: Coach[] = [
  { name: 'Kai', current_clients: 42, max_clients: 40 },
  { name: 'Tyler', current_clients: 38, max_clients: 40 },
  { name: 'Daniela', current_clients: 32, max_clients: 40 },
  { name: 'Sam', current_clients: 30, max_clients: 40 },
];

export function CoachBars({ coaches }: CoachBarsProps) {
  const data = coaches && coaches.length > 0 ? coaches : MOCK_COACHES;
  const totalCurrent = data.reduce((s, c) => s + c.current_clients, 0);
  const totalMax = data.reduce((s, c) => s + c.max_clients, 0);
  const weeksToFull = totalMax > totalCurrent
    ? Math.round(((totalMax - totalCurrent) / 5.5)) // ~5.5 new clients/week
    : 0;

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
        Coach Capacity
      </h4>

      <div className="flex flex-col gap-1.5">
        {data.map((coach) => {
          const pct = Math.min((coach.current_clients / coach.max_clients) * 100, 100);
          const color =
            pct >= 100 ? 'var(--red)' :
            pct >= 80 ? 'var(--amber)' :
            'var(--green)';

          return (
            <div key={coach.name} className="flex items-center gap-2">
              <span className="font-semibold" style={{ fontSize: 11, width: 55 }}>
                {coach.name}
              </span>
              <div
                className="flex-1 overflow-hidden"
                style={{
                  height: 5,
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 100,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(pct, 100)}%`,
                    background: color,
                    borderRadius: 100,
                  }}
                />
              </div>
              <span
                className="text-right"
                style={{
                  fontSize: 10,
                  color: pct >= 100 ? 'var(--red)' : 'var(--text-3)',
                  width: 40,
                }}
              >
                {coach.current_clients}/{coach.max_clients}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5" style={{ fontSize: 10, color: 'var(--text-3)' }}>
        Total:{' '}
        <b style={{ color: 'var(--text-2)' }}>
          {totalCurrent}/{totalMax}
        </b>
        {' '}&middot; Full in{' '}
        <b style={{ color: weeksToFull <= 6 ? 'var(--amber)' : 'var(--green)' }}>
          ~{weeksToFull} wks
        </b>
      </div>
    </div>
  );
}
