#!/usr/bin/env node
// mozi-sync-products.mjs
// Pull every active Stripe price across Keith + Tyson LLP + Tyson Subs,
// classify each with a draft role, and upsert into mozi_stripe_products.
// Run:  node scripts/mozi-sync-products.mjs
//
// Classification rules (draft — user reviews + overrides in the Settings UI):
//   ignore   → $6 items, "Balance Adjustment", "OLD (DND)", "Copy", tiny one-time <$10
//   renewal  → "Extension", "Extension Package", "Enforcement Challenge", recurring after first
//   upsell   → "Coaching Session", "VIP", "6 Week Upgrade"
//   downsell → "Downpayment", "Downplayment", anything with "Instalment"/"Instalments" amounts that aren't the full program
//   new_sale → everything else (Transformation, Challenge, Annual, The Forge monthly/annual)

import 'dotenv/config';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const ACCOUNTS = [
  { influencer: 'keith',  account: 'keith',       key: process.env.STRIPE_KEY_KEITH },
  { influencer: 'tyson',  account: 'tyson_llp',   key: process.env.STRIPE_KEY_TYSON_LLP },
  { influencer: 'tyson',  account: 'tyson_subs',  key: process.env.STRIPE_KEY_TYSON_SUBS },
];

function classify(productName = '', unitAmount, interval) {
  const n = productName.toLowerCase();
  const dollars = unitAmount == null ? null : unitAmount / 100;

  if (n.includes('dnd') || n.includes('(copy)')) return 'ignore';
  if (n.includes('balance adjustment')) return 'ignore';
  if (n.includes('neville') || n.includes('meditation')) return 'ignore';      // $6 micro
  if (dollars !== null && dollars <= 10) return 'ignore';                        // $6, $10 merch/test
  if (n.includes('coaching session')) return 'upsell';
  if (n.includes('vip')) return 'upsell';
  if (n.includes('upgrade')) return 'upsell';
  if (n.includes('extension') || n.includes('enforcement challenge')) return 'renewal';
  if (n.includes('early bird access')) return 'renewal';                         // recurring continuity
  if (n.includes('downpayment') || n.includes('downplayment')) return 'downsell';
  if (n.includes('instalment') || n.includes('installment')) return 'downsell';
  if (n.includes('sp package')) return 'upsell';
  if (n.includes('kevin and tommy')) return 'ignore';                            // one-off collab
  return 'new_sale';
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let totalUpserted = 0;

  for (const cfg of ACCOUNTS) {
    if (!cfg.key) {
      console.log(`[skip] ${cfg.account} — no key`);
      continue;
    }
    const stripe = new Stripe(cfg.key, { apiVersion: '2025-02-24.acacia' });
    const prices = [];
    for await (const p of stripe.prices.list({ limit: 100, expand: ['data.product'], active: true })) {
      prices.push(p);
    }
    console.log(`[${cfg.account}] ${prices.length} active prices`);

    for (const p of prices) {
      const prod = typeof p.product === 'object' ? p.product : null;
      const name = prod?.name ?? '';
      const interval = p.recurring?.interval ?? 'one-time';
      const role = classify(name, p.unit_amount, interval);

      // Preserve manual overrides: only write draft role if row is new or still 'draft'.
      const { data: existing } = await sb
        .from('mozi_stripe_products')
        .select('price_id, role, role_source')
        .eq('price_id', p.id)
        .maybeSingle();

      const roleToWrite = existing?.role_source === 'manual' ? existing.role : role;
      const sourceToWrite = existing?.role_source === 'manual' ? 'manual' : 'draft';

      const row = {
        influencer: cfg.influencer,
        stripe_account: cfg.account,
        price_id: p.id,
        product_id: prod?.id ?? null,
        product_name: name,
        unit_amount: p.unit_amount ?? null,
        currency: p.currency ?? 'usd',
        interval,
        active: p.active,
        role: roleToWrite,
        role_source: sourceToWrite,
        updated_at: new Date().toISOString(),
      };

      const { error } = await sb
        .from('mozi_stripe_products')
        .upsert(row, { onConflict: 'price_id' });
      if (error) {
        console.error(`  !! ${p.id}: ${error.message}`);
        continue;
      }
      totalUpserted++;
    }
  }

  // Print a summary table for review
  const { data: summary } = await sb
    .from('mozi_stripe_products')
    .select('influencer, stripe_account, role')
    .order('influencer');

  const counts = {};
  for (const r of summary || []) {
    const k = `${r.influencer}/${r.stripe_account}`;
    counts[k] = counts[k] || { new_sale: 0, renewal: 0, upsell: 0, downsell: 0, ignore: 0 };
    counts[k][r.role]++;
  }
  console.log('\n=== Draft classification summary ===');
  for (const [k, c] of Object.entries(counts)) {
    console.log(`${k.padEnd(22)} new:${c.new_sale}  renew:${c.renewal}  up:${c.upsell}  down:${c.downsell}  ignore:${c.ignore}`);
  }
  console.log(`\nTotal upserted: ${totalUpserted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
