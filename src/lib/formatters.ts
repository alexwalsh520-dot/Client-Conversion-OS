// Formatting utilities for CCOS

export function fmtDollars(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(n) >= 10_000) {
    return `$${(n / 1_000).toFixed(1)}K`;
  }
  return `$${n.toLocaleString()}`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString();
}

export function fmtPercent(n: number, decimals: number = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toString();
}

export function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtChange(
  current: number,
  previous: number
): { value: string; isPositive: boolean; trend: 'up' | 'down' | 'flat' } {
  if (previous === 0) return { value: 'N/A', isPositive: true, trend: 'flat' };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { value: '0%', isPositive: true, trend: 'flat' };
  return {
    value: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
    isPositive: change > 0,
    trend: change > 0 ? 'up' : 'down',
  };
}
