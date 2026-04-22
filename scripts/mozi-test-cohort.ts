#!/usr/bin/env node
// mozi-test-cohort.mjs — smoke-test the Mozi cohort engine against live data.
// Prints the real 4 numbers (GP30, CAC, LTGP, Capacity) per client + total.
//
// Run:  npx tsx scripts/mozi-test-cohort.mjs
//
// Sources:
//   - mozi_stripe_charges  (180d backfill of Stripe)
//   - mozi_meta_ad_spend   (last 30d of Meta spend, by influencer)
//   - expenses / Mercury   (fulfillment payroll + Everfit)
//   - Mercury acquisition  (SendBlue/Skool/Fathom/Gamma/ElevenLabs + ManyChat)
//   - Google Sheets sales tracker (setter+closer commissions)
//   - Supabase clients table (active counts + avg program months)

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { runCohortEngine } from '../src/lib/mozi-cohort-engine';
import { fetchAcquisitionCostsBreakdown } from '../src/lib/mozi-acquisition-costs';
import { fetchFulfillmentPayroll } from '../src/lib/mozi-coach-payroll';
import { fetchSalesCommissions } from '../src/lib/mozi-sales-commissions';

function dollars(cents) {
  if (cents == null || isNaN(cents)) return '—';
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. All Stripe charges (180d lookback; paginate past default 1000 row limit)
  const charges = [];
  let pageStart = 0;
  while (true) {
    const { data, error } = await sb
      .from('mozi_stripe_charges')
      .select('customer_id, customer_email, influencer, amount, refund_amount, created_at')
      .order('created_at', { ascending: true })
      .range(pageStart, pageStart + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    charges.push(...data);
    if (data.length < 1000) break;
    pageStart += 1000;
  }
  console.log(`Charges loaded: ${charges.length}`);

  // 2. Meta ad spend last 30d per influencer
  const sinceYmd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: adRows } = await sb
    .from('mozi_meta_ad_spend')
    .select('influencer, spend, date')
    .gte('date', sinceYmd);
  const metaAdSpendByClient = { keith: 0, tyson: 0 };
  for (const r of adRows ?? []) {
    if (r.influencer === 'keith') metaAdSpendByClient.keith += r.spend ?? 0;
    if (r.influencer === 'tyson') metaAdSpendByClient.tyson += r.spend ?? 0;
  }

  // 3. Active clients per influencer (from clients table)
  const { data: clientRows } = await sb.from('clients').select('offer, status, start_date, end_date');
  const activeByClient = { keith: 0, tyson: 0 };
  let totalActive = 0;
  const durations = [];
  for (const r of clientRows ?? []) {
    const offer = (r.offer || '').toLowerCase();
    const influencer = offer.includes('keith') ? 'keith' : offer.includes('tyson') ? 'tyson' : null;
    if (!influencer) continue;
    if ((r.status || '').toLowerCase() === 'active') {
      activeByClient[influencer]++;
      totalActive++;
    }
    if (r.start_date) {
      const start = new Date(r.start_date);
      const end = r.end_date ? new Date(r.end_date) : new Date();
      const months = Math.max(0.5, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (months > 0 && months < 60) durations.push(months);
    }
  }
  const avgProgramMonths =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 3;

  // 4. Mercury acquisition + manychat per client
  console.log('Fetching Mercury acquisition...');
  const acq = await fetchAcquisitionCostsBreakdown();
  const mercuryAcqByClient = {
    keith: acq.acquisitionTotalPerClient.keith + acq.manychatPerClient.keith,
    tyson: acq.acquisitionTotalPerClient.tyson + acq.manychatPerClient.tyson,
  };

  // 5. Fulfillment payroll (Mercury)
  console.log('Fetching fulfillment payroll...');
  const payroll = await fetchFulfillmentPayroll();

  // 6. Sales commissions (Google Sheets)
  console.log('Fetching sales commissions...');
  let commissions;
  try {
    commissions = await fetchSalesCommissions();
  } catch (e) {
    console.warn('sales tracker unavailable:', e.message);
    commissions = { perClient: { keith: { totalCents: 0, setterCents: 0, closerCents: 0, rowCount: 0 }, tyson: { totalCents: 0, setterCents: 0, closerCents: 0, rowCount: 0 } } };
  }

  // 7. Cost settings (from Supabase mozi_settings)
  const { data: settingsRows } = await sb.from('mozi_settings').select('key, value');
  const settingsMap = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
  const costs = settingsMap.costs || {};
  const paymentFeePct = costs.payment_fee_pct ?? 2.9;
  const chargebackPct = costs.chargeback_rate_pct ?? 1;
  const refundPct = costs.refund_rate_pct ?? 5;

  // 8. Run engine
  const result = runCohortEngine({
    allCharges: charges.map((c) => ({
      customer_id: c.customer_id,
      customer_email: c.customer_email,
      influencer: c.influencer,
      amount: c.amount,
      refund_amount: c.refund_amount,
      created_at: c.created_at,
    })),
    activeClientsByInfluencer: activeByClient,
    totalActiveClients: totalActive,
    fulfillmentPayrollMonthlyCents: payroll.totalCents,
    fulfillmentSoftwareMonthlyCents: acq.fulfillmentSoftwareCents,
    paymentFeePct,
    chargebackPct,
    refundPct,
    metaAdSpendByClient,
    mercuryAcquisitionByClient: mercuryAcqByClient,
    salesCommissionsByClient: {
      keith: commissions.perClient.keith.totalCents,
      tyson: commissions.perClient.tyson.totalCents,
    },
    avgProgramMonths,
    totalMaxClientSeats: 0, // user will fill in later
  });

  // 9. Print everything
  console.log('\n================ INPUTS ================');
  console.log(`Window:        ${result.windowStart.slice(0, 10)} → ${result.windowEnd.slice(0, 10)}`);
  console.log(`Total charges: ${charges.length}`);
  console.log(`Active clients: Keith ${activeByClient.keith}, Tyson ${activeByClient.tyson}, total ${totalActive}`);
  console.log(`Avg program months: ${avgProgramMonths.toFixed(1)}`);
  console.log(`Payment fee pct: ${paymentFeePct}%, chargeback: ${chargebackPct}%, refund: ${refundPct}%`);
  console.log(`Mercury acquisition SaaS 30d: Keith ${dollars(mercuryAcqByClient.keith)}, Tyson ${dollars(mercuryAcqByClient.tyson)}`);
  console.log(`Meta ad spend 30d:            Keith ${dollars(metaAdSpendByClient.keith)}, Tyson ${dollars(metaAdSpendByClient.tyson)}`);
  console.log(`Sales commissions 30d:        Keith ${dollars(commissions.perClient.keith.totalCents)}, Tyson ${dollars(commissions.perClient.tyson.totalCents)}`);
  console.log(`Fulfillment payroll 30d:      ${dollars(payroll.totalCents)} (${payroll.byCounterparty.length} counterparties)`);
  console.log(`Fulfillment software 30d:     ${dollars(acq.fulfillmentSoftwareCents)} (Everfit)`);

  console.log('\n================ RESULTS ================');
  for (const [client, r] of [['Keith', result.perClient.keith], ['Tyson', result.perClient.tyson], ['TOTAL', result.total]]) {
    console.log(`\n--- ${client} ---`);
    console.log(`  New clients (last 30d):        ${r.newClientCount}`);
    console.log(`  Cohort revenue total:          ${dollars(r.cohortRevenueCents)}`);
    console.log(`  Per new client cohort revenue: ${dollars(r.cohortGrossRevenuePerNewClientCents)}`);
    console.log(`  Direct costs per new client:   ${dollars(r.directCostsPerNewClientCents)}`);
    console.log(`  ⇒ GP30 per new client:         ${dollars(r.gp30Cents)}`);
    console.log(`  CAC: ads ${dollars(r.cacAdSpendCents)} + sw ${dollars(r.cacMercurySoftwareCents)} + comms ${dollars(r.cacSalesCommissionsCents)} = ${dollars(r.cacTotalCents)}`);
    console.log(`  ⇒ CAC per new client:          ${dollars(r.cacPerNewClientCents)}`);
    console.log(`  Monthly GP per active client:  ${dollars(r.monthlyGpPerActiveClientCents)}`);
    console.log(`  ⇒ LTGP:                        ${dollars(r.ltgpCents)}`);
    if (r.capacity) {
      console.log(`  Capacity: ${r.capacity.currentClients}/${r.capacity.maxClients} (${r.capacity.pct}%)`);
    } else {
      console.log(`  Capacity: —  (waiting on coach safe-max from PM)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
