-- ─────────────────────────────────────────────────────────────────────────
-- Sales tracker money is USD. Full stop.
--
-- The tracker is ONE team-wide sheet written in USD for every creator. A
-- creator's `currency` (creators.ts) is what META BILLS THEIR AD ACCOUNT and
-- applies to spend/budgets only. The facts builder wrongly applied it to
-- sales, so Jake's $1,200 "proven" sale (Philip Morehouse, 2026-08-02) was
-- stored as AUD and "converted" to $842.16.
--
-- Repair the stored rows: currency USD, usd amounts = native amounts. The
-- facts rebuild writes USD going forward (same deploy).
-- ─────────────────────────────────────────────────────────────────────────

update adsv2_sale_facts
set currency = 'USD',
    collected_usd_cents = collected_cents,
    contracted_usd_cents = contracted_cents
where currency is distinct from 'USD'
   or collected_usd_cents is distinct from collected_cents
   or contracted_usd_cents is distinct from contracted_cents;
