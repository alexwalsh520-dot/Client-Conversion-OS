// Benchmark thresholds and constants for NERVE

export const BENCHMARKS = {
  showUpRate15Min: 85,
  showUpRate60Min: 85,
  closeRate: 35,
  coachCompletionRate: 85,
  coachMinRating: 8.0,
  coachMinNPS: 8.0,
  minROI: 300,
  maxHealthyChurnRate: 5,
  avgDealValue: 1_100,
} as const;

export const CARD_COLORS: Record<string, string> = {
  alert: 'var(--danger)',
  opportunity: 'var(--success)',
  win: 'var(--accent)',
  bottleneck: 'var(--warning)',
  experiment: 'var(--tyson)',
};

export const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  ad_creative: { bg: 'var(--accent-soft)', text: 'var(--accent)' },
  dm_script: { bg: 'var(--tyson-soft)', text: 'var(--tyson)' },
  pricing: { bg: 'var(--success-soft)', text: 'var(--success)' },
  team: { bg: 'var(--warning-soft)', text: 'var(--warning)' },
  process: { bg: 'var(--keith-soft)', text: 'var(--keith)' },
  offer: { bg: 'var(--danger-soft)', text: 'var(--danger)' },
};
