#!/usr/bin/env node
// Exercises the same function the /api/home/business-metrics route calls,
// so we can verify shape + numbers without going through auth.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { getHomeBusinessMetrics } from '../src/lib/home-business-metrics';

function dollars(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

async function main() {
const result = await getHomeBusinessMetrics();

console.log('Cards:', result.cards.length);
for (const card of result.cards) {
  console.log(`\n[${card.state}] ${card.label}`);
  console.log(`  GP30:     ${dollars(card.metrics.gp30)}`);
  console.log(`  CAC:      ${dollars(card.metrics.cac)}`);
  console.log(`  LTGP:     ${dollars(card.metrics.ltgp)}`);
  console.log(`  Capacity: ${card.metrics.capacityPct ?? '—'}${card.metrics.capacityPct != null ? '%' : ''}`);
  if (card.breakdown) {
    console.log(`  ├─ new clients:           ${card.breakdown.newClientCount}`);
    console.log(`  ├─ cohort revenue total:  ${dollars(card.breakdown.cohortRevenueCents)}`);
    console.log(`  ├─ direct costs / client: ${dollars(card.breakdown.directCostsPerNewClientCents)}`);
    console.log(`  ├─ CAC ads:               ${dollars(card.breakdown.cacAdSpendCents)}`);
    console.log(`  ├─ CAC software:          ${dollars(card.breakdown.cacMercurySoftwareCents)}`);
    console.log(`  ├─ CAC commissions:       ${dollars(card.breakdown.cacSalesCommissionsCents)}`);
    console.log(`  ├─ monthly GP / active:   ${dollars(card.breakdown.monthlyGpPerActiveClientCents)}`);
    console.log(`  └─ active clients:        ${card.breakdown.activeClients}`);
  }
  if (card.notes.length > 0) {
    for (const n of card.notes) console.log(`     · ${n}`);
  }
}

console.log('\nMissing setup:', result.missingSetup);
console.log('Window:', result.report?.window);
console.log('Avg program months:', result.report?.avgProgramMonths?.toFixed(1));
}
main().catch((e) => { console.error(e); process.exit(1); });
