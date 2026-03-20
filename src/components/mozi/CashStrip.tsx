interface CashStripProps {
  cashOnHand: number;
  monthlyBurn: number;
  runwayMonths: number;
  currentAdSpend: number;
  gp30: number;
}

function fmt(cents: number): string {
  return '$' + Math.abs(Math.round(cents / 100)).toLocaleString();
}

export function CashStrip({ cashOnHand, monthlyBurn, runwayMonths, currentAdSpend, gp30 }: CashStripProps) {
  const netCash = cashOnHand - monthlyBurn;
  const adPctOfGP = gp30 > 0 ? Math.round((currentAdSpend / (gp30 * 23)) * 100) : 0;

  const runwayColor =
    runwayMonths >= 4 ? 'var(--green)' :
    runwayMonths >= 2 ? 'var(--amber)' :
    'var(--red)';

  return (
    <div className="grid grid-cols-3 gap-2.5 mb-4 max-sm:grid-cols-1">
      <CashTile
        label="Net Cash"
        value={`+${fmt(netCash)}`}
        sub="Cash in minus all out"
        color="var(--green)"
      />
      <CashTile
        label="Ad % of GP"
        value={`${adPctOfGP}%`}
        sub={`${fmt(currentAdSpend)} / ${fmt(gp30 * 23)}`}
        color="var(--text)"
      />
      <CashTile
        label="Runway"
        value={`${runwayMonths} mo`}
        sub="Cash on hand / burn"
        color={runwayColor}
      />
    </div>
  );
}

function CashTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="text-center"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: 14,
      }}
    >
      <div
        className="uppercase font-semibold"
        style={{
          fontSize: 9,
          letterSpacing: 1,
          color: 'var(--text-3)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="font-extrabold"
        style={{ fontSize: 22, letterSpacing: -0.5, color }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}
