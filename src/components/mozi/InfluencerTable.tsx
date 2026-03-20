interface InfluencerData {
  clients: number;
  cac: number;
  payback30: number;
  ltgp: number;
  revenue: number;
  adSpend: number;
  gp: number;
  yourShare: number;
  status: string;
}

interface InfluencerTableProps {
  byInfluencer: Record<string, InfluencerData>;
}

function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

const NAME_COLORS: Record<string, string> = {
  keith: 'var(--keith)',
  tyson: 'var(--tyson)',
};

function getChipClass(status: string) {
  if (status === 'buy' || status === 'scale') {
    return { bg: 'var(--green-bg)', color: 'var(--green)', border: 'var(--green-b)', label: 'Scale' };
  }
  if (status === 'hold') {
    return { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'var(--amber-b)', label: 'Hold' };
  }
  return { bg: 'var(--red-bg)', color: 'var(--red)', border: 'var(--red-b)', label: 'Fix' };
}

export function InfluencerTable({ byInfluencer }: InfluencerTableProps) {
  const entries = Object.entries(byInfluencer);
  if (entries.length === 0) return null;

  // Sort: Keith first (higher GP typically), then Tyson
  const sorted = entries.sort(([a], [b]) => {
    if (a === 'keith') return 1;
    if (b === 'keith') return -1;
    return 0;
  });

  return (
    <div
      className="overflow-hidden mb-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              {['Partner', 'Status', 'Clients', 'CAC', '30d Payback', 'LTGP', 'Revenue', 'Ad Spend', 'GP', 'Your 50%'].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left uppercase font-semibold"
                    style={{
                      padding: '9px 14px',
                      fontSize: 9,
                      letterSpacing: 1,
                      color: 'var(--text-3)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map(([name, data]) => {
              const chip = getChipClass(data.status);
              const nameColor = NAME_COLORS[name] || 'var(--text)';

              return (
                <tr
                  key={name}
                  className="group"
                >
                  <td
                    className="font-bold"
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      color: nameColor,
                    }}
                  >
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <span
                      className="inline-flex uppercase font-bold"
                      style={{
                        padding: '2px 7px',
                        borderRadius: 100,
                        fontSize: 9,
                        letterSpacing: 0.5,
                        background: chip.bg,
                        color: chip.color,
                        border: `1px solid ${chip.border}`,
                      }}
                    >
                      {chip.label}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {data.clients}
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      color: data.cac > 65000 ? 'var(--amber)' : 'var(--green)',
                    }}
                  >
                    {fmt(data.cac)}
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      color: data.payback30 >= 0 ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {data.payback30 >= 0 ? '+' : '-'}{fmt(data.payback30)}
                  </td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {fmt(data.ltgp)}
                  </td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {fmt(data.revenue)}
                  </td>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {fmt(data.adSpend)}
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--green)',
                    }}
                  >
                    {fmt(data.gp)}
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--gold)',
                    }}
                  >
                    {fmt(data.yourShare)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
